// Types shared between the main process, the preload script and the renderer.
// Dates cross the IPC boundary as ISO strings. Currency values are in Divine Orbs.

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
  kind?: 'map' | 'boss'
  outcome?: 'kill' | 'fail' | null
}

export type TrackerState = 'idle' | 'running' | 'pending_end'

export interface ProfitSummaryDTO {
  runs: number
  activeMs: number
  invested: number
  looted: number
  profit: number
  profitPerHour: number | null
  runsWithLoot: number
}

export interface ActiveBuildDTO {
  buildId: number
  name: string
  versionId: number
  versionLabel: string | null
  versionCount: number
}

export interface AppStatus {
  clientLogPath: string | null
  logWatching: boolean
  pob: { available: boolean; running: boolean; version: string | null; error: string | null }
  trackerState: TrackerState
  currentRun: RunDTO | null
  /** When the player last entered the current map; add (now - this) to activeMs for a live timer. */
  segmentStartedAt: string | null
  today: { runs: number; activeMs: number; deaths: number }
  todayProfit: ProfitSummaryDTO
  build: ActiveBuildDTO | null
  league: string | null
  prices: {
    count: number
    exaltedPerDivine: number | null
    error: string | null
    /** HTTP requests actually sent to poe.ninja (a fresh cache sends none; a 304 counts as one). */
    requestsLastHour: number
    requestsLast24h: number
  }
  activePresetId: number | null
  autoApplyPreset: boolean
  clipboardWatch: boolean
  session: SessionSummaryDTO | null
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
  /** Raw item text, so the UI can equip it. */
  itemText?: string
}

export interface VersionPerformanceDTO {
  versionId: number
  label: string | null
  createdAt: string
  runs: number
  activeMs: number
  deaths: number
  profit: ProfitSummaryDTO
}

export interface RunDetailDTO extends RunDTO {
  strategyName: string | null
  versionLabel: string | null
  invested: number
  looted: number
  hasLoot: boolean
}

export interface BuildVersionDTO {
  versionId: number
  label: string | null
  createdAt: string
  /** Stats as computed by PoB when the version was saved. */
  stats: StatMap | null
  performance: { runs: number; activeMs: number; deaths: number; profit: ProfitSummaryDTO }
}

export interface GearFindingDTO {
  kind: string
  level: 'easy' | 'upgrade' | 'info'
  message: string
}

export interface GearCheckDTO {
  slot: string
  name: string
  rarity: string
  findings: GearFindingDTO[]
}

export interface GuideModGapDTO {
  text: string
  want: number
  have: number | null
}

export interface GuideSlotDTO {
  slot: string
  guide: { name: string; rarity: string; base?: string; title?: string } | null
  player: { name: string; rarity: string; base?: string; title?: string } | null
  status: 'match' | 'close' | 'missing_unique' | 'different' | 'empty' | 'not_in_guide'
  missing: GuideModGapDTO[]
  lower: GuideModGapDTO[]
  /** What equipping the guide item would change on the player's build (PoB). */
  impact: Record<string, { before: number; after: number; delta: number }> | null
  impactScore: number
  /** poe.ninja price of the guide unique when the player doesn't have it. */
  uniquePrice: number | null
}

export interface GuideNodeDTO {
  id: number
  name: string
  kind: 'keystone' | 'notable' | 'normal' | 'ascendancy' | 'jewel'
  /** What allocating this guide node would change on the player's build (PoB). */
  impact?: Record<string, { before: number; after: number; delta: number }> | null
  impactScore?: number
}

export interface GuideTreeSideDTO {
  keystones: GuideNodeDTO[]
  notables: GuideNodeDTO[]
  ascendancy: GuideNodeDTO[]
  jewels: number
  normal: number
}

export interface GuideTreeDTO {
  playerPoints: number
  guidePoints: number
  sameAscendancy: boolean
  playerAscendancy?: string
  guideAscendancy?: string
  missing: GuideTreeSideDTO
  extra: GuideTreeSideDTO
  coverage: number
}

export interface GuideSkillDTO {
  skill: string
  status: 'match' | 'partial' | 'missing'
  guideLevel: number
  playerLevel: number | null
  guideQuality: number
  playerQuality: number | null
  missingSupports: string[]
  extraSupports: string[]
}

export interface GuideComparisonDTO {
  guideName: string
  importedAt: string
  guideInfo: { className?: string; ascendancy?: string; level?: number; mainSkill?: string }
  stats: { key: string; player: number; guide: number }[]
  slots: GuideSlotDTO[]
  /** Null for guides saved before tree/gem support: re-import the guide. */
  tree: GuideTreeDTO | null
  skills: { skills: GuideSkillDTO[]; extraSkills: string[] } | null
}

export interface TradeWeightsDTO {
  slot: string
  category?: string
  /** PoB's suggested minimum weighted sum (≈ your current item): results are upgrades. */
  minWeight?: number
  base?: string
  weights: { tradeId: string; text: string; weight: number; score: number; typical: number }[]
}

export interface TradePreviewDTO {
  slot: string
  lines: string[]
  diff: Record<string, { before: number; after: number; delta: number }>
}

export interface PriceDTO {
  id: string
  name: string
  value: number
  currency: string
}

export type InvestmentKind = 'waystone' | 'tablet' | 'currency' | 'other'

export interface PresetItemDTO {
  kind: InvestmentKind
  label: string
  itemId?: string
  quantity: number
  manualValue?: number
}

export interface PresetDTO {
  id: number
  name: string
  items: PresetItemDTO[]
  costPerMap: number
  unpriced: string[]
}

export interface RunLinesDTO {
  runId: string
  kind: 'map' | 'boss'
  outcome: 'kill' | 'fail' | null
  strategyId: number | null
  investments: { id: number; label: string; quantity: number; unitValue: number | null }[]
  loot: { id: number; label: string; quantity: number; unitValue: number | null }[]
}

export type SessionMode = 'maps' | 'boss' | 'hideout'

export interface StartSessionDTO {
  mode: SessionMode
  targetCount?: number | null
  bossName?: string | null
  activity?: 'stash' | 'craft' | null
}

export interface SessionSummaryDTO {
  id: number
  mode: SessionMode
  targetCount: number | null
  bossName: string | null
  activity: 'stash' | 'craft' | null
  startedAt: string
  endedAt: string | null
  durationMs: number
  runs: number
  completedRuns: number
  runActiveMs: number
  deaths: number
  kills: number
  fails: number
  invested: number
  looted: number
  spent: number
  gained: number
  profit: number
  profitPerHour: number | null
  hasEconomy: boolean
  objectiveReached: boolean
}

export interface SessionLineDTO {
  id: number
  direction: 'spent' | 'gained'
  label: string
  quantity: number
  unitValue: number | null
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface TrackerApi {
  getStatus(): Promise<AppStatus>
  getRecentRuns(limit?: number): Promise<RunDTO[]>
  chooseClientLog(): Promise<AppStatus>
  endCurrentRun(): Promise<AppStatus>

  // Build
  getBuildSnapshot(): Promise<Result<BuildSnapshotDTO | null>>
  importBuild(code: string, opts: { newBuild: boolean; name?: string }): Promise<Result<BuildSnapshotDTO>>
  compareItem(itemText: string): Promise<Result<ItemComparisonDTO>>
  equipItem(itemText: string): Promise<Result<BuildSnapshotDTO>>
  getVersionPerformance(): Promise<VersionPerformanceDTO[]>
  /** Versions of the active build, newest first, with stats and results. */
  getBuildVersions(): Promise<BuildVersionDTO[]>
  /** Easy wins left on equipped items (empty sockets, open modifiers, old bases…). */
  getGearCheck(): Promise<Result<GearCheckDTO[]>>
  /** Guide build to compare against (PoB code from a build guide). One per build. */
  setGuideBuild(code: string, name?: string): Promise<Result<GuideComparisonDTO>>
  clearGuideBuild(): Promise<void>
  getGuideComparison(): Promise<Result<GuideComparisonDTO | null>>
  /** Trade upgrade search: PoB weights for a slot, and what chosen stats would give. */
  getTradeWeights(slot: string): Promise<Result<TradeWeightsDTO>>
  previewTradeItem(slot: string, mods: { tradeId: string; text: string; value: number }[]): Promise<Result<TradePreviewDTO>>
  /** Completed runs with economy; `sinceDays` null = all time. */
  getRunsDetailed(sinceDays: number | null): Promise<RunDetailDTO[]>
  setClipboardWatch(on: boolean): Promise<AppStatus>
  onItemCompared(listener: (r: Result<ItemComparisonDTO>) => void): () => void

  // Economy
  searchPrices(query: string): Promise<PriceDTO[]>
  getPresets(): Promise<PresetDTO[]>
  savePreset(preset: { id?: number; name: string; items: PresetItemDTO[] }): Promise<PresetDTO[]>
  deletePreset(id: number): Promise<PresetDTO[]>
  setActivePreset(id: number | null, autoApply: boolean): Promise<AppStatus>
  getRunLines(runId: string): Promise<RunLinesDTO>
  applyPresetToRun(runId: string, presetId: number): Promise<RunLinesDTO>
  addLoot(runId: string, item: { label: string; itemId?: string; quantity: number; manualValue?: number }): Promise<RunLinesDTO>
  removeLine(runId: string, kind: 'loot' | 'investment', lineId: number): Promise<RunLinesDTO>
  refreshPrices(): Promise<AppStatus>

  // Sessions
  startSession(s: StartSessionDTO): Promise<AppStatus>
  endSession(): Promise<AppStatus>
  getSessions(): Promise<SessionSummaryDTO[]>
  setRunOutcome(runId: string, outcome: 'kill' | 'fail' | null): Promise<RunLinesDTO>
  getSessionLines(sessionId: number): Promise<SessionLineDTO[]>
  addSessionLine(
    sessionId: number,
    line: { direction: 'spent' | 'gained'; label: string; itemId?: string; quantity: number; manualValue?: number }
  ): Promise<SessionLineDTO[]>
  removeSessionLine(sessionId: number, lineId: number): Promise<SessionLineDTO[]>

  onStatusChanged(listener: (status: AppStatus) => void): () => void
}
