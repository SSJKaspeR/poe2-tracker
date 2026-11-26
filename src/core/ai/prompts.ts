import type { BuildSnapshotDTO, GearCheckDTO, ItemComparisonDTO, OptimisationsDTO, VerdictDTO } from '../../shared/ipc'
import type { Lang } from '../../shared/i18n'
import { EXTRA_STAT_LABELS, STAT_LABELS, formatStat } from '../../renderer/src/format'
import type { AiPrompt } from './providers'

/**
 * What is sent to the AI: the numbers Path of Building calculated and what the app found, as
 * plain text. Never the account, character name, files, Client.txt lines or anything personal.
 * The player can read it before asking ("See what is sent").
 */

const LANGUAGE: Record<Lang, string> = { en: 'English', fr: 'French' }

function system(lang: Lang, task: string): string {
  return [
    'You are a friendly Path of Exile 2 coach inside a desktop app.',
    'Every number you receive was calculated by Path of Building or measured by the app: use them, never invent other numbers, stats or item names.',
    'If something cannot be decided from the data, say so instead of guessing.',
    task,
    `Answer in ${LANGUAGE[lang]}. Plain words, no jargon without a short explanation, no tables, no headings. At most 170 words.`,
    'Keep game terms players use as-is (DPS, Spirit, rune, Exalted Orb, map, build).'
  ].join('\n')
}

const KEY_STATS = [
  'CombinedDPS',
  'TotalEHP',
  'Life',
  'EnergyShield',
  'Mana',
  'Spirit',
  'SpiritUnreserved',
  'Armour',
  'Evasion',
  'FireResist',
  'ColdResist',
  'LightningResist',
  'ChaosResist',
  'EffectiveMovementSpeedMod',
  'PhysicalMaximumHitTaken',
  'FireMaximumHitTaken',
  'ColdMaximumHitTaken',
  'LightningMaximumHitTaken',
  'ChaosMaximumHitTaken',
  'ManaRegenRecovery',
  'ManaPerSecondCost'
]

function label(key: string): string {
  if (key === 'ManaPerSecondCost') return 'Main skill mana cost per second of use'
  if (key === 'ManaRegenRecovery') return 'Mana regeneration per second'
  return STAT_LABELS[key] ?? EXTRA_STAT_LABELS[key] ?? key
}

function statLines(stats: Record<string, number>): string[] {
  return KEY_STATS.filter((k) => typeof stats[k] === 'number').map((k) => `- ${label(k)}: ${formatStat(k, stats[k]!)}`)
}

export function buildCoachPrompt(
  lang: Lang,
  data: {
    snapshot: BuildSnapshotDTO
    verdicts: VerdictDTO[]
    gear: GearCheckDTO[]
    optimisations: OptimisationsDTO | null
  }
): AiPrompt {
  const { info, stats } = data.snapshot
  const out: string[] = []
  const who = [info.ascendancy && info.ascendancy !== 'None' ? info.ascendancy : info.className, info.level ? `level ${info.level}` : null]
  out.push(`Character: ${who.filter(Boolean).join(', ') || 'unknown'}${info.mainSkill ? `; main skill: ${info.mainSkill}` : ''}`)
  out.push('', 'Stats (Path of Building):', ...statLines(stats))

  const findings = data.verdicts.filter((v) => v.severity !== 'good').slice(0, 8)
  const good = data.verdicts.filter((v) => v.severity === 'good').slice(0, 3)
  if (findings.length) out.push('', 'Problems and tips found by the app:', ...findings.map((v) => `- ${v.title}. ${v.detail}`))
  if (good.length) out.push('', 'Going well:', ...good.map((v) => `- ${v.title}`))

  const gear = data.gear.filter((g) => g.findings.length > 0).slice(0, 8)
  if (gear.length) {
    out.push('', 'Gear check:')
    for (const g of gear) out.push(`- ${g.slot} (${g.name}): ${g.findings.map((f) => f.message).join('; ')}`)
  }

  const opt = data.optimisations
  if (opt) {
    if (opt.tree.points.unspent) out.push('', `Passive points not spent: ${opt.tree.points.unspent}`)
    const adds = opt.tree.adds.slice(0, 3)
    if (adds.length) {
      out.push('', 'Best next passive points (Path of Building):')
      for (const a of adds) out.push(`- ${a.name} (${a.cost} point${a.cost > 1 ? 's' : ''}): ${a.impact.map((l) => l.text).join(', ')}`)
    }
    const swaps = opt.supports?.swaps.slice(0, 2) ?? []
    const candidates = opt.supports?.candidates.slice(0, 3) ?? []
    if (swaps.length || candidates.length) {
      out.push('', `Support gems of ${opt.supports?.skill ?? 'the main skill'} (Path of Building):`)
      for (const s of swaps) out.push(`- Replace ${s.remove} with ${s.add}: ${s.impact.map((l) => l.text).join(', ')}`)
      for (const c of candidates) out.push(`- ${c.name}${c.replaces ? ` (replaces ${c.replaces})` : ''}: ${c.impact.map((l) => l.text).join(', ')}`)
    }
  }

  return {
    system: system(
      lang,
      'The player wants to know what to improve first. Give the 3 most useful actions, most important first, one short line each with why it matters. Defence problems that cause deaths come before damage.'
    ),
    user: out.join('\n')
  }
}

export function comparisonPrompt(lang: Lang, cmp: ItemComparisonDTO): AiPrompt {
  const out: string[] = [`Item compared: ${cmp.item.name}${cmp.item.base ? ` (${cmp.item.base})` : ''}, ${cmp.item.rarity}, slot ${cmp.slot}.`]
  if (cmp.verdict) out.push(`App verdict: ${cmp.verdict.text}`)
  const changes = Object.entries(cmp.diff)
    .filter(([k, d]) => KEY_STATS.includes(k) && Math.abs(d.delta) > 1e-6)
    .map(([k, d]) => `- ${label(k)}: ${formatStat(k, d.before)} → ${formatStat(k, d.after)}`)
  if (changes.length) out.push('', 'Changes if equipped (Path of Building):', ...changes)
  else out.push('', 'No change to the key stats.')
  return {
    system: system(
      lang,
      'The player copied an item in game and wants to know if they should equip it. Say yes, no or "depends" in the first sentence, then explain the trade-off in 2 or 3 short lines. A resistance falling below 75% is a serious problem.'
    ),
    user: out.join('\n'),
    maxTokens: 400
  }
}
