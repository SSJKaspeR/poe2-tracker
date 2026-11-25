import { describe, expect, it } from 'vitest'
import { rankSupports, rankSupportSwaps, rankTree, swapCandidates } from '@core/build/optimisations'
import type { SupportOptions, TreeOptions } from '@core/pob/PobBridge'

const d = (before: number, after: number) => ({ before, after, delta: after - before })
const DPS = (after: number) => ({ CombinedDPS: d(100, after) })

describe('passive tree', () => {
  const add = (id: number, name: string, cost: number, dps: number, pathIds = [id]) => ({
    id, name, kind: 'small' as const, stats: [], cost, via: [], pathIds, diff: DPS(dps)
  })
  const data: TreeOptions = {
    before: {},
    used: 40,
    level: 60,
    points: { used: 40, available: 82, questPoints: 23, campaignLevel: 60, level: 60, ascendancyUsed: 0 },
    adds: [
      add(1, 'Far notable', 5, 130), // +30% → 6/pt
      add(2, 'Close small', 1, 108), // +8% → 8/pt
      add(3, 'Close small', 2, 108), // same passive further away: dropped
      add(4, 'Nothing', 1, 100),
      add(5, 'Cheap notable', 2, 120, [6, 5]) // +20% → 10/pt
    ],
    removes: [
      { id: 10, name: 'Useless', kind: 'small', stats: [], cost: 2, ids: [10, 11], diff: {} },
      { id: 12, name: 'Core', kind: 'notable', stats: [], cost: 1, ids: [12], diff: DPS(70) },
      { id: 13, name: 'Minor', kind: 'small', stats: [], cost: 3, ids: [13, 14, 15], diff: DPS(97) },
      { id: 6, name: 'On the path', kind: 'small', stats: [], cost: 2, ids: [6, 16], diff: {} }
    ]
  }
  const t = rankTree(data)

  it('ranks by gain per point, drops useless and duplicate passives', () => {
    expect(t.adds.map((a) => a.name)).toEqual(['Cheap notable', 'Close small', 'Far notable'])
    expect(t.adds[0]!.perPoint).toBeCloseTo(10)
    expect(t.adds[1]!.cost).toBe(1)
  })

  it('least useful points first, with what removing them costs', () => {
    expect(t.removes.map((r) => r.name)).toEqual(['Useless', 'On the path', 'Minor', 'Core'])
    expect(t.removes[3]!.impact[0]!.text).toBe('-30% damage')
  })

  it('respec pairs: enough points freed, not on the new path, cheaper than the gain', () => {
    const pairs = swapCandidates(t.adds, t.removes).map((p) => `${p.remove.name}→${p.add.name}`)
    expect(pairs).toContain('Useless→Cheap notable')
    expect(pairs).not.toContain('On the path→Cheap notable') // node 6 is on its path
    expect(pairs).not.toContain('Useless→Far notable') // frees 2, needs 5
    expect(pairs.every((p) => !p.startsWith('Core'))).toBe(true) // losing 30% for less
  })
})

describe('support gems', () => {
  const data: SupportOptions = {
    skill: 'Lightning Arrow',
    before: {},
    current: [
      { index: 2, name: 'Lightning Penetration', id: 'lp', family: 'Penetration', diff: { CombinedDPS: d(65, 100) } },
      { index: 3, name: 'Multishot I', id: 'ms', family: 'Additional Projectiles', diff: { CombinedDPS: d(180, 100) } },
      { index: 4, name: 'Mark', id: 'mk', diff: {} }
    ],
    candidates: [
      { id: 'a3', name: 'Alignment III', tier: 5, family: 'Alignment, Additional Projectiles', lineage: false, reqStr: 0, reqDex: 100, reqInt: 0, diff: DPS(186) },
      { id: 'a1', name: 'Alignment I', tier: 1, family: 'Alignment, Additional Projectiles', lineage: false, reqStr: 0, reqDex: 100, reqInt: 0, diff: DPS(150) },
      { id: 'rf', name: "Rakiata's Flow", lineage: true, family: "Rakiata's Flow", reqStr: 0, reqDex: 0, reqInt: 0, diff: DPS(181) },
      { id: 'no', name: 'Useless', lineage: false, reqStr: 0, reqDex: 0, reqInt: 0, diff: {} }
    ],
    swaps: [
      { remove: 'Lightning Penetration', add: "Rakiata's Flow", addId: 'rf', diff: DPS(181) },
      { remove: 'Multishot I', add: "Rakiata's Flow", addId: 'rf', diff: DPS(336) },
      { remove: 'Lightning Penetration', add: 'Alignment III', addId: 'a3', diff: DPS(99) }
    ]
  }
  const r = rankSupports(data, (n) => (n === "Rakiata's Flow" ? 3 : null))

  it('explains supports PoB cannot value instead of calling them useless', () => {
    expect(r.current[0]).toMatchObject({ name: 'Lightning Penetration', note: null })
    expect(r.current[1]!.note).toMatch(/^Lowers Path of Building's single-target damage/)
    expect(r.current[2]!.note).toMatch(/^No effect on Path of Building's numbers/)
  })

  it('warns about the mana a support would cost', () => {
    const costly = rankSupports(
      {
        ...data,
        before: { ManaCost: 10, ManaPerSecondCost: 20, ManaRegenRecovery: 20, ManaUnreserved: 100 },
        candidates: [{ id: 'x', name: 'Costly', lineage: false, reqStr: 0, reqDex: 0, reqInt: 0, diff: { CombinedDPS: d(100, 150), ManaCost: d(10, 20), ManaPerSecondCost: d(20, 40) } }]
      },
      () => null
    )
    expect(costly.candidates[0]!.costs.map((c) => c.text)).toEqual(['+10 mana per use (10 → 20)', 'Mana runs out after ~5 s of non-stop use'])
  })

  it('best of each family, lineage and price, and what it would replace', () => {
    expect(r.candidates.map((c) => c.name)).toEqual(['Alignment III', "Rakiata's Flow"])
    expect(r.candidates[0]).toMatchObject({ replaces: 'Multishot I', lineage: false, price: null })
    expect(r.candidates[1]).toMatchObject({ replaces: null, lineage: true, price: 3 })
  })

  it('replacements: never the supports PoB cannot value, only real gains', () => {
    const keep = r.current.filter((c) => c.note).map((c) => c.name)
    expect(rankSupportSwaps(data, keep).map((s) => `${s.remove}→${s.add}`)).toEqual(["Lightning Penetration→Rakiata's Flow"])
    expect(rankSupportSwaps(data).map((s) => s.remove)).toEqual(['Multishot I'])
  })
})
