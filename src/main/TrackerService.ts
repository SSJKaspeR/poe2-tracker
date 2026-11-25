import { checkClipboard, DEFAULT_HOTKEY, hotkeyLabel, type ClipboardCheck } from '../core/clipboard/compareHotkey'
import { existsSync, readFileSync, statSync } from 'node:fs'
import axios from 'axios'
import { itemVerdict, summarizeImpact } from '../shared/impact'
import { resolveBuildCode, type FetchText } from '../core/pob/buildSource'
import { computeVerdicts, type VerdictBuild } from '../core/verdicts/verdicts'
import { formatCurrency } from '../renderer/src/format'
import { guessActiveFilter, listFilters, poe2DocumentsDirs } from '../core/filter/findLootFilter'
import { hiddenValuable, parseFilter, type ParsedFilter } from '../core/filter/LootFilter'
import { EventEmitter } from 'node:events'
import { checkGear } from '../core/build/gearCheck'
import { pointsSummary, rankSupports, rankSupportSwaps, rankTree, swapCandidates } from '../core/build/optimisations'
import { goodItemMods, itemSheets, rankRuneOptions, rankSlots, defensiveLines, type SlotPreview } from '../core/build/gearAdvice'
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
  RuneAdviceDTO,
  OptimisationsDTO,
  ItemSheetDTO,
  UpgradePriorityDTO,
  VerdictDTO,
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
  private priorityCache: { versionId: number; value: UpgradePriorityDTO[] } | null = null
  private optimisationCache: { versionId: number; value: OptimisationsDTO } | null = null
  private stopped = false
  private readonly filterDirs: string[]
  private readonly logFn?: (msg: string) => void
  private readonly fetchText: FetchText
  /** Set by the main process when the hotkey can't be registered (taken by another app). */
  hotkeyError: string | null = null
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
    /** Downloads a build code from a sharing site (faked in tests). */
    fetchText?: FetchText
  }) {
    super()
    const ua = opts.userAgent ?? 'PoE2Tracker (+https://github.com/SSJKaspeR/poe2-tracker)'
    this.fetchText =
      opts.fetchText ??
      (async (url) =>
        (
          await axios.get<string>(url, {
            responseType: 'text',
            timeout: 15_000,
            maxContentLength: 2_000_000,
            headers: { 'User-Agent': ua }
          })
        ).data)
    this.logFn = opts.log
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
      compareHotkey: {
        accelerator: this.getCompareHotkey(),
        label: hotkeyLabel(this.getCompareHotkey()),
        error: this.hotkeyError
      },
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

  /** Import the player's build from a PoB code or a build link (pobb.in, poe.ninja, Maxroll…). */
  async importBuild(input: string, opts: { newBuild: boolean; name?: string }): Promise<Result<BuildSnapshotDTO>> {
    if (!this.pob) return { ok: false, error: this.pobError ?? 'PoB unavailable' }
    const resolved = await wrap(() => resolveBuildCode(input, this.fetchText))
    if (!resolved.ok) return resolved
    const code = resolved.value
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
    if (!res.ok) return res
    const impact = summarizeImpact(res.value.diff, res.value.before)
    return {
      ok: true,
      value: { ...res.value, itemText, impact: impact.lines, verdict: itemVerdict(impact, this.recentDeathRate()) }
    }
  }

  /** Share of maps with a death over the last 30 days (null below 8 maps: not enough to judge). */
  recentDeathRate(): number | null {
    const since = new Date(Date.now() - 30 * 24 * 3600_000)
    const maps = this.runs.detailed({ since, limit: 300 }).filter((r) => r.endedAt && r.kind === 'map')
    if (maps.length < 8) return null
    return maps.filter((r) => r.deaths > 0).length / maps.length
  }

  /**
   * The player pressed the compare hotkey: the clipboard was read once (GGG overlay rules).
   * Equipment is compared and pushed to the UI; anything else is reported, so the player
   * knows why nothing happened.
   */
  async onCompareHotkey(clipboardText: string): Promise<ClipboardCheck> {
    const check = checkClipboard(clipboardText)
    if (check === 'gear') this.emit('item-compared', await this.compareItem(clipboardText))
    else this.emit('hotkey-miss', check)
    return check
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

  // ── Verdicts ───────────────────────────────────────────────────────────────

  /**
   * Rule-based observations on the last 30 days of maps and bosses, and on the active
   * build (PoB stats + gear check). Same data, same verdicts: no AI, no network.
   */
  async verdicts(): Promise<VerdictDTO[]> {
    const since = new Date(Date.now() - 30 * 24 * 3600_000)
    const runs = this.runs.detailed({ since, limit: 300 }).map((r) => ({
      areaName: r.areaName,
      areaId: r.areaId,
      areaLevel: r.areaLevel,
      activeMs: r.activeMs,
      deaths: r.deaths,
      ended: r.endedAt !== null,
      kind: r.kind,
      outcome: r.outcome,
      invested: r.invested,
      looted: r.looted,
      hasLoot: r.hasLoot,
      strategyName: r.strategyName,
      versionLabel: r.versionLabel,
      versionId: r.buildVersionId
    }))
    let build: VerdictBuild | null = null
    if (this.pob && this.activeVersionId() !== null) {
      try {
        await this.pobReady
        const snap = await this.withPob(() => this.pob!.stats())
        const gear = await this.gearCheck()
        const points = await wrap(() => this.withPob(() => this.pob!.passivePoints()))
        build = {
          level: snap.info.level ?? null,
          stats: snap.stats,
          points: points.ok ? points.value : undefined,
          easyGearFixes: gear.ok ? gear.value.reduce((a, g) => a + g.findings.filter((f) => f.level === 'easy').length, 0) : 0
        }
      } catch (err) {
        this.logFn?.(`[verdicts] build skipped: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const exalted = this.priceBook.get('exalted')
    const rate = exalted && exalted.value > 0 ? 1 / exalted.value : null
    const out = computeVerdicts({ runs, build, money: (d) => formatCurrency(d, rate) })
    // Optimisations already calculated for this build version (never computed here: it takes seconds).
    const opt = this.optimisationCache?.versionId === this.activeVersionId() ? this.optimisationCache.value : null
    const extra: VerdictDTO[] = []
    const swap = opt?.supports?.swaps[0]
    if (swap && swap.score >= 5) {
      extra.push({
        id: 'build.support-swap',
        area: 'build',
        severity: 'tip',
        title: `Better support: ${swap.add} instead of ${swap.remove}`,
        detail: `${swap.impact.slice(0, 2).map((l) => l.text).join(', ')} according to Path of Building.`,
        tab: 'build'
      })
    }
    const node = opt?.tree.adds[0]
    if (node && node.perPoint >= 2) {
      extra.push({
        id: 'build.next-point',
        area: 'build',
        severity: 'tip',
        title: `Next passive: ${node.name} (${node.cost} point${node.cost > 1 ? 's' : ''})`,
        detail: `${node.impact.slice(0, 2).map((l) => l.text).join(', ')} according to Path of Building.`,
        tab: 'build'
      })
    }
    const rank = { warn: 0, tip: 1, good: 2 } as const
    return [...out, ...extra].sort((a, b) => rank[a.severity] - rank[b.severity])
  }

  // ── Loot filter ────────────────────────────────────────────────────────────

  /**
   * The player's loot filter and the priced items it hides (value never seen on the ground).
   * Only currency-like items (named by base type) are checked: uniques are matched by base,
   * which poe.ninja names don't give.
   */
  lootFilter(minExalted = 1): LootFilterDTO {
    // Nothing is read until the player asks for it (Maps → Loot filter → Analyse).
    if (this.getSetting('lootFilterConsent') !== '1') {
      return { path: null, auto: true, candidates: [], info: null, areaLevel: 80, minExalted, hidden: [], error: null, enabled: false }
    }
    const chosen = this.getSetting('lootFilterPath')
    const candidates = listFilters(this.filterDirs).map((c) => ({ path: c.path, name: c.name, online: c.online }))
    const path = chosen && existsSync(chosen) ? chosen : guessActiveFilter(this.filterDirs)
    const areaLevel = this.runs.recent(1)[0]?.areaLevel ?? 80
    const exalted = this.priceBook.get('exalted')
    const exPerDiv = exalted && exalted.value > 0 ? 1 / exalted.value : null
    const base: LootFilterDTO = {
      enabled: true,
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

  /** Use this filter (null = automatic). Choosing is also the player's go-ahead to read it. */
  setLootFilter(path: string | null): void {
    this.setSetting('lootFilterConsent', '1')
    this.setSetting('lootFilterPath', path ?? '')
    this.parsedFilter = null
  }

  /** Stop reading the loot filter. */
  disableLootFilter(): void {
    this.setSetting('lootFilterConsent', '0')
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
  async setGuideBuild(input: string, name?: string): Promise<Result<GuideComparisonDTO>> {
    if (!this.pob) return { ok: false, error: this.pobError ?? 'PoB unavailable' }
    const active = this.activeBuild()
    if (!active) return { ok: false, error: 'Import your own build first' }
    const resolved = await wrap(() => resolveBuildCode(input, this.fetchText))
    if (!resolved.ok) return resolved
    const code = resolved.value
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
  // ── Gear advice ───────────────────────────────────────────────────────────

  /**
   * Passive tree and support gem suggestions (PoB): best next points per point spent, least
   * useful points, respecs checked as a whole, supports of the main skill and better ones.
   * About 1–3 s per build version (cached).
   */
  async optimisations(): Promise<Result<OptimisationsDTO>> {
    if (!this.pob) return { ok: false, error: this.pobError ?? 'PoB unavailable' }
    const versionId = this.activeVersionId()
    if (versionId === null) return { ok: false, error: 'Import your build first' }
    if (this.optimisationCache?.versionId === versionId) return { ok: true, value: this.optimisationCache.value }
    await this.pobReady
    const res = await wrap(() =>
      this.withPob(async () => {
        const treeData = await this.pob!.treeOptions(5)
        const tree = rankTree(treeData)
        const swaps: OptimisationsDTO['tree']['swaps'] = []
        for (const c of swapCandidates(tree.adds, tree.removes)) {
          const r = await this.pob!.treeSwap(c.add.pathIds, c.remove.ids)
          const imp = summarizeImpact(r.diff, {})
          if (imp.score > 0.5) {
            swaps.push({ remove: c.remove.name, removePoints: c.remove.cost, add: c.add.name, addPoints: c.add.cost, score: imp.score, impact: imp.lines })
          }
        }
        swaps.sort((a, b) => b.score - a.score)

        let supports: OptimisationsDTO['supports'] = null
        try {
          const priceOf = (name: string) => this.priceBook.get(name)?.value ?? null
          const first = await this.pob!.supportOptions([])
          const ranked = rankSupports(first, priceOf)
          const tried = ranked.current.length ? await this.pob!.supportOptions(ranked.candidates.map((c) => c.id)) : first
          const keep = ranked.current.filter((c) => c.note !== null).map((c) => c.name)
          supports = { ...ranked, swaps: rankSupportSwaps(tried, keep) }
        } catch (err) {
          const raw = (err instanceof Error ? err.message : String(err)).replace(/^.*?\.lua:\d+:\s*/, '')
          const error = /no main skill|no active skill/i.test(raw)
            ? 'No skill gem in your main skill group (default attack only): nothing to suggest for supports.'
            : raw
          supports = { skill: null, current: [], candidates: [], swaps: [], error }
        }
        return { tree: { points: pointsSummary(treeData), adds: tree.adds, removes: tree.removes, swaps: swaps.slice(0, 3) }, supports }
      })
    )
    if (res.ok && this.activeVersionId() === versionId) this.optimisationCache = { versionId, value: res.value }
    return res
  }

  /** Every equipped item, line by line, with what each line brings to the build. */
  async itemSheets(): Promise<Result<ItemSheetDTO[]>> {
    if (!this.pob) return { ok: false, error: this.pobError ?? 'PoB unavailable' }
    if (!this.activeBuild()) return { ok: true, value: [] }
    await this.pobReady
    const res = await wrap(() => this.withPob(() => this.pob!.modImpact()))
    return res.ok ? { ok: true, value: itemSheets(res.value) } : res
  }

  /** Best runes / soul cores for every empty socket of the equipped gear, with poe.ninja prices. */
  async runeAdvice(): Promise<Result<RuneAdviceDTO[]>> {
    if (!this.pob) return { ok: false, error: this.pobError ?? 'PoB unavailable' }
    if (!this.activeBuild()) return { ok: true, value: [] }
    await this.pobReady
    const res = await wrap(() => this.withPob(() => this.pob!.runeOptions()))
    if (!res.ok) return res
    return { ok: true, value: rankRuneOptions(res.value, (name) => this.priceBook.get(name)?.value ?? null) }
  }

  /**
   * Which slot to upgrade first: for each equipped slot, PoB builds a good, realistic rare
   * with the stats that help this build most (the trade search weights) and measures the gain.
   * A few seconds per build version (cached). `onProgress` reports slots done / total.
   */
  async upgradePriorities(onProgress?: (done: number, total: number) => void): Promise<Result<UpgradePriorityDTO[]>> {
    if (!this.pob) return { ok: false, error: this.pobError ?? 'PoB unavailable' }
    const versionId = this.activeVersionId()
    if (versionId === null) return { ok: true, value: [] }
    if (this.priorityCache?.versionId === versionId) return { ok: true, value: this.priorityCache.value }
    await this.pobReady
    const audit = await wrap(() => this.withPob(() => this.pob!.auditItems()))
    if (!audit.ok) return audit
    const items = audit.value.items.filter((i) => !/^Flask|^Charm/.test(i.slot))
    const details = await wrap(() => this.withPob(() => this.pob!.itemsDetail()))
    const explicits = new Map(details.ok ? details.value.items.map((d) => [d.slot, d.explicits] as const) : [])
    const previews: SlotPreview[] = []
    const free = new Map<string, number>()
    for (const it of items) free.set(it.slot, Math.max(0, it.affixLimit - it.explicitLines))
    let done = 0
    for (const it of items) {
      onProgress?.(done, items.length)
      const w = await this.tradeWeights(it.slot)
      done++
      if (!w.ok) continue
      // A good realistic rare: your current defences (resistances, life, ES) + the most useful stats.
      const keep = defensiveLines(explicits.get(it.slot) ?? [])
      const mods = goodItemMods(w.value.weights, Math.max(2, 6 - keep.length), keep)
      if (!mods.length) continue
      const p = await wrap(() =>
        this.withPob(() =>
          this.pob!.tradePreview(
            it.slot,
            mods.map((m) => ({ tradeId: m.tradeId, text: m.text, value: m.typical })),
            undefined,
            keep
          )
        )
      )
      if (!p.ok) continue
      const added = p.value.lines.filter((l) => !keep.includes(l))
      previews.push({ slot: it.slot, item: it.name, mods: added, kept: keep, before: {}, diff: p.value.diff })
    }
    onProgress?.(items.length, items.length)
    const value: UpgradePriorityDTO[] = rankSlots(previews).map((p) => ({
      ...p,
      freeAffixes: items.find((i) => i.slot === p.slot && !i.corrupted && !i.mirrored && (i.rarity === 'RARE' || i.rarity === 'MAGIC'))
        ? (free.get(p.slot) ?? 0)
        : 0
    }))
    if (this.activeVersionId() === versionId) this.priorityCache = { versionId, value }
    return { ok: true, value }
  }

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

  /** Compare hotkey (Electron accelerator), null when turned off. */
  getCompareHotkey(): string | null {
    const v = this.getSetting('compareHotkey')
    if (v === null) return this.getSetting('clipboardWatch') === '0' ? null : DEFAULT_HOTKEY // old "Auto" switch
    return v === '' ? null : v
  }

  setCompareHotkey(accelerator: string | null): void {
    this.setSetting('compareHotkey', accelerator ?? '')
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
