import { existsSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { AppDatabase } from '../core/db/Database'
import { RunRepository, type StoredRun } from '../core/db/RunRepository'
import { SqlitePriceCache } from '../core/db/SqlitePriceCache'
import { LogTailer } from '../core/logs/LogTailer'
import { findClientLog } from '../core/logs/findClientLog'
import { parseLine } from '../core/logs/parseLine'
import { PobBridge, type PobBridgeOptions } from '../core/pob/PobBridge'
import { PoeNinjaClient } from '../core/pricing/PoeNinjaClient'
import { RunTracker, type Run } from '../core/runs/RunTracker'
import type { AppStatus, BuildSnapshotDTO, ItemComparisonDTO, PriceDTO, Result, RunDTO } from '../shared/ipc'

/** Wires the core modules together. No Electron imports here, so it stays testable. */
export class TrackerService extends EventEmitter {
  private readonly database: AppDatabase
  private readonly runs: RunRepository
  private readonly tracker = new RunTracker()
  private readonly pricing: PoeNinjaClient
  private readonly pob: PobBridge | null
  private tailer: LogTailer | null = null
  private clientLogPath: string | null = null
  private tickTimer: NodeJS.Timeout | null = null
  private pobVersion: string | null = null
  private pobError: string | null = null

  constructor(opts: { dbPath: string; pob: Omit<PobBridgeOptions, 'onLog'> | null; log?: (msg: string) => void }) {
    super()
    this.database = new AppDatabase(opts.dbPath)
    this.runs = new RunRepository(this.database.db)
    this.pricing = new PoeNinjaClient({ cache: new SqlitePriceCache(this.database.db) })
    this.pob = opts.pob ? new PobBridge({ ...opts.pob, onLog: (l) => opts.log?.(`[pob] ${l}`) }) : null
    if (!opts.pob) this.pobError = 'Path of Building engine not installed (run `npm run setup:pob`)'

    this.tracker.on((e) => {
      if (e.type === 'run_completed') this.runs.upsert(e.run, { endReason: e.reason })
      else this.runs.upsert(e.run)
      this.emitStatus()
    })
  }

  async start(): Promise<void> {
    const override = process.env.POE2_CLIENT_LOG
    const saved = this.getSetting('clientLogPath')
    const path = override && existsSync(override) ? override : saved && existsSync(saved) ? saved : findClientLog()
    if (path) await this.watchLog(path)
    this.tickTimer = setInterval(() => this.tracker.tick(new Date()), 30_000)
    // Warm up PoB in the background; it takes a few seconds to load.
    void this.startPob()
  }

  async stop(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer)
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
    this.tailer = new LogTailer(path, (line) => {
      const event = parseLine(line)
      if (event) this.tracker.handle(event)
    }, { replayBytes: 64 * 1024 })
    await this.tailer.start()
    this.emitStatus()
  }

  endCurrentRun(): void {
    this.tracker.endCurrentRun(new Date())
  }

  status(): AppStatus {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const current = this.tracker.getCurrentRun()
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
      today: this.runs.statsSince(startOfDay)
    }
  }

  recentRuns(limit = 50): RunDTO[] {
    return this.runs.recent(limit).map((r) => toDTO(r, r.endReason))
  }

  async importBuild(code: string): Promise<Result<BuildSnapshotDTO>> {
    if (!this.pob) return { ok: false, error: this.pobError ?? 'PoB unavailable' }
    return wrap(() => this.pob!.loadCode(code.trim()))
  }

  async compareItem(itemText: string): Promise<Result<ItemComparisonDTO>> {
    if (!this.pob) return { ok: false, error: this.pobError ?? 'PoB unavailable' }
    return wrap(() => this.pob!.compareItem(itemText))
  }

  async prices(league: string, type: string): Promise<Result<PriceDTO[]>> {
    return wrap(() => this.pricing.prices(league, type))
  }

  private async startPob(): Promise<void> {
    if (!this.pob) return
    try {
      await this.pob.start()
      this.pobVersion = (await this.pob.ping()).version ?? null
      // Start with an empty build so item comparison works before any import.
      await this.pob.newBuild()
      this.pobError = null
    } catch (err) {
      this.pobError = err instanceof Error ? err.message : String(err)
    }
    this.emitStatus()
  }

  private emitStatus(): void {
    this.emit('status', this.status())
  }

  private getSetting(key: string): string | null {
    const row = this.database.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  private setSetting(key: string, value: string): void {
    this.database.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
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

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
