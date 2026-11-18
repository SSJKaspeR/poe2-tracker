import type { LogEvent } from '../logs/parseLine'
import { classifyArea, isSafeZone } from '../logs/areas'

/**
 * Waystone run tracker — multi-signal state machine.
 *
 *   idle ──(map generated)──▶ running ──(hideout/town)──▶ pending_end
 *                                ▲                            │
 *                                └──(same map instance)───────┤
 *                                                             ├─(another map)──▶ completes, new run
 *                                                             ├─(timeout)───────▶ completes
 *                                                             └─(game restart)──▶ completes
 *
 * A map instance is identified by (areaId, seed). Time spent outside the map
 * (hideout, town) is not counted in `activeMs`.
 */

export type RunState = 'idle' | 'running' | 'pending_end'

export interface Run {
  id: string
  areaId: string
  areaName: string | null
  areaLevel: number
  seed: number
  instanceIp: string | null
  startedAt: Date
  endedAt: Date | null
  /** Time actually spent inside the map instance. */
  activeMs: number
  deaths: number
  /** Number of times the player went back into the map (portals). */
  reentries: number
}

export type RunTrackerEvent =
  | { type: 'run_started'; run: Run }
  | { type: 'run_paused'; run: Run }
  | { type: 'run_resumed'; run: Run }
  | { type: 'run_completed'; run: Run; reason: 'new_map' | 'timeout' | 'game_restart' | 'manual' }
  | { type: 'run_updated'; run: Run }

export interface RunTrackerOptions {
  /** Close a paused run after this long outside the map. Default 10 min. */
  pendingTimeoutMs?: number
  /**
   * Also track non-map, non-safe areas as runs (pinnacle boss arenas, whose area ids
   * are not known yet). Used in Boss sessions. Default false.
   */
  trackOtherAreas?: boolean
  /** Only count deaths of these characters (case-insensitive). Empty = count every death. */
  characterNames?: string[]
  idFactory?: () => string
}

let idCounter = 0
const defaultId = () => `run_${Date.now().toString(36)}_${(idCounter++).toString(36)}`

export class RunTracker {
  private state: RunState = 'idle'
  private current: Run | null = null
  /** When the player last entered the current map instance (while running). */
  private segmentStart: Date | null = null
  /** When the player left the map (while pending_end). */
  private leftAt: Date | null = null
  private lastIp: string | null = null
  /** Set when an area was just generated, so the next "You have entered" can be attributed. */
  private awaitingNameFor: { areaId: string; seed: number } | null = null
  private trackOtherAreas: boolean
  private readonly pendingTimeoutMs: number
  private readonly characterNames: Set<string>
  private readonly idFactory: () => string
  private readonly listeners = new Set<(e: RunTrackerEvent) => void>()

  constructor(opts: RunTrackerOptions = {}) {
    this.pendingTimeoutMs = opts.pendingTimeoutMs ?? 10 * 60 * 1000
    this.trackOtherAreas = opts.trackOtherAreas ?? false
    this.characterNames = new Set((opts.characterNames ?? []).map((n) => n.toLowerCase()))
    this.idFactory = opts.idFactory ?? defaultId
  }

  on(listener: (e: RunTrackerEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState(): RunState {
    return this.state
  }

  getCurrentRun(): Run | null {
    return this.current ? { ...this.current } : null
  }

  /** Start of the segment currently being played inside the map (null when paused or idle). */
  getSegmentStart(): Date | null {
    return this.state === 'running' ? this.segmentStart : null
  }

  setTrackOtherAreas(on: boolean): void {
    this.trackOtherAreas = on
  }

  setCharacterNames(names: string[]): void {
    this.characterNames.clear()
    for (const n of names) this.characterNames.add(n.toLowerCase())
  }

  /** Feed one parsed log event. */
  handle(event: LogEvent): void {
    // Any event carries time: use it to expire a stale pending run first.
    this.checkTimeout(event.time)

    switch (event.type) {
      case 'log_opened':
        if (this.current) this.complete(event.time, 'game_restart', this.leftAt ?? event.time)
        this.lastIp = null
        break

      case 'instance_connect':
        this.lastIp = event.ip
        break

      case 'area_generated':
        this.onAreaGenerated(event.areaId, event.areaLevel, event.seed, event.time)
        break

      case 'area_entered':
        if (this.awaitingNameFor && this.current &&
            this.awaitingNameFor.areaId === this.current.areaId &&
            this.awaitingNameFor.seed === this.current.seed &&
            this.current.areaName === null) {
          this.current.areaName = event.areaName
          this.emit({ type: 'run_updated', run: { ...this.current } })
        }
        this.awaitingNameFor = null
        break

      case 'player_slain':
        if (this.state === 'running' && this.current && this.isOwnCharacter(event.name)) {
          this.current.deaths += 1
          this.emit({ type: 'run_updated', run: { ...this.current } })
        }
        break

      default:
        break
    }
  }

  /** Call periodically (e.g. every 30 s) so a paused run closes even without new log lines. */
  tick(now: Date): void {
    this.checkTimeout(now)
  }

  /** User-triggered end of the current run. */
  endCurrentRun(now: Date): Run | null {
    if (!this.current) return null
    const end = this.state === 'pending_end' && this.leftAt ? this.leftAt : now
    return this.complete(now, 'manual', end)
  }

  private onAreaGenerated(areaId: string, areaLevel: number, seed: number, time: Date): void {
    const kind = classifyArea(areaId)
    this.awaitingNameFor = { areaId, seed }

    if (kind === 'map' || (kind === 'other' && this.trackOtherAreas)) {
      if (this.current && this.current.areaId === areaId && this.current.seed === seed) {
        // Back into the same instance (portal).
        if (this.state === 'pending_end') {
          this.state = 'running'
          this.segmentStart = time
          this.leftAt = null
          this.current.reentries += 1
          this.emit({ type: 'run_resumed', run: { ...this.current } })
        }
        return
      }
      if (this.current) {
        this.complete(time, 'new_map', this.state === 'pending_end' && this.leftAt ? this.leftAt : time)
      }
      this.start(areaId, areaLevel, seed, time)
      return
    }

    if (isSafeZone(kind)) {
      if (this.state === 'running' && this.current) {
        this.closeSegment(time)
        this.state = 'pending_end'
        this.leftAt = time
        this.emit({ type: 'run_paused', run: { ...this.current } })
      }
      return
    }

    // 'other' (campaign zone, trial, unknown content): leaving the map for
    // something that isn't a safe zone ends the run.
    if (this.current) {
      this.complete(time, 'new_map', this.state === 'pending_end' && this.leftAt ? this.leftAt : time)
    }
  }

  private start(areaId: string, areaLevel: number, seed: number, time: Date): void {
    this.current = {
      id: this.idFactory(),
      areaId,
      areaName: null,
      areaLevel,
      seed,
      instanceIp: this.lastIp,
      startedAt: time,
      endedAt: null,
      activeMs: 0,
      deaths: 0,
      reentries: 0
    }
    this.state = 'running'
    this.segmentStart = time
    this.leftAt = null
    this.emit({ type: 'run_started', run: { ...this.current } })
  }

  private closeSegment(time: Date): void {
    if (this.current && this.segmentStart) {
      this.current.activeMs += Math.max(0, time.getTime() - this.segmentStart.getTime())
    }
    this.segmentStart = null
  }

  private complete(
    _now: Date,
    reason: 'new_map' | 'timeout' | 'game_restart' | 'manual',
    endedAt: Date
  ): Run | null {
    if (!this.current) return null
    if (this.state === 'running') this.closeSegment(endedAt)
    const run: Run = { ...this.current, endedAt }
    this.current = null
    this.state = 'idle'
    this.segmentStart = null
    this.leftAt = null
    this.emit({ type: 'run_completed', run, reason })
    return run
  }

  private checkTimeout(now: Date): void {
    if (this.state === 'pending_end' && this.leftAt &&
        now.getTime() - this.leftAt.getTime() >= this.pendingTimeoutMs) {
      this.complete(now, 'timeout', this.leftAt)
    }
  }

  private isOwnCharacter(name: string): boolean {
    return this.characterNames.size === 0 || this.characterNames.has(name.toLowerCase())
  }

  private emit(e: RunTrackerEvent): void {
    for (const l of this.listeners) l(e)
  }
}
