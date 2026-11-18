import { describe, expect, it } from 'vitest'
import { AppDatabase } from '@core/db/Database'
import { RunRepository } from '@core/db/RunRepository'
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

  it('is idempotent on migrations', () => {
    const db = new AppDatabase(':memory:')
    const v = db.db.prepare('SELECT COUNT(*) AS n FROM schema_version').get() as { n: number }
    expect(v.n).toBe(1)
  })
})
