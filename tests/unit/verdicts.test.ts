import { describe, expect, it } from 'vitest'
import { computeVerdicts, formatDuration, type VerdictBuild, type VerdictRun } from '@core/verdicts/verdicts'

const money = (d: number) => `${d.toFixed(2)} div`
const MIN = 60_000

function run(p: Partial<VerdictRun> = {}): VerdictRun {
  return {
    areaName: 'Crypt',
    areaId: 'MapCrypt',
    areaLevel: 79,
    activeMs: 5 * MIN,
    deaths: 0,
    ended: true,
    kind: 'map',
    outcome: null,
    invested: 0,
    looted: 0,
    hasLoot: false,
    strategyName: null,
    versionLabel: null,
    versionId: 1,
    ...p
  }
}

const many = (n: number, p: Partial<VerdictRun> = {}) => Array.from({ length: n }, () => run(p))
const ids = (runs: VerdictRun[], build: VerdictBuild | null = null) => computeVerdicts({ runs, build, money }).map((v) => v.id)

const GOOD_STATS = {
  FireResist: 75,
  ColdResist: 75,
  LightningResist: 75,
  ChaosResist: 20,
  PhysicalMaximumHitTaken: 9000,
  FireMaximumHitTaken: 10000,
  ColdMaximumHitTaken: 10000,
  LightningMaximumHitTaken: 10000,
  ChaosMaximumHitTaken: 8000,
  EffectiveMovementSpeedMod: 1.3,
  SpiritUnreserved: 0
}

describe('verdicts: nothing before enough data', () => {
  it('7 maps full of deaths say nothing; 8 do', () => {
    expect(ids(many(7, { deaths: 2 }))).toEqual([])
    expect(ids(many(8, { deaths: 1 }))).toContain('maps.deaths')
  })

  it('runs still in progress are ignored', () => {
    expect(ids(many(10, { deaths: 1, ended: false }))).toEqual([])
  })

  it('a clean build and clean maps give no warning', () => {
    const v = computeVerdicts({ runs: many(8), build: { level: 90, stats: GOOD_STATS, easyGearFixes: 0 }, money })
    expect(v.filter((x) => x.severity === 'warn')).toEqual([])
  })
})

describe('verdicts: maps', () => {
  it('death rate names the worst map', () => {
    const runs = [...many(6), ...many(3, { areaName: 'Savanna', deaths: 1 }), ...many(3, { areaName: 'Bluff' })]
    const v = computeVerdicts({ runs, build: null, money }).find((x) => x.id === 'maps.deaths')!
    expect(v.title).toBe('You die in 25% of your maps')
    expect(v.detail).toContain('worst on Savanna (100% of 3 runs)')
    expect(v.tab).toBe('build')
  })

  it('16 clean maps: good news', () => {
    expect(ids(many(16))).toContain('maps.no-deaths')
  })

  it('a map that takes 1.5× longer than usual', () => {
    const runs = [...many(6), ...many(3, { areaName: 'Bluff', activeMs: 9 * MIN })]
    const v = computeVerdicts({ runs, build: null, money }).find((x) => x.id === 'maps.slow.Bluff')!
    expect(v.detail).toBe('9:00 on average over 3 runs, against 5:00 for a typical map. Unless it pays more, run it less.')
    expect(ids([...many(6), ...many(3, { areaName: 'Bluff', activeMs: 7 * MIN })])).not.toContain('maps.slow.Bluff')
  })
})

describe('verdicts: economy', () => {
  it('few maps with declared loot', () => {
    expect(ids([...many(8), ...many(2, { hasLoot: true, looted: 1 })])).toContain('economy.coverage')
    expect(ids(many(8, { hasLoot: true, looted: 1 }))).not.toContain('economy.coverage')
  })

  it('most profitable map and strategy (gap ≥ 30%)', () => {
    const runs = [
      ...many(4, { areaName: 'Crypt', hasLoot: true, looted: 1, strategyName: 'Breach' }), // 12 div/h
      ...many(4, { areaName: 'Savanna', hasLoot: true, looted: 0.5, strategyName: 'Ritual' }) // 6 div/h
    ]
    const v = computeVerdicts({ runs, build: null, money })
    expect(v.find((x) => x.id === 'economy.map.Crypt')?.detail).toBe(
      '12.00 div/h over 4 runs, against 6.00 div/h for Savanna (4 runs). Favour Crypt.'
    )
    expect(v.find((x) => x.id === 'economy.strategy.Breach')?.title).toBe('Breach is your most profitable strategy')
  })

  it('no comparison when the gap is small or a group is too small', () => {
    const close = [...many(4, { hasLoot: true, looted: 1 }), ...many(4, { areaName: 'Savanna', hasLoot: true, looted: 0.8 })]
    expect(ids(close).some((i) => i.startsWith('economy.map'))).toBe(false)
    const small = [...many(8, { hasLoot: true, looted: 1 }), ...many(2, { areaName: 'Savanna', hasLoot: true, looted: 0.1 })]
    expect(ids(small).some((i) => i.startsWith('economy.map'))).toBe(false)
  })

  it('investments count: profit, not loot', () => {
    const runs = [
      ...many(4, { areaName: 'Crypt', hasLoot: true, looted: 2, invested: 1.9 }),
      ...many(4, { areaName: 'Savanna', hasLoot: true, looted: 0.5 })
    ]
    expect(ids(runs)).toContain('economy.map.Savanna')
  })
})

describe('verdicts: build versions', () => {
  it('faster or slower maps, more deaths since the last version', () => {
    const before = many(5, { versionId: 1, versionLabel: 'leveling' })
    expect(ids([...before, ...many(5, { versionId: 2, versionLabel: 'new boots', activeMs: 4 * MIN })])).toContain('build.version.faster')
    expect(ids([...before, ...many(5, { versionId: 2, activeMs: 6 * MIN })])).toContain('build.version.slower')
    const deaths = computeVerdicts({ runs: [...before, ...many(5, { versionId: 2, versionLabel: 'glass', deaths: 1 })], build: null, money })
    expect(deaths.find((v) => v.id === 'build.version.deaths')?.title).toBe('More deaths since "glass"')
    expect(ids([...before, ...many(4, { versionId: 2, activeMs: 3 * MIN })])).not.toContain('build.version.faster')
  })
})

describe('verdicts: bosses', () => {
  it('low kill rate warns, a reliable farm is good news', () => {
    const boss = (outcome: 'kill' | 'fail') => run({ kind: 'boss', areaName: 'Arbiter of Ash', outcome })
    expect(ids([boss('fail'), boss('fail'), boss('kill')])).toContain('bosses.Arbiter of Ash')
    expect(ids([boss('kill'), boss('kill')])).toEqual([])
    expect(ids(Array.from({ length: 5 }, () => boss('kill')))).toContain('bosses.Arbiter of Ash.farm')
  })
})

describe('verdicts: build stats', () => {
  const b = (stats: Record<string, number>, p: Partial<VerdictBuild> = {}): VerdictBuild => ({
    level: 90,
    stats: { ...GOOD_STATS, ...stats },
    easyGearFixes: 0,
    ...p
  })
  const verdict = (build: VerdictBuild, id: string) => computeVerdicts({ runs: [], build, money }).find((v) => v.id === id)

  it('uncapped elemental resistances, listed', () => {
    expect(verdict(b({ FireResist: 52, LightningResist: 70 }), 'build.res')?.detail).toMatch(/^Fire 52%, Lightning 70% \(cap 75%\)/)
  })

  it('negative chaos resistance only matters in endgame', () => {
    expect(verdict(b({ ChaosResist: -30 }), 'build.chaos')?.title).toBe('Chaos resistance -30%')
    expect(verdict(b({ ChaosResist: -30 }, { level: 40 }), 'build.chaos')).toBeUndefined()
  })

  it('one damage type far weaker than the others', () => {
    expect(verdict(b({ PhysicalMaximumHitTaken: 4000 }), 'build.maxhit.physical')?.title).toBe('Weak against physical hits')
    expect(verdict(b({ PhysicalMaximumHitTaken: 7000 }), 'build.maxhit.physical')).toBeUndefined()
  })

  it('movement speed, unused spirit, easy gear fixes', () => {
    expect(verdict(b({ EffectiveMovementSpeedMod: 1.05 }), 'build.movespeed')?.title).toBe('Movement speed only +5%')
    expect(verdict(b({ EffectiveMovementSpeedMod: 0.95 }), 'build.movespeed')).toMatchObject({
      title: 'Movement speed -5%',
      detail: expect.stringContaining('slows you down')
    })
    expect(verdict(b({ SpiritUnreserved: 45 }), 'build.spirit')?.title).toBe('45 Spirit unused')
    expect(verdict(b({}, { easyGearFixes: 3 }), 'build.gear')?.title).toBe('3 easy gear improvements')
  })

  it('unspent passive points and a main skill that runs out of mana', () => {
    const points = { used: 90, available: 95, campaignLevel: 60, level: 80 }
    expect(verdict(b({}, { points }), 'build.unspent-points')).toMatchObject({ severity: 'warn', title: '5 passive points not spent' })
    expect(verdict(b({}, { points: { ...points, level: 50 } }), 'build.unspent-points')).toBeUndefined()
    const mana = { ManaPerSecondCost: 50, ManaRegenRecovery: 20, ManaUnreserved: 150 }
    expect(verdict(b(mana), 'build.mana')).toMatchObject({ severity: 'warn', title: 'Your main skill runs out of mana after ~5 s' })
    expect(verdict(b({ ...mana, ManaUnreserved: 450 }), 'build.mana')?.severity).toBe('tip')
    expect(verdict(b({ ...mana, ManaRegenRecovery: 60 }), 'build.mana')).toBeUndefined()
  })

  it('most important first: warnings, then tips, then good news', () => {
    const v = computeVerdicts({ runs: many(16), build: b({ FireResist: 40, SpiritUnreserved: 50 }), money })
    expect(v.map((x) => x.id)).toEqual(['build.res', 'build.spirit', 'economy.coverage', 'maps.no-deaths'])
  })
})

it('formats durations', () => {
  expect(formatDuration(5 * MIN + 7000)).toBe('5:07')
})
