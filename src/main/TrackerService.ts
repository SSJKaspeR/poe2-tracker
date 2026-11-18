import { existsSync } from 'node:fs'
import { EventEmitter } from 'node:events'
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
import type {
  ActiveBuildDTO,
  AppStatus,
  BuildSnapshotDTO,
  BuildVersionDTO,
  ItemComparisonDTO,
  PresetDTO,
  PresetItemDTO,
  PriceDTO,
  ProfitSummaryDTO,
  Result,
  RunDTO,
  RunDetailDTO,
  RunLinesDTO,
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

  constructor(opts: {
    dbPath: string
    pob: Omit<PobBridgeOptions, 'onLog'> | null
    log?: (msg: string) => void
    pricing?: PoeNinjaClient
  }) {
    super()
    this.database = new AppDatabase(opts.dbPath)
    this.runs = new RunRepository(this.database.db)
    this.builds = new BuildRepository(this.database.db)
    this.economy = new Economy(this.database.db, () => this.priceBook)
    this.pricing = opts.pricing ?? new PoeNinjaClient({ cache: new SqlitePriceCache(this.database.db) })
    this.pob = opts.pob ? new PobBridge({ ...opts.pob, onLog: (l) => opts.log?.(`[pob] ${l}`) }) : null
    if (!opts.pob) this.pobError = 'Path of Building engine not installed (run `npm run setup:pob`)'

    this.tracker.on((e) => {
      if (e.type === 'run_started') {
        this.runs.upsert(e.run, { buildVersionId: this.activeVersionId() })
        const presetId = this.activePresetId()
        if (presetId !== null && this.getSetting('autoApplyPreset') === '1') {
          try {
            this.economy.applyPreset(e.run.id, presetId)
          } catch (err) {
            opts.log?.(`auto-apply preset failed: ${String(err)}`)
          }
        }
      } else if (e.type === 'run_completed') {
        this.runs.upsert(e.run, { endReason: e.reason })
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
    this.timers.push(setInterval(() => this.tracker.tick(new Date()), 30_000))
    this.timers.push(setInterval(() => void this.refreshPrices(), PRICE_REFRESH_MS))
    // Slow work in the background: PoB loads in a few seconds, prices need the network.
    this.pobReady = this.startPob()
    void this.refreshPrices()
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t)
    const current = this.tracker.endCurrentRun(new Date())
    if (current) this.runs.upsert(current, { endReason: 'manual' })
    await this.tailer?.stop()
    await this.pob?.stop()
    this.database.close()
  }

  async watchLog(path: string): Promise<void> {
    await this.tailer?.stop()
    this.clientLogPath = path
    this.setSetting('clientLogPath', path)
    // Replay the tail so a run in progress at app start is picked up.
    this.tailer = new LogTailer(
      path,
      (line) => {
        const event = parseLine(line)
        if (event) this.tracker.handle(event)
      },
      { replayBytes: 64 * 1024 }
    )
    await this.tailer.start()
    this.emitStatus()
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
        error: this.priceError
      },
      activePresetId: this.activePresetId(),
      autoApplyPreset: this.getSetting('autoApplyPreset') === '1',
      clipboardWatch: this.getSetting('clipboardWatch') !== '0'
    }
  }

  recentRuns(limit = 50): RunDTO[] {
    return this.runs.recent(limit).map((r) => toDTO(r, r.endReason))
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  async buildSnapshot(): Promise<Result<BuildSnapshotDTO | null>> {
    if (!this.pob || this.activeVersionId() === null) return { ok: true, value: null }
    await this.pobReady
    return wrap(() => this.pob!.stats())
  }

  async importBuild(code: string, opts: { newBuild: boolean; name?: string }): Promise<Result<BuildSnapshotDTO>> {
    if (!this.pob) return { ok: false, error: this.pobError ?? 'PoB unavailable' }
    await this.pobReady
    const res = await wrap(() => this.pob!.loadCode(code.trim()))
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
    const res = await wrap(() => this.pob!.compareItem(itemText))
    return res.ok ? { ok: true, value: { ...res.value, itemText } } : res
  }

  /** Item copied in game: compare it and push the result to the UI. */
  async onCopiedItem(itemText: string): Promise<void> {
    if (this.getSetting('clipboardWatch') === '0') return
    this.emit('item-compared', await this.compareItem(itemText))
  }

  /** Equip an item for real: becomes a new version of the active build. */
  async equipItem(itemText: string): Promise<Result<BuildSnapshotDTO>> {
    if (!this.pob) return { ok: false, error: this.pobError ?? 'PoB unavailable' }
    const active = this.activeBuild()
    if (!active) return { ok: false, error: 'Import your build first' }
    await this.pobReady
    const res = await wrap(async () => {
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
    })
    this.emitStatus()
    return res
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

  async refreshPrices(): Promise<void> {
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
      this.priceError = failures === jobs.length ? 'poe.ninja unreachable' : null
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
    return { runId, strategyId: l.strategyId, investments: l.investments.map(map), loot: l.loot.map(map) }
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
    try {
      await this.pob.start()
      this.pobVersion = (await this.pob.ping()).version ?? null
      const versionId = this.activeVersionId()
      const version = versionId !== null ? this.builds.getVersion(versionId) : null
      if (version) await this.pob.loadCode(version.pobCode)
      else await this.pob.newBuild()
      this.pobError = null
    } catch (err) {
      this.pobError = err instanceof Error ? err.message : String(err)
    }
    this.emitStatus()
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
    endReason
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
