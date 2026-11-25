import { describe, expect, it } from 'vitest'
import type { RuneOptions } from '@core/pob/PobBridge'
import { defensiveLines, goodItemMods, itemSheets, rankRuneOptions, rankSlots, statFamily } from '@core/build/gearAdvice'

const d = (before: number, after: number) => ({ before, after, delta: after - before })

describe('runes: best first, price, best value', () => {
  const data: RuneOptions = {
    characterLevel: 80,
    before: {},
    slots: [
      {
        slot: 'Body Armour',
        item: 'Gloom Shell',
        sockets: 2,
        empty: 2,
        options: [
          { name: 'Greater Robust Rune', kind: 'Rune', lines: ['+12 to Strength'], level: 50, count: 2, diff: { TotalEHP: d(1000, 1040) } },
          { name: 'Greater Body Rune', kind: 'Rune', lines: ['+30 to maximum Life'], level: 50, count: 2, diff: { TotalEHP: d(1000, 1100) } },
          { name: 'Body Rune', kind: 'Rune', lines: ['+20 to maximum Life'], level: 20, count: 2, diff: { TotalEHP: d(1000, 1085) } },
          { name: "Serle's Triumph Rune", kind: 'Rune', lines: ['+1 Suffix Modifier allowed'], level: 0, count: 2, diff: {} }
        ]
      },
      { slot: 'Helmet', item: 'Cap', sockets: 1, empty: 1, options: [{ name: 'Useless', kind: 'Rune', lines: ['x'], level: 0, count: 1, diff: {} }] }
    ]
  }
  const prices: Record<string, number> = { 'Greater Body Rune': 0.05, 'Body Rune': 0.01 }
  const res = rankRuneOptions(data, (n) => prices[n] ?? null)

  it('ranks by gain, drops options that change nothing, prices the sockets filled', () => {
    expect(res).toHaveLength(1) // the helmet has nothing useful
    expect(res[0]!.options.map((o) => o.name)).toEqual(['Greater Body Rune', 'Body Rune', 'Greater Robust Rune'])
    expect(res[0]!.options[0]).toMatchObject({ price: 0.1, ehp: 10, impact: [{ text: '+10% survivability (effective HP)' }] })
    expect(res[0]!.options[2]!.price).toBeNull()
  })

  it('"best value": a cheaper rune giving at least 80% of the best gain', () => {
    expect(res[0]!.bestValue).toBe('Body Rune')
  })
})

describe('good realistic item for a slot', () => {
  const w = (text: string, score: number, typical = 10) => ({ tradeId: text, text, weight: score / typical, score, typical })

  it('keeps defences, adds the most useful other stats, no duplicate family', () => {
    const keep = defensiveLines(['+111 to maximum Life', '+40% to Fire Resistance', '+20% to Cold and Lightning Resistances', '15% increased Rarity of Items found', '+25 to Spirit'])
    expect(keep).toEqual(['+111 to maximum Life', '+40% to Fire Resistance', '+20% to Cold and Lightning Resistances'])
    const mods = goodItemMods(
      [w('+# to maximum Life', 90), w('#% increased Attack Speed', 80), w('+# to Dexterity', 50), w('+#% to Fire Resistance', 40), w('+# to Accuracy Rating', 0), w('+# to Strength', 30)],
      3,
      keep
    )
    expect(mods.map((m) => m.text)).toEqual(['#% increased Attack Speed', '+# to Dexterity', '+# to Strength'])
    expect(goodItemMods([w('a', 1)], 0)).toEqual([])
  })

  it('stat families ignore numbers, signs and (Local)', () => {
    expect(statFamily('+111 to maximum Life')).toBe(statFamily('+# to maximum Life (Local)'))
    expect(statFamily('12% increased Attack Speed')).toBe('#% increased attack speed')
  })

  it('slots ranked by gain', () => {
    const r = rankSlots([
      { slot: 'Boots', item: 'a', mods: ['+30% increased Movement Speed'], before: {}, diff: { CombinedDPS: d(100, 103) } },
      { slot: 'Weapon 1', item: 'b', mods: ['Adds 10 to 20 Physical Damage'], before: {}, diff: { CombinedDPS: d(100, 140) } }
    ])
    expect(r.map((x) => x.slot)).toEqual(['Weapon 1', 'Boots'])
    expect(r[0]!.impact[0]!.text).toBe('+40% damage')
  })
})

describe('item sheet: what each line brings', () => {
  const sheet = (rarity: string, lines: { text: string; diff: Record<string, ReturnType<typeof d>> }[]) =>
    itemSheets({ before: {}, items: [{ slot: 'Gloves', item: 'X', rarity, lines: lines.map((l) => ({ kind: 'explicit' as const, crafted: false, ...l })) }] })[0]!

  it('explains each line and flags the weakest non-resistance line', () => {
    const s = sheet('RARE', [
      { text: '+90 to maximum Life', diff: { TotalEHP: d(800, 1000) } },
      { text: '+30% to Cold Resistance', diff: { ColdResist: d(45, 75) } },
      { text: '+10 to Intelligence', diff: {} },
      { text: '15% increased Attack Speed', diff: { CombinedDPS: d(100, 115) } }
    ])
    expect(s.lines.map((l) => l.effects[0] ?? '')).toEqual(['+25% survivability (effective HP)', 'Cold resistance capped (75%)', '', '+15% damage'])
    const uncapped = sheet('RARE', [{ text: '+20% to Fire Resistance', diff: { FireResist: d(30, 50) } }])
    expect(uncapped.lines[0]!.effects).toEqual(['Fire resistance +20% (you have 50%)'])
    expect(s.weakest).toBe(2)
  })

  it('no flag on uniques, or when every line pulls its weight', () => {
    expect(sheet('UNIQUE', [{ text: 'a', diff: {} }, { text: 'b', diff: { CombinedDPS: d(100, 150) } }]).weakest).toBeNull()
    expect(sheet('RARE', [{ text: 'a', diff: { CombinedDPS: d(100, 120) } }, { text: 'b', diff: { CombinedDPS: d(100, 115) } }]).weakest).toBeNull()
  })
})
