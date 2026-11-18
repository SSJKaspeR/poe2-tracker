import { describe, expect, it } from 'vitest'
import { checkGear, checkItem, type ItemAudit } from '@core/build/gearCheck'

const base: ItemAudit = {
  slot: 'Body Armour',
  name: 'Gloom Shell, Soldier Cuirass',
  rarity: 'RARE',
  base: 'Soldier Cuirass',
  corrupted: false,
  mirrored: false,
  itemLevel: 80,
  quality: 20,
  maxQuality: 20,
  baseLevel: 65,
  sockets: 4,
  socketLimit: 4,
  runesFilled: 4,
  explicitLines: 6,
  affixLimit: 6,
  bestBase: { name: 'Soldier Cuirass', level: 65 }
}
const kinds = (it: ItemAudit, lvl = 85) => checkItem(it, lvl).map((f) => f.kind)

describe('gear check', () => {
  it('a finished item has nothing to report', () => {
    expect(checkItem(base, 85)).toEqual([])
  })

  it('reports empty and missing rune sockets', () => {
    const f = checkItem({ ...base, sockets: 2, runesFilled: 1 }, 85)
    expect(f.map((x) => x.kind)).toEqual(['empty_socket', 'missing_socket'])
    expect(f[0]!.message).toContain('1 empty socket')
    expect(f[1]!.message).toContain('2 more sockets')
  })

  it('reports open modifiers on rares and magics, never on uniques', () => {
    expect(checkItem({ ...base, explicitLines: 4 }, 85)[0]!.message).toContain('At least 2 open modifiers (4/6)')
    expect(checkItem({ ...base, rarity: 'MAGIC', affixLimit: 2, explicitLines: 1 }, 85)[0]!.message).toContain('Regal')
    expect(kinds({ ...base, rarity: 'UNIQUE', explicitLines: 3 })).toEqual([])
  })

  it('reports outdated bases and low item levels', () => {
    expect(kinds({ ...base, baseLevel: 11, base: 'Iron Cuirass' })).toEqual(['low_base'])
    expect(kinds({ ...base, baseLevel: 55 })).toEqual([]) // within 15 levels of the best base
    expect(kinds({ ...base, itemLevel: 50 })).toEqual(['low_item_level'])
    expect(kinds({ ...base, rarity: 'UNIQUE', baseLevel: 11 })).toEqual([])
  })

  it('reports missing quality', () => {
    expect(checkItem({ ...base, quality: 8 }, 85)[0]!.message).toBe('Quality 8% / 20%')
  })

  it('corrupted items: only empty sockets, flagged as locked', () => {
    expect(kinds({ ...base, corrupted: true, sockets: 2, runesFilled: 1, explicitLines: 3, quality: 0, baseLevel: 1 })).toEqual([
      'empty_socket',
      'locked'
    ])
  })

  it('sorts easy wins before upgrades', () => {
    const [c] = checkGear({ characterLevel: 85, items: [{ ...base, baseLevel: 11, quality: 10 }] })
    expect(c!.findings.map((f) => f.level)).toEqual(['easy', 'upgrade'])
  })
})
