import type { DatabaseSync } from 'node:sqlite'
import type { Run } from '../runs/RunTracker'

export interface StoredRun extends Run {
  endReason: string | null
  buildVersionId: number | null
}

interface RunRow {
  id: string
  area_id: string
  area_name: string | null
  area_level: number
  seed: number
  instance_ip: string | null
  started_at: string
  ended_at: string | null
  active_ms: number
  deaths: number
  reentries: number
  end_reason: string | null
  build_version_id: number | null
}

function fromRow(r: RunRow): StoredRun {
  return {
    id: r.id,
    areaId: r.area_id,
    areaName: r.area_name,
    areaLevel: r.area_level,
    seed: r.seed,
    instanceIp: r.instance_ip,
    startedAt: new Date(r.started_at),
    endedAt: r.ended_at ? new Date(r.ended_at) : null,
    activeMs: r.active_ms,
    deaths: r.deaths,
    reentries: r.reentries,
    endReason: r.end_reason,
    buildVersionId: r.build_version_id
  }
}

export class RunRepository {
  constructor(private readonly db: DatabaseSync) {}

  upsert(run: Run, opts: { endReason?: string | null; buildVersionId?: number | null } = {}): void {
    this.db
      .prepare(
        `INSERT INTO runs (id, area_id, area_name, area_level, seed, instance_ip, started_at, ended_at,
                           active_ms, deaths, reentries, end_reason, build_version_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           area_name = excluded.area_name,
           ended_at = excluded.ended_at,
           active_ms = excluded.active_ms,
           deaths = excluded.deaths,
           reentries = excluded.reentries,
           end_reason = COALESCE(excluded.end_reason, runs.end_reason),
           build_version_id = COALESCE(runs.build_version_id, excluded.build_version_id)`
      )
      .run(
        run.id,
        run.areaId,
        run.areaName,
        run.areaLevel,
        run.seed,
        run.instanceIp,
        run.startedAt.toISOString(),
        run.endedAt ? run.endedAt.toISOString() : null,
        run.activeMs,
        run.deaths,
        run.reentries,
        opts.endReason ?? null,
        opts.buildVersionId ?? null
      )
  }

  recent(limit = 50): StoredRun[] {
    const rows = this.db
      .prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?')
      .all(limit) as unknown as RunRow[]
    return rows.map(fromRow)
  }

  /** Completed runs and total active time since `since`. */
  statsSince(since: Date): { runs: number; activeMs: number; deaths: number } {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS runs, COALESCE(SUM(active_ms), 0) AS activeMs, COALESCE(SUM(deaths), 0) AS deaths
         FROM runs WHERE ended_at IS NOT NULL AND started_at >= ?`
      )
      .get(since.toISOString()) as { runs: number; activeMs: number; deaths: number }
    return r
  }
}
