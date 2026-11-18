import { describe, expect, it } from 'vitest'
import { AppDatabase } from '@core/db/Database'
import { RunRepository } from '@core/db/RunRepository'
import { MIGRATIONS } from '@core/db/migrations'
import type { Run } from '@core/runs/RunTracker'

const base: Run = {
  id: 'r1',
  areaId: 'MapCrypt',
  areaName: null,
  areaLevel: 79,
  seed: 111,
  instanceIp: '10.0.0.1',
  startedAt: new Date('2026-11-18T19:00:00Z'),
  endedAt: null,
  activeMs: 0,
  deaths: 0,
  reentries: 0
}

describe('RunRepository', () => {
  it('upserts a run as it progresses and computes stats', () => {
    const db = new AppDatabase(':memory:')
    const repo = new RunRepository(db.db)
    repo.upsert(base)
    repo.upsert({ ...base, areaName: 'Crypt', deaths: 1 })
    repo.upsert({ ...base, areaName: 'Crypt', deaths: 1, activeMs: 300_000, endedAt: new Date('2026-11-18T19:06:00Z') }, {
      endReason: 'new_map'
    })

    const [run] = repo.recent()
    expect(run).toMatchObject({ id: 'r1', areaName: 'Crypt', deaths: 1, activeMs: 300_000, endReason: 'new_map' })
    expect(repo.statsSince(new Date('2026-11-18T00:00:00Z'))).toEqual({ runs: 1, activeMs: 300_000, deaths: 1 })
  })

  it('lists completed runs with their economy and strategy', () => {
    const db = new AppDatabase(':memory:')
    const repo = new RunRepository(db.db)
    const ended = { ...base, endedAt: new Date('2026-11-18T19:06:00Z'), activeMs: 300_000 }
    repo.upsert(ended)
    repo.upsert({ ...base, id: 'open', startedAt: new Date('2026-11-18T19:10:00Z') })
    const s = db.db.prepare("INSERT INTO strategy_presets (name, items_json, created_at) VALUES ('T15', '[]', 'x')").run()
    db.db.prepare('UPDATE runs SET strategy_id = ? WHERE id = ?').run(Number(s.lastInsertRowid), 'r1')
    db.db.prepare("INSERT INTO run_investments (run_id, kind, label, quantity, unit_value) VALUES ('r1', 'waystone', 'W', 1, 0.5)").run()
    db.db.prepare("INSERT INTO run_loot (run_id, label, quantity, unit_value) VALUES ('r1', 'Divine Orb', 2, 1)").run()
    db.db.prepare("INSERT INTO run_loot (run_id, label, quantity, unit_value) VALUES ('r1', 'Unknown', 1, NULL)").run()

    const rows = repo.detailed()
    expect(rows).toHaveLength(1) // the open run is excluded
    expect(rows[0]).toMatchObject({ id: 'r1', strategyName: 'T15', invested: 0.5, looted: 2, hasLoot: true })
    expect(repo.detailed({ since: new Date('2026-11-19T00:00:00Z') })).toHaveLength(0)
  })

  it('is idempotent on migrations', () => {
    const db = new AppDatabase(':memory:')
    const v = db.db.prepare('SELECT COUNT(*) AS n FROM schema_version').get() as { n: number }
    expect(v.n).toBe(MIGRATIONS.length)
  })
})
