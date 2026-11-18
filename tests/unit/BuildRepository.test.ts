import { describe, expect, it } from 'vitest'
import { AppDatabase } from '@core/db/Database'
import { BuildRepository } from '@core/db/BuildRepository'
import { RunRepository } from '@core/db/RunRepository'

describe('BuildRepository', () => {
  it('stores versions and aggregates run performance per version', () => {
    const db = new AppDatabase(':memory:')
    const builds = new BuildRepository(db.db)
    const runs = new RunRepository(db.db)

    const id = builds.createBuild('Cyclone Duelist')
    const v1 = builds.addVersion(id, { pobCode: 'code1', label: 'Imported', stats: { Life: 3000 } })
    const v2 = builds.addVersion(id, { pobCode: 'code2', label: 'Equipped Gloom Shell' })
    expect(v1.buildName).toBe('Cyclone Duelist')
    expect(v1.stats).toEqual({ Life: 3000 })

    const base = {
      areaId: 'MapCrypt', areaName: null, areaLevel: 80, seed: 1, instanceIp: null,
      startedAt: new Date('2026-11-18T19:00:00Z'), endedAt: new Date('2026-11-18T19:05:00Z'),
      activeMs: 300_000, deaths: 1, reentries: 0
    }
    runs.upsert({ ...base, id: 'a' }, { buildVersionId: v1.id })
    runs.upsert({ ...base, id: 'b' }, { buildVersionId: v1.id })
    runs.upsert({ ...base, id: 'c', deaths: 0 }, { buildVersionId: v2.id })
    // A later upsert must not move a run to another version.
    runs.upsert({ ...base, id: 'a' }, { buildVersionId: v2.id })

    const perf = builds.performanceByVersion(id)
    expect(perf.map((p) => [p.versionId, p.runs, p.deaths])).toEqual([
      [v2.id, 1, 0],
      [v1.id, 2, 2]
    ])
    expect(builds.versionsOf(id).map((v) => v.label)).toEqual(['Equipped Gloom Shell', 'Imported'])
  })
})
