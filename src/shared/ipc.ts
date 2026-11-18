// Types shared between the main process, the preload script and the renderer.
// Dates cross the IPC boundary as ISO strings.

export interface RunDTO {
  id: string
  areaId: string
  areaName: string | null
  areaLevel: number
  startedAt: string
  endedAt: string | null
  activeMs: number
  deaths: number
  reentries: number
  endReason: string | null
}

export type TrackerState = 'idle' | 'running' | 'pending_end'

export interface AppStatus {
  clientLogPath: string | null
  logWatching: boolean
  pob: { available: boolean; running: boolean; version: string | null; error: string | null }
  trackerState: TrackerState
  currentRun: RunDTO | null
  /** When the player last entered the current map; add (now - this) to activeMs for a live timer. */
  segmentStartedAt: string | null
  today: { runs: number; activeMs: number; deaths: number }
}

export type StatMap = Record<string, number>

export interface BuildSnapshotDTO {
  info: { className?: string; ascendancy?: string; level?: number; mainSkill?: string }
  stats: StatMap
  items?: { slot: string; name: string; rarity: string; base?: string }[]
}

export interface ItemComparisonDTO {
  slot: string
  item: { name: string; rarity: string; base?: string }
  before: StatMap
  after: StatMap
  diff: Record<string, { before: number; after: number; delta: number }>
}

export interface PriceDTO {
  id: string
  name: string
  value: number
  currency: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface TrackerApi {
  getStatus(): Promise<AppStatus>
  getRecentRuns(limit?: number): Promise<RunDTO[]>
  chooseClientLog(): Promise<AppStatus>
  endCurrentRun(): Promise<AppStatus>
  importBuild(code: string): Promise<Result<BuildSnapshotDTO>>
  compareItem(itemText: string): Promise<Result<ItemComparisonDTO>>
  getPrices(league: string, type: string): Promise<Result<PriceDTO[]>>
  onStatusChanged(listener: (status: AppStatus) => void): () => void
}
