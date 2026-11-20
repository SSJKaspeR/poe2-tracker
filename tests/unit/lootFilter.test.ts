import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { activeFilterFromConfig, guessActiveFilter, listFilters } from '@core/filter/findLootFilter'
import { classIndex, evaluate, hiddenValuable, parseFilter } from '@core/filter/LootFilter'

const FIX = resolve(import.meta.dirname, '..', 'fixtures', 'filters')
const strict = parseFilter(readFileSync(join(FIX, 'neversink-3-strict.filter'), 'utf8'))
const uberPlus = parseFilter(readFileSync(join(FIX, 'neversink-6-uber-plus-strict.filter'), 'utf8'))

function verdict(f: ReturnType<typeof parseFilter>, name: string, areaLevel = 80) {
  return evaluate(f, { baseType: name, classes: classIndex(f).get(name.toLowerCase()), areaLevel })
}

describe('loot filter rules (same first-match logic as the game)', () => {
  const f = parseFilter(`
# a comment
Show # tier a
	Class == "Stackable Currency"
	BaseType == "Divine Orb"
	SetFontSize 45

Hide
	BaseType "Shard"
	AreaLevel >= 65

Show
	BaseType "Orb" # partial match
	Continue

Hide
	BaseType == "Orb of Augmentation"

Show
	ItemLevel >= 80
	BaseType "Rune"
`)

  it('parses blocks, operators and quoted lists', () => {
    expect(f.blocks).toHaveLength(5)
    expect(f.blocks[0]!.conditions[0]).toEqual({ key: 'Class', op: '==', values: ['Stackable Currency'] })
    expect(f.blocks[2]!.continue).toBe(true)
    expect(f.blocks[0]!.comment).toBe('tier a')
  })

  it('first match wins; area level matters; Continue lets a later block decide', () => {
    expect(evaluate(f, { baseType: 'Divine Orb', classes: ['Stackable Currency'], areaLevel: 80 }).action).toBe('Show')
    expect(evaluate(f, { baseType: 'Regal Shard', areaLevel: 80 }).action).toBe('Hide')
    expect(evaluate(f, { baseType: 'Regal Shard', areaLevel: 40 }).action).toBe('Show') // no block → shown
    expect(evaluate(f, { baseType: 'Chaos Orb', areaLevel: 80 }).action).toBe('Show') // Continue block, nothing after
    expect(evaluate(f, { baseType: 'Orb of Augmentation', areaLevel: 80 }).action).toBe('Hide')
  })

  it('flags answers that depend on unknown details (item level…)', () => {
    const v = evaluate(f, { baseType: 'Iron Rune', areaLevel: 80 })
    expect(v).toMatchObject({ action: 'Show', uncertain: true })
  })
})

describe("NeverSink's PoE 2 filter (real files)", () => {
  it('reads the header', () => {
    expect(strict.info).toMatchObject({ title: "NeverSink's Indepth Loot Filter", type: '3-STRICT' })
    expect(strict.blocks.length).toBeGreaterThan(300)
  })

  it('learns item classes from the filter itself', () => {
    expect(classIndex(strict).get('exalted orb')).toContain('Stackable Currency')
    expect(classIndex(strict).get('greater body rune')).toContain('Augment')
  })

  it('strict hides low currency, keeps valuable currency; uber-plus hides more', () => {
    for (const name of ['Divine Orb', 'Exalted Orb', 'Chaos Orb', 'Regal Orb']) {
      expect(verdict(strict, name)).toMatchObject({ action: 'Show', uncertain: false })
    }
    for (const name of ['Orb of Augmentation', 'Transmutation Shard', 'Scroll of Wisdom']) {
      expect(verdict(strict, name).action).toBe('Hide')
    }
    expect(verdict(uberPlus, 'Divine Orb').action).toBe('Show')
    expect(verdict(uberPlus, 'Regal Orb').action).toBe('Hide')
    expect(verdict(uberPlus, 'Greater Body Rune').action).toBe('Hide')
  })

  it('lists the hidden items worth something, most valuable first', () => {
    const prices = [
      { name: 'Divine Orb', value: 1 },
      { name: 'Regal Orb', value: 0.004 },
      { name: 'Greater Body Rune', value: 0.02 },
      { name: 'Scroll of Wisdom', value: 0.0001 }
    ]
    const hidden = hiddenValuable(uberPlus, prices, { areaLevel: 80, minValue: 0.001 })
    expect(hidden.map((h) => h.name)).toEqual(['Greater Body Rune', 'Regal Orb'])
    expect(hiddenValuable(strict, prices, { areaLevel: 80, minValue: 0.001 })).toEqual([])
  })
})

describe('finding the filter on disk', () => {
  function dir() {
    const d = mkdtempSync(join(tmpdir(), 'poe2-filters-'))
    return d
  }

  it('prefers the filter selected in the game config', () => {
    const d = dir()
    writeFileSync(join(d, 'Mine.filter'), 'Show')
    writeFileSync(join(d, 'Other.filter'), 'Show')
    writeFileSync(join(d, 'poe2_production_Config.ini'), '[UI]\nitem_filter=Mine.filter\n')
    expect(activeFilterFromConfig([d])).toBe(join(d, 'Mine.filter'))
    expect(guessActiveFilter([d])).toBe(join(d, 'Mine.filter'))
  })

  it('resolves online filters and names them', () => {
    const d = dir()
    mkdirSync(join(d, 'OnlineFilters'))
    writeFileSync(join(d, 'OnlineFilters', 'abc123'), '#name:NeverSink Strict\nShow')
    writeFileSync(join(d, 'production_Config.ini'), 'item_filter=abc123\n')
    expect(activeFilterFromConfig([d])).toBe(join(d, 'OnlineFilters', 'abc123'))
    expect(listFilters([d]).map((c) => c.name)).toEqual(['NeverSink Strict (online)'])
  })

  it('falls back to the most recently changed .filter', () => {
    const d = dir()
    writeFileSync(join(d, 'Old.filter'), 'Show')
    writeFileSync(join(d, 'New.filter'), 'Show')
    utimesSync(join(d, 'Old.filter'), new Date(2020, 0, 1), new Date(2020, 0, 1))
    expect(guessActiveFilter([d])).toBe(join(d, 'New.filter'))
    expect(guessActiveFilter([join(d, 'missing')])).toBeNull()
  })
})
