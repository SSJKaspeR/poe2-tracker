import { isGearText } from '../core/clipboard/ClipboardWatcher'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { guessActiveFilter, listFilters, poe2DocumentsDirs } from '../core/filter/findLootFilter'
import { hiddenValuable, parseFilter, type ParsedFilter } from '../core/filter/LootFilter'
import { EventEmitter } from 'node:events'
import { checkGear } from '../core/build/gearCheck'
import { compareGear, impactScore, type DetailedItem } from '../core/build/targetCompare'
import { compareSkills, compareTree, type SkillGroup, type TreeDetail } from '../core/build/treeGemsCompare'
import { BuildRepository } from '../core/db/BuildRepository'
import { AppDatabase } from '../core/db/Database'
import { RunRepository, type StoredRun } from '../core/db/RunRepository'
import { SqlitePriceCache } from '../core/db/SqlitePriceCache'
import { Economy, type ProfitSummary } from '../core/economy/Economy'
import { LogTailer } from '../core/logs/LogTailer'
import { findClientLog } from '../core/logs/findClientLog'
import { parseLine } from '../core/logs/parseLine'
import { PobBridge, type PobBridgeOptions } from '../core/pob/PobBridge'
import { PoeNinjaClient } from '../core/pricing/PoeNinjaClient'
import { EXCHANGE_TYPES, PriceBook, STASH_TYPES } from '../core/pricing/PriceBook'
import { RunTracker, type Run } from '../core/runs/RunTracker'
import { SessionRepository, type SessionSummary } from '../core/sessions/SessionRepository'
import type {
  ActiveBuildDTO,
  AppStatus,
  BuildSnapshotDTO,
  BuildVersionDTO,
  GearCheckDTO,
  GuideComparisonDTO,
  LootFilterDTO,
  ItemComparisonDTO,
  PresetDTO,
  PresetItemDTO,
  PriceDTO,
  ProfitSummaryDTO,
  Result,
  RunDTO,
  RunDetailDTO,
  RunLinesDTO,
  SessionLineDTO,
  SessionSummaryDTO,
  StartSessionDTO,
  TradePreviewDTO,
  TradeWeightsDTO,
  VersionPerformanceDTO
} from '../shared/ipc'

const PRICE_REFRESH_MS = 60 * 60 * 1000

/**
 * Wires the core modules together. No Electron imports here, so it stays testable.
 * Emits 'status' (AppStatus) and 'item-compared' (Result<ItemComparisonDTO>).
 */
export class TrackerService extends EventEmitter {
  private readonly database: AppDatabase
  private readonly runs: RunRepository
  private readonly builds: BuildRepository
  private readonly economy: Economy
  private readonly sessions: SessionRepository
  private readonly tracker = new RunTracker()
  private readonly pricing: PoeNinjaClient
  private readonly pob: PobBridge | null
  private priceBook = new PriceBook()
  private priceError: string | null = null
  private league: string | null = null
  private tailer: LogTailer | null = null
  private clientLogPath: string | null = null
  private timers: NodeJS.Timeout[] = []
  private pobVersion: string | null = null
  private pobError: string | null = null
  private pobReady: Promise<void> = Promise.resolve()
  /** PoB holds one build at a time: every engine operation goes through this queue. */
  private pobQueue: Promise<unknown> = Promise.resolve()
  /** Engine process generation whose build is the player's (reloaded after a crash). */
  private loadedGeneration = -1
  private readonly tradeWeightCache = new Map<string, TradeWeightsDTO>()
  private refreshing: Promise<void> | null = null
  private stopped = false
  private readonly filterDirs: string[]
  private parsedFilter: { path: string; mtime: number; filter: ParsedFilter } | null = null

  constructor(opts: {
    dbPath: string
    pob: Omit<PobBridgeOptions, 'onLog'> | null
    log?: (msg: string) => void
    pricing?: PoeNinjaClient
    /** Sent to poe.ninja, e.g. "PoE2Tracker/0.1.0 (+https://github.com/…)". */
    userAgent?: string
    /** Where PoE 2 keeps loot filters (Documents/My Games/Path of Exile 2…). */
    filterDirs?: string[]
  }) {
    super()
    this.filterDirs = opts.filterDirs ?? []
    this.database = new AppDatabase(opts.dbPath)
    this.runs = new RunRepository(this.database.db)
    this.builds = new BuildRepository(this.database.db)
    this.economy = new Economy(this.database.db, () => this.priceBook)
    this.sessions = new SessionRepository(this.database.db, () => this.priceBook)
    this.tracker.setTrackOtherAreas(this.sessions.active()?.mode === 'boss')
    this.pricing = opts.pricing ?? new PoeNinjaClient({ cache: new SqlitePriceCache(this.database.db), userAgent: opts.userAgent })
    this.pob = opts.pob ? new PobBridge({ ...opts.pob, onLog: (l) => opts.log?.(`[pob] ${l}`) }) : null
    if (!opts.pob) this.pobError = 'Path of Building engine not installed (run `npm run setup:pob`)'

    this.tracker.on((e) => {
      if (this.stopped) return
      if (e.type === 'run_started') {
        this.runs.upsert(e.run, { buildVersionId: this.activeVersionId() })
        const session = this.sessions.active()
        if (session) this.sessions.attachRun(e.run.id, session.id, session.mode === 'boss' ? 'boss' : 'map')
        // The map strategy (waystone + tablets) doesn't apply to boss attempts.
        const presetId = this.activePresetId()
        if (presetId !== null && session?.mode !== 'boss' && this.getSetting('autoApplyPreset') === '1') {
          try {
            this.economy.applyPreset(e.run.id, presetId)
          } catch (err) {
            opts.log?.(`auto-apply preset failed: ${String(err)}`)
          }
        }
      } else if (e.type === 'run_completed') {
        this.runs.upsert(e.run, { endReason: e.reason })
        this.saveLogPosition()
      } else {
        this.runs.upsert(e.run)
      }
      this.emitStatus()
    })
  }

  async start(): Promise<void> {
    const override = process.env.POE2_CLIENT_LOG
    const saved = this.getSetting('clientLogPath')
    const path = override && existsSync(override) ? override : saved && existsSync(saved) ? saved : findClientLog()
    if (path) await this.watchLog(path)
    this.timers.push(
      setInterval(() => {
        this.tracker.tick(new Date())
        this.saveLogPosition()
      }, 30_000)
    )
    this.timers.push(setInterval(() => void this.refreshPrices(), PRICE_REFRESH_MS))
    // Slow work in the background: PoB loads in a few seconds, prices need the network.
    this.pobReady = this.startPob()
    void this.refreshPrices()
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    for (const t of this.timers) clearInterval(t)
    await this.tailer?.stop()
    this.saveLogPosition()
    const current = this.tracker.endCurrentRun(new Date())
    this.stopped = true
    if (current) this.runs.upsert(current, { endReason: 'manual' })
    await this.pob?.stop()
    // Let in-flight work (price refresh, engine queue) settle before closing the database.
    await this.pobQueue.catch(() => undefined)
    this.database.close()
  }

  async watchLog(path: string): Promise<void> {
    await this.tailer?.stop()
    this.clientLogPath = path
    this.setSetting('clientLogPath', path)
    // Resume where the last session stopped reading (maps played while the app was
    // closed are picked up, nothing is counted twice). First time on this file:
    // replay its end so a map in progress is found.
    const saved = this.getLogState()
    this.tailer = new LogTailer(
      path,
      (line) => {
        const event = parseLine(line)
        if (event) this.tracker.handle(event)
      },
      { replayBytes: 64 * 1024, ...(saved && saved.path === path ? { startPosition: saved.offset } : {}) }
    )
    await this.tailer.start()
    this.saveLogPosition()
    this.emitStatus()
  }

  private getLogState(): { path: string; offset: number } | null {
    const raw = this.getSetting('logState')
    if (!raw) return null
    try {
      return JSON.parse(raw) as { path: string; offset: number }
    } catch {
      return null
    }
  }

  private saveLogPosition(): void {
    if (this.stopped || !this.tailer || !this.clientLogPath) return
    this.setSetting('logState', JSON.stringify({ path: this.clientLogPath, offset: this.tailer.consumedPosition }))
  }

  endCurrentRun(): void {
    this.tracker.endCurrentRun(new Date())
  }

  // ── Status ────────────────────────────────────────────────────────────────

  status(): AppStatus {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const current = this.tracker.getCurrentRun()
    const exalted = this.priceBook.get('exalted')
    return {
      clientLogPath: this.clientLogPath,
      logWatching: this.tailer !== null,
      pob: {
        available: this.pob !== null,
        running: this.pob?.running ?? false,
        version: this.pobVersion,
        error: this.pobError
      },
      trackerState: this.tracker.getState(),
      currentRun: current ? toDTO(current, null) : null,
      segmentStartedAt: this.tracker.getSegmentStart()?.toISOString() ?? null,
      today: this.runs.statsSince(startOfDay),
      todayProfit: toProfitDTO(this.economy.summary({ since: startOfDay })),
      build: this.activeBuild(),
      league: this.league,
      prices: {
        count: this.priceBook.size,
        exaltedPerDivine: exalted && exalted.value > 0 ? 1 / exalted.value : null,
        error: this.priceError,
        requestsLastHour: this.pricing.usage().lastHour,
        requestsLast24h: this.pricing.usage().last24h
      },
      activePresetId: this.activePresetId(),
      autoApplyPreset: this.getSetting('autoApplyPreset') === '1',
      clipboardWatch: this.getSetting('clipboardWatch') !== '0',
      session: this.activeSessionSummary()
    }
  }

  recentRuns(limit = 50): RunDTO[] {
    return this.runs.recent(limit).map((r) => toDTO(r, r.endReason))
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  async buildSnapshot(): Promise<Result<BuildSnapshotDTO | null>> {
    if (!this.pob || this.activeVersionId() === null) return { ok: true, value: null }
    await this.pobReady
    return wrap(() => this.withPob(() => this.pob!.stats()))
  }

  async importBuild(code: string, opts: { newBuild: boolean; name?: string }): Promise<Result<BuildSnapshotDTO>> {
    if (!this.pob) return { ok: false, error: this.pobError ?? 'PoB unavailable' }
    await this.pobReady
    const res = await wrap(() => this.withPob(() => this.pob!.loadCode(code.trim())))
    if (!res.ok) return res
    const snap = res.value
    const active = this.activeBuild()
    let buildId: number
    if (!active || opts.newBuild) {
      const name = opts.name?.trim() || defaultBuildName(snap)
      buildId = this.builds.createBuild(name)
    } else {
      buildId = active.buildId
    }
    const label = active && !opts.newBuild ? 'Re-imported' : 'Imported'
    const v = this.builds.addVersion(buildId, { pobCode: code.trim(), label, stats: snap.stats })
    this.setSetting('activeBuildVersionId', String(v.id))
    this.emitStatus()
    return res
  }

  async compareItem(itemText: string): Promise<Result<ItemComparisonDTO>> {
    if (!this.pob) return { ok: false, error: this.pobError ?? 'PoB unavailable' }
    await this.pobReady
    const res = await wrap(() => this.withPob(() => this.pob!.compareItem(itemText)))
    return res.ok ? { ok: true, value: { ...res.value, itemText } } : res
  }

  /** Item copied in game: compare it and push the result to the UI. */
  async onCopiedItem(itemText: string): Promise<void> {
    if (this.getSetting('clipboardWatch') === '0') return
    if (!isGearText(itemText)) return // currency, waystones… (e.g. price checked with Exiled Exchange 2)
    this.emit('item-compared', await this.compareItem(itemText))
  }

  /** Equip an item for real: becomes a new version of the active build. */
  async equipItem(itemText: string): Promise<Result<BuildSnapshotDTO>> {
    if (!this.pob) return { ok: false, error: this.pobError ?? 'PoB unavailable' }
    const active = this.activeBuild()
    if (!active) return { ok: false, error: 'Import your build first' }
    await this.pobReady
    const res = await wrap(() => this.withPob(async () => {
      const snap = await this.pob!.equipItem(itemText)
      const { code } = await this.pob!.exportCode()
      const itemName = firstItemName(itemText)
      const v = this.builds.addVersion(active.buildId, {
        pobCode: code,
        label: `Equipped ${itemName} (${snap.slot})`,
        stats: snap.stats
      })
      this.setSetting('activeBuildVersionId', String(v.id))
      return snap
    }))
    this.emitStatus()
    return res
  }

  // ── Loot filter ────────────────────────────────────────────────────────────

  /**
   * The player's loot filter and the priced items it hides (value never seen on the ground).
   * Only currency-like items (named by base type) are checked: uniques are matched by base,
   * which poe.ninja names don't give.
   */
  lootFilter(minExalted = 1): LootFilterDTO {
    const chosen = this.getSetting('lootFilterPath')
    const candidates = listFilters(this.filterDirs).map((c) => ({ path: c.path, name: c.name, online: c.online }))
    const path = chosen && existsSync(chosen) ? chosen : guessActiveFilter(this.filterDirs)
    const areaLevel = this.runs.recent(1)[0]?.areaLevel ?? 80
    const exalted = this.priceBook.get('exalted')
    const exPerDiv = exalted && exalted.value > 0 ? 1 / exalted.value : null
    const base: LootFilterDTO = {
      path,
      auto: !(chosen && existsSync(chosen)),
      candidates,
      info: null,
      areaLevel,
      minExalted,
      hidden: [],
      error: null
    }
    if (!path) return { ...base, error: 'No loot filter found. Choose your .filter file.' }
    try {
      const filter = this.loadFilter(path)
      const minValue = exPerDiv ? minExalted / exPerDiv : Number.POSITIVE_INFINITY
      const priced = this.priceBook.all().filter((p) => p.kind === 'exchange').map((p) => ({ name: p.name, value: p.value }))
      const hidden = hiddenValuable(filter, priced, { areaLevel, minValue }).map((h) => ({
        name: h.name,
        valueDivine: h.value,
        valueExalted: exPerDiv ? h.value * exPerDiv : null,
        line: h.line,
        uncertain: h.uncertain
      }))
      return {
        ...base,
        info: { ...filter.info, blocks: filter.blocks.length },
        hidden,
        error: exPerDiv ? null : 'Prices not loaded yet'
      }
    } catch (err) {
      return { ...base, error: `Can't read the filter: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  /** Automatic update checks (GitHub Releases), on by default. */
  getUpdateChecks(): boolean {
    return this.getSetting('updateChecks') !== '0'
  }

  setUpdateChecks(on: boolean): void {
    this.setSetting('updateChecks', on ? '1' : '0')
  }

  setLootFilter(path: string | null): void {
    this.setSetting('lootFilterPath', path ?? '')
    this.parsedFilter = null
  }

  private loadFilter(path: string): ParsedFilter {
    const mtime = statSync(path).mtimeMs
    if (this.parsedFilter?.path === path && this.parsedFilter.mtime === mtime) return this.parsedFilter.filter
    const filter = parseFilter(readFileSync(path, 'utf8'))
    this.parsedFilter = { path, mtime, filter }
    return filter
  }

  versionPerformance(): VersionPerformanceDTO[] {
    const active = this.activeBuild()
    if (!active) return []
    return this.builds.performanceByVersion(active.buildId).map((p) => ({
      versionId: p.versionId,
      label: p.label,
      createdAt: p.createdAt.toISOString(),
      runs: p.runs,
      activeMs: p.activeMs,
      deaths: p.deaths,
      profit: toProfitDTO(this.economy.summary({ buildVersionId: p.versionId }))
    }))
  }

  buildVersions(): BuildVersionDTO[] {
    const active = this.activeBuild()
    if (!active) return []
    const perf = new Map(this.builds.performanceByVersion(active.buildId).map((p) => [p.versionId, p]))
    return this.builds.versionsOf(active.buildId).map((v) => {
      const p = perf.get(v.id)
      return {
        versionId: v.id,
        label: v.label,
        createdAt: v.createdAt.toISOString(),
        stats: v.stats,
        performance: {
          runs: p?.runs ?? 0,
          activeMs: p?.activeMs ?? 0,
          deaths: p?.deaths ?? 0,
          profit: toProfitDTO(this.economy.summary({ buildVersionId: v.id }))
        }
      }
    })
  }

  async gearCheck(): Promise<Result<GearCheckDTO[]>> {
    if (!this.pob || this.activeVersionId() === null) return { ok: true, value: [] }
    await this.pobReady
    return wrap(() => this.withPob(async () => checkGear(await this.pob!.auditItems())))
  }

  // ── Guide build ───────────────────────────────────────────────────────────

  /**
   * Read a guide build once (stats + gear), then put the player's build back in
   * the engine. The snapshot is stored per build, so the guide is only parsed once.
   */
  async setGuideBuild(code: string, name?: string): Promise<Result<GuideComparisonDTO>> {
    if (!this.pob) return { ok: false, error: this.pobError ?? 'PoB unavailable' }
    const active = this.activeBuild()
    if (!active) return { ok: false, error: 'Import your own build first' }
    await this.pobReady
    const res = await wrap(() =>
      this.withPob(async () => {
        try {
          const snap = await this.pob!.loadCode(code.trim(), 'Guide')
          const { items } = await this.pob!.itemsDetail()
          const tree = await this.pob!.treeDetail()
          const { groups } = await this.pob!.skillsDetail()
          const guide: StoredGuide = {
            code: code.trim(),
            name: name?.trim() || defaultBuildName(snap),
            importedAt: new Date().toISOString(),
            info: snap.info,
            stats: snap.stats,
            items,
            tree,
            skills: groups
          }
          this.setSetting(`guide:${active.buildId}`, JSON.stringify(guide))
        } finally {
          await this.loadActiveVersion()
        }
      })
    )
    if (!res.ok) return res
    const cmp = await this.guideComparison()
    return cmp.ok && cmp.value ? { ok: true, value: cmp.value } : { ok: false, error: cmp.ok ? 'No guide' : cmp.error }
  }

  clearGuideBuild(): void {
    const active = this.activeBuild()
    if (active) this.deleteSetting(`guide:${active.buildId}`)
  }

  async guideComparison(): Promise<Result<GuideComparisonDTO | null>> {
    const active = this.activeBuild()
    const raw = active ? this.getSetting(`guide:${active.buildId}`) : null
    if (!raw || !this.pob) return { ok: true, value: null }
    const guide = JSON.parse(raw) as StoredGuide
    await this.pobReady
    return wrap(() =>
      this.withPob(async () => {
        const [{ items: playerItems }, playerSnap] = [await this.pob!.itemsDetail(), await this.pob!.stats()]
        const slots = await Promise.all(
          compareGear(guide.items, playerItems).map(async (c) => {
            const g = guide.items.find((i) => i.slot === c.slot)
            let impact: GuideComparisonDTO['slots'][number]['impact'] = null
            // Ask PoB what the guide's item would do on the player's build.
            if (g?.raw && c.status !== 'match' && c.status !== 'not_in_guide') {
              try {
                impact = (await this.pob!.compareItem(g.raw, c.slot)).diff
              } catch {
                impact = null
              }
            }
            const uniquePrice =
              g?.rarity === 'UNIQUE' && (c.status === 'missing_unique' || c.status === 'empty')
                ? (this.priceBook.getUnique(g.title ?? g.name, g.base)?.value ?? null)
                : null
            return {
              ...c,
              missing: c.missing.map(({ text, want, have }) => ({ text, want, have })),
              lower: c.lower.map(({ text, want, have }) => ({ text, want, have })),
              impact,
              impactScore: impact ? impactScore(impact) : 0,
              uniquePrice
            }
          })
        )
        slots.sort((a, b) => b.impactScore - a.impactScore)
        const keys = ['CombinedDPS', 'Life', 'EnergyShield', 'TotalEHP', 'Spirit', 'Armour', 'Evasion', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist', 'EffectiveMovementSpeedMod']
        const stats = keys
          .filter((k) => guide.stats[k] !== undefined && playerSnap.stats[k] !== undefined)
          .map((k) => ({ key: k, player: playerSnap.stats[k]!, guide: guide.stats[k]! }))

        let tree: GuideComparisonDTO['tree'] = null
        if (guide.tree) {
          const t = compareTree(guide.tree, await this.pob!.treeDetail())
          // PoB: what each missing keystone / notable / ascendancy node would give
          // (path ignored), to show which ones matter most. Capped to keep it fast.
          const rate = async (nodes: TreeDetail['nodes']) => {
            const out = []
            for (const node of nodes.slice(0, 30)) {
              let impact = null
              try {
                impact = (await this.pob!.compareNode(node.id)).diff
              } catch {
                impact = null
              }
              out.push({ ...node, impact, impactScore: impact ? impactScore(impact) : 0 })
            }
            return out.sort((a, b) => b.impactScore - a.impactScore)
          }
          tree = {
            ...t,
            missing: {
              ...t.missing,
              keystones: await rate(t.missing.keystones),
              notables: await rate(t.missing.notables),
              ascendancy: t.missing.ascendancy
            }
          }
        }
        const skills = guide.skills ? compareSkills(guide.skills, (await this.pob!.skillsDetail()).groups) : null

        return { guideName: guide.name, importedAt: guide.importedAt, guideInfo: guide.info, stats, slots, tree, skills }
      })
    )
  }

  // ── Trade upgrade search ──────────────────────────────────────────────────

  /** PoB weights per stat for upgrading this slot (cached per build version and slot). */
  async tradeWeights(slot: string): Promise<Result<TradeWeightsDTO>> {
    if (!this.pob) return { ok: false, error: this.pobError ?? 'PoB unavailable' }
    if (!this.activeBuild()) return { ok: false, error: 'Import your build first' }
    const key = `${this.activeVersionId()}|${slot}`
    const cached = this.tradeWeightCache.get(key)
    if (cached) return { ok: true, value: cached }
    await this.pobReady
    const res = await wrap(() => this.withPob(() => this.pob!.tradeWeights(slot)))
    if (res.ok) this.tradeWeightCache.set(key, res.value)
    return res
  }

  async tradePreview(slot: string, mods: { tradeId: string; text: string; value: number }[]): Promise<Result<TradePreviewDTO>> {
    if (!this.pob) return { ok: false, error: this.pobError ?? 'PoB unavailable' }
    await this.pobReady
    const res = await wrap(() => this.withPob(() => this.pob!.tradePreview(slot, mods)))
    return res.ok ? { ok: true, value: { slot: res.value.slot, lines: res.value.lines, diff: res.value.diff } } : res
  }

  runsDetailed(sinceDays: number | null): RunDetailDTO[] {
    let since: Date | undefined
    if (sinceDays !== null) {
      since = new Date()
      since.setHours(0, 0, 0, 0)
      since.setDate(since.getDate() - (sinceDays - 1))
    }
    return this.runs.detailed({ since }).map((r) => ({
      ...toDTO(r, r.endReason),
      strategyName: r.strategyName,
      versionLabel: r.versionLabel,
      invested: r.invested,
      looted: r.looted,
      hasLoot: r.hasLoot
    }))
  }

  setClipboardWatch(on: boolean): void {
    this.setSetting('clipboardWatch', on ? '1' : '0')
    this.emitStatus()
  }

  // ── Economy ───────────────────────────────────────────────────────────────

  /** Refresh prices from poe.ninja (only categories whose cache expired). One refresh at a time. */
  refreshPrices(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.doRefreshPrices().finally(() => {
        this.refreshing = null
      })
    }
    return this.refreshing
  }

  private async doRefreshPrices(): Promise<void> {
    try {
      // Keep the league only once poe.ninja answered; otherwise retry on the next refresh.
      if (!this.league) this.league = this.getSetting('league') ?? (await this.pickLeague())
      const league = this.league ?? 'Standard'
      const book = new PriceBook()
      let failures = 0
      const jobs = [
        ...EXCHANGE_TYPES.map((t) => () => this.pricing.prices(league, t)),
        ...STASH_TYPES.map((t) => () => this.pricing.stashPrices(league, t))
      ]
      // First load: expose prices as each category arrives (≈ 1.5 s apart) instead of
      // waiting for all of them. Later refreshes swap the whole book at the end.
      const progressive = this.priceBook.size === 0
      if (progressive) this.priceBook = book
      for (const job of jobs) {
        try {
          for (const p of await job()) book.add(p)
          if (progressive) this.emitStatus()
        } catch {
          failures++
        }
      }
      if (book.size > 0) this.priceBook = book
      const usage = this.pricing.usage()
      this.priceError = usage.pausedUntil
        ? `poe.ninja paused (${usage.pauseReason}) — using saved prices`
        : failures === jobs.length
          ? 'poe.ninja unreachable'
          : null
    } catch (err) {
      this.priceError = err instanceof Error ? err.message : String(err)
    }
    this.emitStatus()
  }

  searchPrices(query: string): PriceDTO[] {
    return this.priceBook.search(query)
  }

  presets(): PresetDTO[] {
    return this.economy.presets().map((p) => {
      const cost = this.economy.presetCost(p)
      return { ...p, costPerMap: cost.total, unpriced: cost.unpriced }
    })
  }

  savePreset(p: { id?: number; name: string; items: PresetItemDTO[] }): PresetDTO[] {
    if (p.id) this.economy.updatePreset(p.id, p.name, p.items)
    else {
      const created = this.economy.createPreset(p.name, p.items)
      if (this.activePresetId() === null) this.setSetting('activePresetId', String(created.id))
    }
    this.emitStatus()
    return this.presets()
  }

  deletePreset(id: number): PresetDTO[] {
    this.economy.deletePreset(id)
    if (this.activePresetId() === id) this.deleteSetting('activePresetId')
    this.emitStatus()
    return this.presets()
  }

  setActivePreset(id: number | null, autoApply: boolean): void {
    if (id === null) this.deleteSetting('activePresetId')
    else this.setSetting('activePresetId', String(id))
    this.setSetting('autoApplyPreset', autoApply ? '1' : '0')
    this.emitStatus()
  }

  runLines(runId: string): RunLinesDTO {
    const l = this.economy.runLines(runId)
    const map = (x: { id: number; label: string; quantity: number; unitValue: number | null }) => ({
      id: x.id,
      label: x.label,
      quantity: x.quantity,
      unitValue: x.unitValue
    })
    const meta = this.database.db.prepare('SELECT kind, outcome FROM runs WHERE id = ?').get(runId) as
      | { kind: 'map' | 'boss'; outcome: 'kill' | 'fail' | null }
      | undefined
    return {
      runId,
      kind: meta?.kind ?? 'map',
      outcome: meta?.outcome ?? null,
      strategyId: l.strategyId,
      investments: l.investments.map(map),
      loot: l.loot.map(map)
    }
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  startSession(s: StartSessionDTO): void {
    const target = s.targetCount && s.targetCount > 0 ? Math.floor(s.targetCount) : null
    this.sessions.start({
      mode: s.mode,
      targetCount: s.mode === 'hideout' ? null : target,
      bossName: s.mode === 'boss' ? s.bossName?.trim() || null : null,
      activity: s.mode === 'hideout' ? (s.activity ?? 'stash') : null
    })
    // Boss arenas are not "Map…" areas: track every non-safe area as an attempt.
    this.tracker.setTrackOtherAreas(s.mode === 'boss')
    const current = this.tracker.getCurrentRun()
    const session = this.sessions.active()
    if (current && session) this.sessions.attachRun(current.id, session.id, session.mode === 'boss' ? 'boss' : 'map')
    this.emitStatus()
  }

  endSession(): void {
    this.sessions.endActive()
    this.tracker.setTrackOtherAreas(false)
    this.emitStatus()
  }

  sessionHistory(): SessionSummaryDTO[] {
    return this.sessions
      .list(100)
      .map((s) => this.sessions.summary(s.id))
      .filter((s): s is SessionSummary => s !== null)
      .map(toSessionDTO)
  }

  setRunOutcome(runId: string, outcome: 'kill' | 'fail' | null): RunLinesDTO {
    this.sessions.setOutcome(runId, outcome)
    this.emitStatus()
    return this.runLines(runId)
  }

  sessionLines(sessionId: number): SessionLineDTO[] {
    return this.sessions.lines(sessionId).map((l) => ({
      id: l.id,
      direction: l.direction,
      label: l.label,
      quantity: l.quantity,
      unitValue: l.unitValue
    }))
  }

  addSessionLine(
    sessionId: number,
    line: { direction: 'spent' | 'gained'; label: string; itemId?: string; quantity: number; manualValue?: number }
  ): SessionLineDTO[] {
    this.sessions.addLine(sessionId, line)
    this.emitStatus()
    return this.sessionLines(sessionId)
  }

  removeSessionLine(sessionId: number, lineId: number): SessionLineDTO[] {
    this.sessions.removeLine(lineId)
    this.emitStatus()
    return this.sessionLines(sessionId)
  }

  private activeSessionSummary(): SessionSummaryDTO | null {
    const a = this.sessions.active()
    const sum = a ? this.sessions.summary(a.id) : null
    return sum ? toSessionDTO(sum) : null
  }

  applyPresetToRun(runId: string, presetId: number): RunLinesDTO {
    this.economy.applyPreset(runId, presetId)
    this.emitStatus()
    return this.runLines(runId)
  }

  addLoot(runId: string, item: { label: string; itemId?: string; quantity: number; manualValue?: number }): RunLinesDTO {
    this.economy.addLoot(runId, item)
    this.emitStatus()
    return this.runLines(runId)
  }

  removeLine(runId: string, kind: 'loot' | 'investment', lineId: number): RunLinesDTO {
    if (kind === 'loot') this.economy.removeLoot(lineId)
    else this.economy.removeInvestment(lineId)
    this.emitStatus()
    return this.runLines(runId)
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async startPob(): Promise<void> {
    if (!this.pob) return
    const pob = this.pob
    try {
      // withPob starts the engine and loads the player's build.
      await this.withPob(async () => {
        this.pobVersion = (await pob.ping()).version ?? null
      })
      this.pobError = null
    } catch (err) {
      this.pobError = err instanceof Error ? err.message : String(err)
    }
    this.emitStatus()
  }

  /**
   * Run an engine operation in the queue. Starts the engine if needed and, after a
   * (re)start, loads the player's active build first, so a crash never leaves the
   * engine on an empty build.
   */
  private withPob<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      const pob = this.pob
      if (pob) {
        await pob.start()
        if (pob.startCount !== this.loadedGeneration) {
          await this.loadActiveVersion()
          this.loadedGeneration = pob.startCount
        }
      }
      return fn()
    }
    const next = this.pobQueue.then(run, run)
    this.pobQueue = next.catch(() => undefined)
    return next
  }

  /** Put the player's active build back in the engine (or an empty build). Call inside withPob. */
  private async loadActiveVersion(): Promise<void> {
    const versionId = this.activeVersionId()
    const version = versionId !== null ? this.builds.getVersion(versionId) : null
    if (version) await this.pob!.loadCode(version.pobCode)
    else await this.pob!.newBuild()
  }

  /** Current softcore challenge league from poe.ninja, or null when unreachable. */
  private async pickLeague(): Promise<string | null> {
    try {
      const leagues = await this.pricing.leagues()
      // poe.ninja lists the current challenge league first.
      const sc = leagues.find((l) => !/^(HC |Hardcore|SSF|Standard)/i.test(l.name))
      return sc?.id ?? 'Standard'
    } catch {
      return null
    }
  }

  private activeBuild(): ActiveBuildDTO | null {
    const id = this.activeVersionId()
    const v = id !== null ? this.builds.getVersion(id) : null
    if (!v) return null
    return {
      buildId: v.buildId,
      name: v.buildName,
      versionId: v.id,
      versionLabel: v.label,
      versionCount: this.builds.versionsOf(v.buildId).length
    }
  }

  private activeVersionId(): number | null {
    const v = this.getSetting('activeBuildVersionId')
    return v ? Number(v) : null
  }

  private activePresetId(): number | null {
    const v = this.getSetting('activePresetId')
    return v ? Number(v) : null
  }

  private emitStatus(): void {
    if (this.stopped) return
    this.emit('status', this.status())
  }

  private getSetting(key: string): string | null {
    const row = this.database.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  private setSetting(key: string, value: string): void {
    this.database.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  private deleteSetting(key: string): void {
    this.database.db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  }
}

function toDTO(r: Run | StoredRun, endReason: string | null): RunDTO {
  return {
    id: r.id,
    areaId: r.areaId,
    areaName: r.areaName,
    areaLevel: r.areaLevel,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt ? r.endedAt.toISOString() : null,
    activeMs: r.activeMs,
    deaths: r.deaths,
    reentries: r.reentries,
    endReason,
    ...('kind' in r ? { kind: r.kind, outcome: r.outcome } : {})
  }
}

interface StoredGuide {
  code: string
  name: string
  importedAt: string
  info: BuildSnapshotDTO['info']
  stats: Record<string, number>
  items: DetailedItem[]
  tree?: TreeDetail
  skills?: SkillGroup[]
}

function toSessionDTO(s: SessionSummary): SessionSummaryDTO {
  const { session, ...rest } = s
  return {
    id: session.id,
    mode: session.mode,
    targetCount: session.targetCount,
    bossName: session.bossName,
    activity: session.activity,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt ? session.endedAt.toISOString() : null,
    ...rest
  }
}

function toProfitDTO(s: ProfitSummary): ProfitSummaryDTO {
  return {
    runs: s.runs,
    activeMs: s.activeMs,
    invested: s.invested,
    looted: s.looted,
    profit: s.profit,
    profitPerHour: s.profitPerHour,
    runsWithLoot: s.runsWithLoot
  }
}

function defaultBuildName(snap: BuildSnapshotDTO): string {
  const cls = snap.info.ascendancy && snap.info.ascendancy !== 'None' ? snap.info.ascendancy : snap.info.className
  return [snap.info.mainSkill, cls].filter(Boolean).join(' ') || 'My build'
}

/** Item name from copied text: the line after "Rarity: …". */
function firstItemName(itemText: string): string {
  const lines = itemText.split('\n').map((l) => l.trim())
  const i = lines.findIndex((l) => l.startsWith('Rarity:'))
  return (i >= 0 ? lines[i + 1] : undefined) || 'item'
}

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
