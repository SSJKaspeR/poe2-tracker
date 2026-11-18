import type { DatabaseSync } from 'node:sqlite'
import type { PriceBook } from '../pricing/PriceBook'

/**
 * Play sessions with a farming mode:
 *  - maps:    rush N maps
 *  - boss:    pinnacle boss attempts (optionally N attempts)
 *  - hideout: stash sorting or crafting (no maps expected)
 *
 * Session profit/hour uses the whole session time (hideout included), which is
 * the player's real rate, unlike the map-time rate of the runs.
 */

export type SessionMode = 'maps' | 'boss' | 'hideout'

/** Below this duration, hourly rates are noise (a +1 div loot in 30 s = +120 div/h). */
export const MIN_RATE_DURATION_MS = 5 * 60 * 1000
export type HideoutActivity = 'stash' | 'craft'
export type BossOutcome = 'kill' | 'fail'

export interface Session {
  id: number
  mode: SessionMode
  targetCount: number | null
  bossName: string | null
  activity: HideoutActivity | null
  startedAt: Date
  endedAt: Date | null
}

export interface SessionSummary {
  session: Session
  /** Wall-clock duration (to now when still active). */
  durationMs: number
  runs: number
  completedRuns: number
  runActiveMs: number
  deaths: number
  kills: number
  fails: number
  invested: number
  looted: number
  /** Craft / trade lines declared on the session itself. */
  spent: number
  gained: number
  profit: number
  /** Over the whole session duration. Null when nothing is declared or the session is under 5 min. */
  profitPerHour: number | null
  hasEconomy: boolean
  objectiveReached: boolean
}

export interface SessionLine {
  id: number
  direction: 'spent' | 'gained'
  label: string
  itemId: string | null
  quantity: number
  unitValue: number | null
}

interface SessionRow {
  id: number
  mode: SessionMode
  target_count: number | null
  boss_name: string | null
  activity: HideoutActivity | null
  started_at: string
  ended_at: string | null
}

function fromRow(r: SessionRow): Session {
  return {
    id: r.id,
    mode: r.mode,
    targetCount: r.target_count,
    bossName: r.boss_name,
    activity: r.activity,
    startedAt: new Date(r.started_at),
    endedAt: r.ended_at ? new Date(r.ended_at) : null
  }
}

export class SessionRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly prices: () => PriceBook,
    private readonly primaryCurrency = 'divine'
  ) {}

  start(
    s: { mode: SessionMode; targetCount?: number | null; bossName?: string | null; activity?: HideoutActivity | null },
    now = new Date()
  ): Session {
    this.endActive(now)
    const r = this.db
      .prepare('INSERT INTO sessions (mode, target_count, boss_name, activity, started_at) VALUES (?, ?, ?, ?, ?)')
      .run(s.mode, s.targetCount ?? null, s.bossName ?? null, s.activity ?? null, now.toISOString())
    return this.get(Number(r.lastInsertRowid))!
  }

  end(id: number, now = new Date()): void {
    this.db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL').run(now.toISOString(), id)
  }

  endActive(now = new Date()): void {
    const a = this.active()
    if (a) this.end(a.id, now)
  }

  get(id: number): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
    return row ? fromRow(row) : null
  }

  active(): Session | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1')
      .get() as SessionRow | undefined
    return row ? fromRow(row) : null
  }

  list(limit = 100): Session[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY id DESC LIMIT ?').all(limit) as unknown as SessionRow[]
    return rows.map(fromRow)
  }

  /** Attach a run to a session with its kind ('map' or 'boss'). First call wins. */
  attachRun(runId: string, sessionId: number, kind: 'map' | 'boss'): void {
    this.db
      .prepare('UPDATE runs SET session_id = ?, kind = ? WHERE id = ? AND session_id IS NULL')
      .run(sessionId, kind, runId)
  }

  setOutcome(runId: string, outcome: BossOutcome | null): void {
    this.db.prepare('UPDATE runs SET outcome = ? WHERE id = ?').run(outcome, runId)
  }

  addLine(sessionId: number, line: { direction: 'spent' | 'gained'; label: string; itemId?: string; quantity: number; manualValue?: number }): void {
    let unit: number | null = line.manualValue ?? null
    if (unit === null) unit = this.prices().get(line.itemId ?? line.label)?.value ?? null
    this.db
      .prepare(
        'INSERT INTO session_lines (session_id, direction, item_id, label, quantity, unit_value, currency) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(sessionId, line.direction, line.itemId ?? null, line.label, line.quantity, unit, this.primaryCurrency)
  }

  removeLine(lineId: number): void {
    this.db.prepare('DELETE FROM session_lines WHERE id = ?').run(lineId)
  }

  lines(sessionId: number): SessionLine[] {
    const rows = this.db
      .prepare('SELECT id, direction, label, item_id, quantity, unit_value FROM session_lines WHERE session_id = ? ORDER BY id')
      .all(sessionId) as unknown as {
      id: number
      direction: 'spent' | 'gained'
      label: string
      item_id: string | null
      quantity: number
      unit_value: number | null
    }[]
    return rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      label: r.label,
      itemId: r.item_id,
      quantity: r.quantity,
      unitValue: r.unit_value
    }))
  }

  summary(sessionId: number, now = new Date()): SessionSummary | null {
    const session = this.get(sessionId)
    if (!session) return null
    const runs = this.db
      .prepare(
        `SELECT COUNT(*) AS runs,
                COALESCE(SUM(ended_at IS NOT NULL), 0) AS completed,
                COALESCE(SUM(active_ms), 0) AS active_ms,
                COALESCE(SUM(deaths), 0) AS deaths,
                COALESCE(SUM(outcome = 'kill'), 0) AS kills,
                COALESCE(SUM(outcome = 'fail'), 0) AS fails,
                COALESCE(SUM((SELECT SUM(quantity * COALESCE(unit_value, 0)) FROM run_investments i WHERE i.run_id = r.id)), 0) AS invested,
                COALESCE(SUM((SELECT SUM(quantity * COALESCE(unit_value, 0)) FROM run_loot l WHERE l.run_id = r.id)), 0) AS looted,
                COALESCE(SUM(EXISTS (SELECT 1 FROM run_loot l WHERE l.run_id = r.id)
                          OR EXISTS (SELECT 1 FROM run_investments i WHERE i.run_id = r.id)), 0) AS with_economy
         FROM runs r WHERE r.session_id = ?`
      )
      .get(sessionId) as {
      runs: number
      completed: number
      active_ms: number
      deaths: number
      kills: number
      fails: number
      invested: number
      looted: number
      with_economy: number
    }
    const lines = this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN direction = 'spent' THEN quantity * COALESCE(unit_value, 0) END), 0) AS spent,
                COALESCE(SUM(CASE WHEN direction = 'gained' THEN quantity * COALESCE(unit_value, 0) END), 0) AS gained,
                COUNT(*) AS n
         FROM session_lines WHERE session_id = ?`
      )
      .get(sessionId) as { spent: number; gained: number; n: number }

    const end = session.endedAt ?? now
    const durationMs = Math.max(0, end.getTime() - session.startedAt.getTime())
    const profit = runs.looted + lines.gained - runs.invested - lines.spent
    const hasEconomy = runs.with_economy > 0 || lines.n > 0
    const target = session.targetCount
    const progress = session.mode === 'boss' ? runs.kills + runs.fails : runs.completed
    return {
      session,
      durationMs,
      runs: runs.runs,
      completedRuns: runs.completed,
      runActiveMs: runs.active_ms,
      deaths: runs.deaths,
      kills: runs.kills,
      fails: runs.fails,
      invested: runs.invested,
      looted: runs.looted,
      spent: lines.spent,
      gained: lines.gained,
      profit,
      profitPerHour: hasEconomy && durationMs >= MIN_RATE_DURATION_MS ? (profit / durationMs) * 3_600_000 : null,
      hasEconomy,
      objectiveReached: target !== null && target > 0 && progress >= target
    }
  }
}
