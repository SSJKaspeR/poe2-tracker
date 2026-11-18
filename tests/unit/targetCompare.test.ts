import { describe, expect, it } from 'vitest'
import { compareGear, compareSlot, impactScore, parseModLine, type DetailedItem } from '@core/build/targetCompare'

const item = (slot: string, rarity: string, explicits: string[], extra: Partial<DetailedItem> = {}): DetailedItem => ({
  slot,
  name: extra.title ? `${extra.title}, ${extra.base ?? 'Base'}` : 'Rare Thing',
  rarity,
  implicits: [],
  explicits,
  runes: [],
  ...extra
})

describe('parseModLine', () => {
  it('turns numbers into a template and strips annotations', () => {
    expect(parseModLine('+90 to maximum Life')).toEqual({ template: '# to maximum life', values: [90], text: '+90 to maximum Life' })
    expect(parseModLine('+12% to Fire Resistance (rune)').template).toBe('#% to fire resistance')
    expect(parseModLine('Adds 5 to 12 Physical Damage').values).toEqual([5, 12])
  })
})

describe('compareSlot', () => {
  const guideBody = item('Body Armour', 'RARE', ['+120 to maximum Life', '+40% to Fire Resistance', '+30% to Cold Resistance'])

  it('match when every guide stat is reached (90 % is enough)', () => {
    const player = item('Body Armour', 'RARE', ['+110 to maximum Life', '+38% to Fire Resistance', '+30% to Cold Resistance', '+10 to Strength'])
    expect(compareSlot(guideBody, player).status).toBe('match')
  })

  it('lists missing and lower stats', () => {
    const player = item('Body Armour', 'RARE', ['+60 to maximum Life', '+40% to Fire Resistance'])
    const c = compareSlot(guideBody, player)
    expect(c.status).toBe('close')
    expect(c.missing.map((m) => m.text)).toEqual(['+30% to Cold Resistance'])
    expect(c.lower).toEqual([{ template: '# to maximum life', text: '+120 to maximum Life', want: 120, have: 60 }])
  })

  it('adds up lines of the same stat across implicits, explicits and runes', () => {
    const player = item('Body Armour', 'RARE', ['+70 to maximum Life', '+40% to Fire Resistance', '+30% to Cold Resistance'], {
      runes: ['+50 to maximum Life']
    })
    expect(compareSlot(guideBody, player).status).toBe('match')
  })

  it('detects a missing unique, and empty slots', () => {
    const guideRing = item('Ring 1', 'UNIQUE', ['+30 to Intelligence'], { title: 'Polcirkeln', base: 'Sapphire Ring' })
    expect(compareSlot(guideRing, item('Ring 1', 'RARE', ['+30 to Intelligence'])).status).toBe('missing_unique')
    const sameUnique = item('Ring 1', 'UNIQUE', ['+20 to Intelligence'], { title: 'Polcirkeln', base: 'Sapphire Ring' })
    expect(compareSlot(guideRing, sameUnique).status).toBe('close')
    expect(compareSlot(guideRing, undefined).status).toBe('empty')
  })

  it('compareGear covers slots present on either side', () => {
    const res = compareGear([guideBody], [item('Helmet', 'RARE', ['+50 to maximum Life'])])
    expect(res.map((r) => [r.slot, r.status])).toEqual([
      ['Body Armour', 'empty'],
      ['Helmet', 'not_in_guide']
    ])
  })
})

describe('impactScore', () => {
  it('takes the best relative gain among DPS and defences', () => {
    expect(
      impactScore({
        CombinedDPS: { before: 1000, after: 1200, delta: 200 },
        Life: { before: 4000, after: 3800, delta: -200 }
      })
    ).toBeCloseTo(20)
    expect(impactScore({ Life: { before: 4000, after: 3800, delta: -200 } })).toBeCloseTo(-5)
    expect(impactScore({})).toBe(0)
  })
})
