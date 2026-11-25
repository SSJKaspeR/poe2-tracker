/**
 * Gear check: easy wins left on equipped items.
 * PoB provides the facts (audit_items); the rules live here so they can be tested.
 */

import { en, type Translator } from '../../shared/i18n'

export interface ItemAudit {
  slot: string
  name: string
  rarity: string
  base?: string
  corrupted: boolean
  mirrored: boolean
  itemLevel?: number
  quality: number
  maxQuality: number
  /** Level requirement of the base type. */
  baseLevel: number
  sockets: number
  socketLimit: number
  runesFilled: number
  explicitLines: number
  affixLimit: number
  /** Best ordinary base of the same type the character can wear. */
  bestBase?: { name: string; level: number } | null
}

export type FindingKind = 'empty_socket' | 'missing_socket' | 'open_affix' | 'low_base' | 'low_item_level' | 'quality' | 'locked'

/** easy = cheap and immediate, upgrade = needs a new or re-crafted item, info = context. */
export type FindingLevel = 'easy' | 'upgrade' | 'info'

export interface Finding {
  kind: FindingKind
  level: FindingLevel
  message: string
}

export interface ItemCheck {
  slot: string
  name: string
  rarity: string
  findings: Finding[]
}

/** A base this many levels below the best one available is considered outdated. */
export const LOW_BASE_GAP = 15
/** A rare this many item levels below the character can only roll low-tier mods. */
export const LOW_ITEM_LEVEL_GAP = 20

export function checkItem(it: ItemAudit, characterLevel: number, t: Translator = en): Finding[] {
  const out: Finding[] = []
  const locked = it.corrupted || it.mirrored

  const empty = Math.max(0, it.sockets - it.runesFilled)
  if (empty > 0) {
    out.push({
      kind: 'empty_socket',
      level: 'easy',
      message: empty > 1 ? t('{n} empty sockets — add a rune or soul core', { n: empty }) : t('{n} empty socket — add a rune or soul core', { n: empty })
    })
  }

  if (locked) {
    out.push({ kind: 'locked', level: 'info', message: it.corrupted ? t('Corrupted — cannot be modified') : t('Mirrored — cannot be modified') })
    return out
  }

  const missingSockets = Math.max(0, it.socketLimit - it.sockets)
  if (missingSockets > 0) {
    out.push({
      kind: 'missing_socket',
      level: 'easy',
      message:
        missingSockets > 1
          ? t("{n} more sockets possible (Artificer's Orb)", { n: missingSockets })
          : t("{n} more socket possible (Artificer's Orb)", { n: missingSockets })
    })
  }

  if ((it.rarity === 'RARE' || it.rarity === 'MAGIC') && it.affixLimit > 0 && it.explicitLines < it.affixLimit) {
    // One modifier can span two lines (hybrid mods), so lines over-count modifiers:
    // fewer lines than the limit always means at least that many free slots.
    const free = it.affixLimit - it.explicitLines
    const how = it.rarity === 'MAGIC' ? t('Regal or Augmentation Orb') : t('Exalted Orb')
    const params = { n: free, used: it.explicitLines, max: it.affixLimit, how }
    out.push({
      kind: 'open_affix',
      level: 'easy',
      message: free > 1 ? t('At least {n} open modifiers ({used}/{max}) — {how}', params) : t('At least {n} open modifier ({used}/{max}) — {how}', params)
    })
  }

  if (it.maxQuality > 0 && it.quality < it.maxQuality) {
    out.push({ kind: 'quality', level: 'easy', message: t('Quality {q}% / {max}%', { q: it.quality, max: it.maxQuality }) })
  }

  if (it.bestBase && it.rarity !== 'UNIQUE' && it.bestBase.level - it.baseLevel >= LOW_BASE_GAP) {
    out.push({
      kind: 'low_base',
      level: 'upgrade',
      message: t('Low-level base (level {level}) — {base} is available at level {best}', {
        level: it.baseLevel,
        base: it.bestBase.name,
        best: it.bestBase.level
      })
    })
  }

  if (it.rarity === 'RARE' && it.itemLevel !== undefined && characterLevel - it.itemLevel >= LOW_ITEM_LEVEL_GAP) {
    out.push({
      kind: 'low_item_level',
      level: 'upgrade',
      message: t('Item level {n} — its modifiers are limited to low tiers', { n: it.itemLevel })
    })
  }

  return out
}

const LEVEL_ORDER: Record<FindingLevel, number> = { easy: 0, upgrade: 1, info: 2 }

export function checkGear(audit: { characterLevel: number; items: ItemAudit[] }, t: Translator = en): ItemCheck[] {
  return audit.items.map((it) => ({
    slot: it.slot,
    name: it.name,
    rarity: it.rarity,
    findings: checkItem(it, audit.characterLevel, t).sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
  }))
}
