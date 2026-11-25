/**
 * Gear advice from Path of Building calculations, ranked and worded for players:
 * which rune to socket (with its price), which slot to upgrade first, what a free affix
 * could bring. Pure functions: the PoB numbers come in, sorted suggestions go out.
 */
import { summarizeImpact, type ImpactLine, type StatMap } from '../../shared/impact'
import { en, type Translator } from '../../shared/i18n'
import type { ModImpact, RuneOptions } from '../pob/PobBridge'

export interface RuneSuggestion {
  name: string
  kind: string
  /** What one rune gives, as written in the game. */
  lines: string[]
  count: number
  /** Total price in divine for `count` runes, null when poe.ninja has no price. */
  price: number | null
  dps: number
  ehp: number
  score: number
  impact: ImpactLine[]
}

export interface RuneSlotAdvice {
  slot: string
  item: string
  empty: number
  sockets: number
  /** Best first; only options that change something. */
  options: RuneSuggestion[]
  /** Cheapest option giving at least 80% of the best option's gain (when cheaper). */
  bestValue: string | null
}

export function rankRuneOptions(data: RuneOptions, priceOf: (name: string) => number | null, top = 5, t: Translator = en): RuneSlotAdvice[] {
  return data.slots
    .map((s) => {
      const all = s.options
        .map((o) => {
          const imp = summarizeImpact(o.diff, data.before, t)
          const unit = priceOf(o.name)
          return {
            name: o.name,
            kind: o.kind,
            lines: o.lines,
            count: o.count,
            price: unit === null ? null : unit * o.count,
            dps: imp.dps,
            ehp: imp.ehp,
            score: imp.score,
            impact: imp.lines
          }
        })
        .filter((o) => o.impact.length > 0 && o.score > 0.1)
        .sort((a, b) => b.score - a.score)
      const best = all[0]
      let bestValue: string | null = null
      if (best && best.price !== null) {
        const value = all
          .filter((o) => o.price !== null && o.price < best.price! && o.score >= best.score * 0.8)
          .sort((a, b) => a.price! - b.price!)[0]
        bestValue = value?.name ?? null
      }
      return { slot: s.slot, item: s.item, empty: s.empty, sockets: s.sockets, options: all.slice(0, top), bestValue }
    })
    .filter((s) => s.options.length > 0)
}

export interface SlotPreview {
  slot: string
  item: string
  /** Stats the "good realistic item" adds (game text). */
  mods: string[]
  /** Defences kept from the current item. */
  kept?: string[]
  before: StatMap
  diff: Record<string, { before: number; after: number; delta: number }>
}

export interface SlotPriority {
  slot: string
  item: string
  dps: number
  ehp: number
  score: number
  impact: ImpactLine[]
  /** Stats to look for, most useful first. */
  lookFor: string[]
  kept: string[]
}

/** Slots ranked by how much a good rare with the most useful stats would add. */
export function rankSlots(previews: SlotPreview[], t: Translator = en): SlotPriority[] {
  return previews
    .map((p) => {
      const imp = summarizeImpact(p.diff, p.before, t)
      return { slot: p.slot, item: p.item, dps: imp.dps, ehp: imp.ehp, score: imp.score, impact: imp.lines, lookFor: p.mods, kept: p.kept ?? [] }
    })
    .sort((a, b) => b.score - a.score)
}

export interface TradeWeight {
  tradeId: string
  text: string
  /** Gain per point of the stat (PoB). */
  weight: number
  /** Gain at the value PoB tested. */
  score: number
  /** Value PoB tested (a good roll). */
  typical: number
}

/**
 * The stats of a good, realistic rare for this slot: the most useful ones PoB found,
 * at the value it tested, at most `max` of them (a rare has 6 affixes).
 * Stats already on the item are kept: a replacement must not lose them.
 */
export function goodItemMods(weights: TradeWeight[], max = 6, kept: string[] = []): TradeWeight[] {
  if (max <= 0) return []
  const seen = new Set<string>(kept.map(statFamily))
  return [...weights]
    .filter((w) => w.score > 0 && w.typical !== 0)
    .sort((a, b) => b.score - a.score)
    .filter((w) => {
      // Stats already kept from the current item are not added twice.
      const family = statFamily(w.text)
      if (seen.has(family)) return false
      seen.add(family)
      return true
    })
    .slice(0, max)
}

/**
 * Defensive lines of the current item (resistances, flat life / energy shield): an upgrade
 * must keep them, so the "good item" keeps them and improves the rest.
 */
export function defensiveLines(explicits: string[]): string[] {
  return explicits.filter((l) => {
    const t = l.trim()
    return /^[+-]?\d/.test(t) && (/Resistances?$/i.test(t) || /^\+?\d+ to maximum (Life|Energy Shield)$/i.test(t))
  })
}

/** "+111 to maximum Life" and "+# to maximum Life (Local)" → "# to maximum life". */
export function statFamily(text: string): string {
  return text
    .replace(/\s*\(Local\)/i, '')
    .replace(/[+-]?(\d+(\.\d+)?|#)/g, '#')
    .trim()
    .toLowerCase()
}

export interface ModLineAdvice {
  kind: 'implicit' | 'explicit'
  text: string
  crafted: boolean
  /** What the line brings, in plain words ("+14% damage"); empty when it does nothing for the build. */
  effects: string[]
  score: number
}

export interface ItemSheet {
  slot: string
  item: string
  rarity: string
  lines: ModLineAdvice[]
  /** Index in `lines` of the explicit line to replace first (lowest value), null if none. */
  weakest: number | null
}

/**
 * Each mod line of each equipped item with what it brings to the build (PoB recalculates
 * the item without the line). The weakest explicit line of a rare is the one to replace first.
 */
export function itemSheets(data: ModImpact, t: Translator = en): ItemSheet[] {
  return data.items.map((it) => {
    const lines = it.lines.map((l) => {
      // What the player has with this line ("you have 50%"), not a change.
      const imp = summarizeImpact(l.diff, data.before, t, 'current')
      const effects = imp.lines.filter((x) => x.good).map((x) => x.text)
      return { kind: l.kind, text: l.text, crafted: l.crafted, effects, score: imp.score }
    })
    let weakest: number | null = null
    if (it.rarity === 'RARE' || it.rarity === 'MAGIC') {
      const explicit = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.kind === 'explicit')
      const best = Math.max(0, ...explicit.map(({ l }) => l.score))
      // Resistance lines are never "the one to replace": losing them would uncap the player.
      const candidates = explicit.filter(({ l }) => !l.effects.some((e) => /resistance/i.test(e)) && !/Resistance/i.test(l.text))
      const low = candidates.sort((a, b) => a.l.score - b.l.score)[0]
      if (low && explicit.length >= 2 && low.l.score <= best * 0.25) weakest = low.i
    }
    return { slot: it.slot, item: it.item, rarity: it.rarity, lines, weakest }
  })
}

