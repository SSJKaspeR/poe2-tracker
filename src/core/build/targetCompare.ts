/**
 * Compare the player's gear with a guide ("target") build, slot by slot.
 * Mod lines are matched by template: numbers replaced with #, so
 * "+90 to maximum Life" and "+120 to maximum Life" are the same stat.
 */

export interface DetailedItem {
  slot: string
  name: string
  title?: string
  rarity: string
  base?: string
  raw?: string
  implicits: string[]
  explicits: string[]
  runes: string[]
}

export interface ParsedLine {
  template: string
  values: number[]
  text: string
}

export interface ModGap {
  template: string
  /** Guide line as displayed. */
  text: string
  want: number
  have: number | null
}

export type SlotStatus = 'match' | 'close' | 'missing_unique' | 'different' | 'empty' | 'not_in_guide'

export interface SlotComparison {
  slot: string
  guide: { name: string; rarity: string; base?: string; title?: string } | null
  player: { name: string; rarity: string; base?: string; title?: string } | null
  status: SlotStatus
  /** Guide stats the player's item doesn't have at all. */
  missing: ModGap[]
  /** Guide stats the player has, but with a lower value (< 90 %). */
  lower: ModGap[]
}

/** A value at 90 % of the guide's counts as reached. */
export const CLOSE_ENOUGH = 0.9

const ANNOTATION = /\s*\((implicit|crafted|rune|enchant|fractured|desecrated|augmented)\)\s*$/i

export function parseModLine(line: string): ParsedLine {
  const text = line.replace(ANNOTATION, '').replace(/\{[^}]*\}/g, '').trim()
  const values: number[] = []
  const template = text.replace(/[+-]?\d+(\.\d+)?/g, (m) => {
    values.push(Number(m))
    return '#'
  })
  return { template: template.toLowerCase(), values, text }
}

/** Sum of the first value of each line, per template (two "+# to maximum Life" lines add up). */
function statTotals(lines: string[]): Map<string, { value: number; text: string }> {
  const out = new Map<string, { value: number; text: string }>()
  for (const l of lines) {
    const p = parseModLine(l)
    if (!p.template) continue
    const prev = out.get(p.template)
    const v = p.values[0] ?? 1 // lines without numbers ("Cannot be Frozen") count as 1
    out.set(p.template, { value: (prev?.value ?? 0) + v, text: prev?.text ?? p.text })
  }
  return out
}

function allLines(i: DetailedItem): string[] {
  return [...i.implicits, ...i.explicits, ...i.runes]
}

function summary(i: DetailedItem | undefined) {
  return i ? { name: i.name, rarity: i.rarity, base: i.base, title: i.title } : null
}

export function compareSlot(guide: DetailedItem | undefined, player: DetailedItem | undefined): SlotComparison {
  const slot = (guide ?? player)!.slot
  if (!guide) return { slot, guide: null, player: summary(player), status: 'not_in_guide', missing: [], lower: [] }
  if (!player) return { slot, guide: summary(guide), player: null, status: 'empty', missing: [], lower: [] }

  if (guide.rarity === 'UNIQUE') {
    const same = player.rarity === 'UNIQUE' && (player.title ?? player.name) === (guide.title ?? guide.name)
    if (!same) return { slot, guide: summary(guide), player: summary(player), status: 'missing_unique', missing: [], lower: [] }
  }

  const want = statTotals(allLines(guide))
  const have = statTotals(allLines(player))
  const missing: ModGap[] = []
  const lower: ModGap[] = []
  for (const [template, w] of want) {
    const h = have.get(template)
    if (!h) missing.push({ template, text: w.text, want: w.value, have: null })
    else if (w.value > 0 && h.value < w.value * CLOSE_ENOUGH) lower.push({ template, text: w.text, want: w.value, have: h.value })
  }

  let status: SlotStatus
  if (missing.length === 0 && lower.length === 0) status = 'match'
  else if (missing.length <= 1 && lower.length <= 1) status = 'close'
  else status = 'different'
  // A same unique with low rolls is still "close", never "different".
  if (guide.rarity === 'UNIQUE' && status === 'different') status = 'close'

  return { slot, guide: summary(guide), player: summary(player), status, missing, lower }
}

export function compareGear(guide: DetailedItem[], player: DetailedItem[]): SlotComparison[] {
  const slots = [...new Set([...guide.map((i) => i.slot), ...player.map((i) => i.slot)])]
  return slots.map((s) =>
    compareSlot(
      guide.find((i) => i.slot === s),
      player.find((i) => i.slot === s)
    )
  )
}

/** Key stats used to rank how much each guide item would help. */
export const IMPACT_KEYS = ['CombinedDPS', 'TotalEHP', 'Life', 'EnergyShield'] as const

/**
 * Relative gain of equipping the guide item, as a single score (best of DPS and
 * defence gains, in %). Used for sorting slots by priority.
 */
export function impactScore(diff: Record<string, { before: number; after: number; delta: number }>): number {
  let best = -Infinity
  for (const k of IMPACT_KEYS) {
    const d = diff[k]
    if (!d) continue
    const rel = d.before > 0 ? (d.delta / d.before) * 100 : d.delta > 0 ? 100 : 0
    best = Math.max(best, rel)
  }
  return best === -Infinity ? 0 : best
}
