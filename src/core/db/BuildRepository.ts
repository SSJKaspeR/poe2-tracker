import type { DatabaseSync } from 'node:sqlite'

export interface BuildVersion {
  id: number
  buildId: number
  buildName: string
  createdAt: Date
  pobCode: string
  label: string | null
  stats: Record<string, number> | null
}

interface VersionRow {
  id: number
  build_id: number
  build_name: string
  created_at: string
  pob_code: string
  label: string | null
  stats_json: string | null
}

const SELECT_VERSION = `
  SELECT v.id, v.build_id, b.name AS build_name, v.created_at, v.pob_code, v.label, v.stats_json
  FROM build_versions v JOIN builds b ON b.id = v.build_id`

function fromRow(r: VersionRow): BuildVersion {
  return {
    id: r.id,
    buildId: r.build_id,
    buildName: r.build_name,
    createdAt: new Date(r.created_at),
    pobCode: r.pob_code,
    label: r.label,
    stats: r.stats_json ? (JSON.parse(r.stats_json) as Record<string, number>) : null
  }
}

/**
 * Builds and their versions. Every change (re-import, equipped item) creates a
 * new version, and each run is attached to the version active when it started,
 * so performance can be compared version by version.
 */
export class BuildRepository {
  constructor(private readonly db: DatabaseSync) {}

  createBuild(name: string, now = new Date()): number {
    const r = this.db.prepare('INSERT INTO builds (name, created_at) VALUES (?, ?)').run(name, now.toISOString())
    return Number(r.lastInsertRowid)
  }

  addVersion(
    buildId: number,
    v: { pobCode: string; label?: string | null; stats?: Record<string, number> | null },
    now = new Date()
  ): BuildVersion {
    const r = this.db
      .prepare('INSERT INTO build_versions (build_id, created_at, pob_code, label, stats_json) VALUES (?, ?, ?, ?, ?)')
      .run(buildId, now.toISOString(), v.pobCode, v.label ?? null, v.stats ? JSON.stringify(v.stats) : null)
    return this.getVersion(Number(r.lastInsertRowid))!
  }

  getVersion(id: number): BuildVersion | null {
    const row = this.db.prepare(`${SELECT_VERSION} WHERE v.id = ?`).get(id) as VersionRow | undefined
    return row ? fromRow(row) : null
  }

  versionsOf(buildId: number): BuildVersion[] {
    const rows = this.db
      .prepare(`${SELECT_VERSION} WHERE v.build_id = ? ORDER BY v.id DESC`)
      .all(buildId) as unknown as VersionRow[]
    return rows.map(fromRow)
  }

  /** Per-version mapping results, newest version first. */
  performanceByVersion(buildId: number): VersionPerformance[] {
    const rows = this.db
      .prepare(
        `SELECT v.id AS version_id, v.label, v.created_at,
                COUNT(r.id) AS runs,
                COALESCE(SUM(r.active_ms), 0) AS active_ms,
                COALESCE(SUM(r.deaths), 0) AS deaths
         FROM build_versions v
         LEFT JOIN runs r ON r.build_version_id = v.id AND r.ended_at IS NOT NULL
         WHERE v.build_id = ?
         GROUP BY v.id
         ORDER BY v.id DESC`
      )
      .all(buildId) as unknown as {
      version_id: number
      label: string | null
      created_at: string
      runs: number
      active_ms: number
      deaths: number
    }[]
    return rows.map((r) => ({
      versionId: r.version_id,
      label: r.label,
      createdAt: new Date(r.created_at),
      runs: r.runs,
      activeMs: r.active_ms,
      deaths: r.deaths
    }))
  }
}

export interface VersionPerformance {
  versionId: number
  label: string | null
  createdAt: Date
  runs: number
  activeMs: number
  deaths: number
}
