/**
 * Reads the player's PoE 2 loot filter (.filter text) and answers one question:
 * "would this item be shown or hidden on the ground?" — the same first-match rules
 * as the game (blocks top to bottom; `Continue` keeps going).
 *
 * Used to spot value the player never sees: items priced by poe.ninja that the filter hides.
 * The filter is only read, never written.
 */

export type Action = 'Show' | 'Hide' | 'Minimal'

export interface Condition {
  key: string
  op: string
  values: string[]
}

export interface Block {
  action: Action
  continue: boolean
  conditions: Condition[]
  /** 1-based line of the Show/Hide keyword. */
  line: number
  /** Comment after the keyword (NeverSink: "$type->currency $tier->exhide"). */
  comment: string
}

export interface FilterInfo {
  /** "NeverSink's Indepth Loot Filter" style title, if the header has one. */
  title: string | null
  version: string | null
  /** NeverSink strictness ("3-STRICT"), if present. */
  type: string | null
}

export interface ParsedFilter {
  info: FilterInfo
  blocks: Block[]
}

/** Item properties we can know for an item priced on poe.ninja's exchange. */
export interface ItemFacts {
  baseType: string
  /** Item classes it may belong to (inferred from the filter when unknown). */
  classes?: string[]
  rarity?: 'Normal' | 'Magic' | 'Rare' | 'Unique'
  areaLevel: number
  stackSize?: number
}

export interface Verdict {
  action: Action | null
  /** Line of the deciding block. */
  line: number | null
  /**
   * True when a block was skipped because it depends on something we can't know
   * (item level, quality…) while everything else matched: the answer may be wrong.
   */
  uncertain: boolean
}

const STYLE_KEYS = new Set([
  'SetFontSize',
  'SetTextColor',
  'SetBorderColor',
  'SetBackgroundColor',
  'PlayAlertSound',
  'PlayAlertSoundPositional',
  'PlayEffect',
  'MinimapIcon',
  'CustomAlertSound',
  'CustomAlertSoundOptional',
  'DisableDropSound',
  'EnableDropSound',
  'DisableDropSoundIfAlertSound',
  'EnableDropSoundIfAlertSound'
])

const OPS = ['==', '!=', '<=', '>=', '=', '<', '>', '!']

function tokenize(rest: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(rest))) out.push(m[1] ?? m[2]!)
  return out
}

export function parseFilter(text: string): ParsedFilter {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const blocks: Block[] = []
  let current: Block | null = null
  const header = lines.slice(0, 40).join('\n')
  const info: FilterInfo = {
    title: /^#\s*(NeverSink's[^\n]*?)\s*-\s*for Path of Exile 2/m.exec(header)?.[1] ?? /^#\s*(\S[^\n]{2,80})$/m.exec(header)?.[1]?.replace(/[=#-]{4,}.*/, '').trim() ?? null,
    version: /^#\s*VERSION:\s*(\S+)/m.exec(header)?.[1] ?? null,
    type: /^#\s*TYPE:\s*(\S+)/m.exec(header)?.[1] ?? null
  }
  lines.forEach((raw, i) => {
    const hash = raw.indexOf('#')
    const code = (hash >= 0 ? raw.slice(0, hash) : raw).trim()
    const comment = hash >= 0 ? raw.slice(hash + 1).trim() : ''
    if (!code) return
    const kw = /^(\S+)\s*(.*)$/.exec(code)
    if (!kw) return
    const [, key, rest] = kw as unknown as [string, string, string]
    if (key === 'Show' || key === 'Hide' || key === 'Minimal') {
      current = { action: key, continue: false, conditions: [], line: i + 1, comment }
      blocks.push(current)
      return
    }
    if (!current) return
    if (key === 'Continue') {
      current.continue = true
      return
    }
    if (STYLE_KEYS.has(key) || key.startsWith('Set')) return
    let tokens = tokenize(rest)
    let op = ''
    if (tokens.length && OPS.includes(tokens[0]!)) {
      op = tokens[0]!
      tokens = tokens.slice(1)
    } else {
      const glued = /^(==|!=|<=|>=|=|<|>|!)(.+)$/.exec(tokens[0] ?? '')
      if (glued) {
        op = glued[1]!
        tokens = [glued[2]!, ...tokens.slice(1)]
      }
    }
    current.conditions.push({ key, op, values: tokens })
  })
  return { info, blocks }
}

const RARITY_ORDER = ['Normal', 'Magic', 'Rare', 'Unique']

function compareNum(actual: number, op: string, values: string[]): boolean {
  const v = Number(values[0])
  if (!Number.isFinite(v)) return false
  switch (op) {
    case '<':
      return actual < v
    case '<=':
      return actual <= v
    case '>':
      return actual > v
    case '>=':
      return actual >= v
    case '!=':
    case '!':
      return !values.some((x) => Number(x) === actual)
    default:
      return values.some((x) => Number(x) === actual)
  }
}

function matchStrings(candidates: string[], op: string, values: string[]): boolean {
  const lower = candidates.map((c) => c.toLowerCase())
  const vals = values.map((v) => v.toLowerCase())
  const exact = op === '=='
  const hit = lower.some((c) => vals.some((v) => (exact ? c === v : c.includes(v))))
  return op === '!=' || op === '!' ? !hit : hit
}

/** true / false, or null when the condition depends on something unknown. */
function evalCondition(c: Condition, item: ItemFacts): boolean | null {
  switch (c.key) {
    case 'BaseType':
      return matchStrings([item.baseType], c.op, c.values)
    case 'Class':
      return item.classes && item.classes.length ? matchStrings(item.classes, c.op, c.values) : null
    case 'Rarity': {
      const r = RARITY_ORDER.indexOf(item.rarity ?? 'Normal')
      if (['<', '<=', '>', '>='].includes(c.op)) return compareNum(r, c.op, [String(RARITY_ORDER.indexOf(c.values[0]!))])
      return matchStrings([item.rarity ?? 'Normal'], c.op === '' || c.op === '=' ? '==' : c.op, c.values)
    }
    case 'AreaLevel':
      return compareNum(item.areaLevel, c.op, c.values)
    case 'StackSize':
      return compareNum(item.stackSize ?? 1, c.op, c.values)
    case 'Corrupted':
    case 'Mirrored':
    case 'TwiceCorrupted':
    case 'AnyEnchantment':
    case 'IsVaalUnique':
    case 'HasVaalUniqueMod':
    case 'Fractured':
    case 'Synthesised':
    case 'Duplicated':
      // Currency and other stackables are never corrupted, mirrored, enchanted…
      return matchStrings(['false'], '==', c.values)
    case 'Quality':
    case 'Sockets':
      // Stackables have no quality and no sockets.
      return compareNum(0, c.op, c.values)
    case 'AlwaysShow':
      return true
    default:
      return null // ItemLevel, Quality, Sockets, WaystoneTier, GemLevel, HasExplicitMod…
  }
}

export function evaluate(filter: ParsedFilter, item: ItemFacts): Verdict {
  let uncertain = false
  let decided: Block | null = null
  for (const b of filter.blocks) {
    let match = true
    let unknown = false
    for (const c of b.conditions) {
      const r = evalCondition(c, item)
      if (r === false) {
        match = false
        break
      }
      if (r === null) unknown = true
    }
    if (!match) continue
    if (unknown) {
      uncertain = true
      continue
    }
    decided = b
    if (!b.continue) break
  }
  // No block at all → the game shows the item.
  return { action: decided ? decided.action : filter.blocks.length ? 'Show' : null, line: decided?.line ?? null, uncertain }
}

/**
 * Item classes the filter itself associates with a base type (e.g. "Exalted Orb" →
 * "Stackable Currency"), from blocks that list it explicitly with `BaseType ==`.
 */
export function classIndex(filter: ParsedFilter): Map<string, string[]> {
  const idx = new Map<string, Set<string>>()
  for (const b of filter.blocks) {
    const base = b.conditions.find((c) => c.key === 'BaseType' && c.op === '==')
    const cls = b.conditions.find((c) => c.key === 'Class' && (c.op === '==' || c.op === ''))
    if (!base || !cls) continue
    for (const name of base.values) {
      const set = idx.get(name.toLowerCase()) ?? new Set<string>()
      for (const c of cls.values) set.add(c)
      idx.set(name.toLowerCase(), set)
    }
  }
  return new Map([...idx].map(([k, v]) => [k, [...v]]))
}

export interface PricedItem {
  name: string
  /** Value in divine orbs. */
  value: number
}

export interface HiddenItem extends PricedItem {
  line: number | null
  uncertain: boolean
}

/** Priced items the filter would hide, most valuable first. */
export function hiddenValuable(
  filter: ParsedFilter,
  items: PricedItem[],
  opts: { areaLevel: number; minValue: number }
): HiddenItem[] {
  const classes = classIndex(filter)
  const out: HiddenItem[] = []
  for (const it of items) {
    if (!(it.value >= opts.minValue)) continue
    const v = evaluate(filter, {
      baseType: it.name,
      classes: classes.get(it.name.toLowerCase()),
      areaLevel: opts.areaLevel
    })
    if (v.action === 'Hide') out.push({ ...it, line: v.line, uncertain: v.uncertain })
  }
  return out.sort((a, b) => b.value - a.value)
}
