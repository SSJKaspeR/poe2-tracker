/**
 * Turns a PoB stat difference into plain sentences and one score, so every gear
 * suggestion speaks the same language: "+9% damage", "Fire resistance capped (75%)".
 */

import { en, type Translator } from './i18n'

export type StatMap = Record<string, number>
export type StatDiff = Record<string, { before: number; after: number; delta: number }>

export interface ImpactLine {
  text: string
  good: boolean
  /** How much it matters, to keep the top lines (percent-like). */
  weight: number
  /** A resistance that drops below the 75% cap. */
  capLoss?: boolean
}

export interface Impact {
  /** Damage change in % (CombinedDPS). */
  dps: number
  /** Survivability change in % (effective HP). */
  ehp: number
  /** Sorted, most important first. */
  lines: ImpactLine[]
  /** One number to rank options: damage + survivability + resistance fixes. */
  score: number
}

const RES = ['FireResist', 'ColdResist', 'LightningResist', 'ChaosResist'] as const

function resName(t: Translator, k: (typeof RES)[number]): string {
  return { FireResist: t('Fire resistance'), ColdResist: t('Cold resistance'), LightningResist: t('Lightning resistance'), ChaosResist: t('Chaos resistance') }[k]
}

const CAP = 75

function pct(before: number, after: number): number {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 0
  if (Math.abs(before) < 1e-9) return after > 0 ? 100 : 0
  return ((after - before) / Math.abs(before)) * 100
}

const fmtPct = (x: number) => `${x > 0 ? '+' : ''}${Math.abs(x) >= 10 ? Math.round(x) : Math.round(x * 10) / 10}%`

/**
 * `perspective`: "change" describes a change ("now 50%" = after it); "current" describes
 * what a line of the player's item brings ("you have 50%").
 */
export function summarizeImpact(diff: StatDiff, before: StatMap, t: Translator = en, perspective: 'change' | 'current' = 'change'): Impact {
  const lines: ImpactLine[] = []
  const get = (k: string) => diff[k]
  const d = get('CombinedDPS')
  const dps = d ? pct(d.before, d.after) : 0
  const e = get('TotalEHP')
  const ehp = e ? pct(e.before, e.after) : 0

  if (Math.abs(dps) >= 0.5) lines.push({ text: t('{pct} damage', { pct: fmtPct(dps) }), good: dps > 0, weight: Math.abs(dps) })
  if (Math.abs(ehp) >= 0.5) {
    lines.push({ text: t('{pct} survivability (effective HP)', { pct: fmtPct(ehp) }), good: ehp > 0, weight: Math.abs(ehp) })
  }

  // Resistances: what matters is reaching or losing the 75% cap.
  let resFix = 0
  for (const k of RES) {
    const r = get(k)
    if (!r) continue
    const label = resName(t, k)
    const isChaos = k === 'ChaosResist'
    const capped = (v: number) => v >= CAP
    if (!capped(r.before) && capped(r.after)) {
      lines.push({ text: t('{res} capped ({cap}%)', { res: label, cap: CAP }), good: true, weight: 15 })
      resFix += CAP - r.before
    } else if (capped(r.before) && !capped(r.after)) {
      lines.push({ text: t('{res} drops below the cap: {value}%', { res: label, value: Math.round(r.after) }), good: false, weight: 20, capLoss: true })
      resFix -= CAP - r.after
    } else if (!capped(r.after) && Math.abs(r.delta) >= 1) {
      const params = { res: label, delta: `${r.delta > 0 ? '+' : ''}${Math.round(r.delta)}`, value: Math.round(r.after) }
      const text = perspective === 'current' ? t('{res} {delta}% (you have {value}%)', params) : t('{res} {delta}% (now {value}%)', params)
      lines.push({ text, good: r.delta > 0, weight: Math.min(Math.abs(r.delta), isChaos ? 8 : 12) })
      resFix += isChaos ? r.delta / 2 : r.delta
    }
  }

  const ms = get('EffectiveMovementSpeedMod')
  if (ms && Math.abs(ms.delta) >= 0.01) {
    const p = Math.round(ms.delta * 100)
    lines.push({ text: t('{pct}% movement speed', { pct: `${p > 0 ? '+' : ''}${p}` }), good: p > 0, weight: Math.abs(p) / 2 })
  }
  for (const k of ['Life', 'EnergyShield', 'Spirit'] as const) {
    const s = get(k)
    if (s && Math.abs(s.delta) >= 1 && Math.abs(pct(s.before, s.after)) >= 2) {
      const n = `${s.delta > 0 ? '+' : ''}${Math.round(s.delta)}`
      const text = k === 'Life' ? t('{n} life', { n }) : k === 'EnergyShield' ? t('{n} energy shield', { n }) : t('{n} Spirit', { n })
      lines.push({ text, good: s.delta > 0, weight: Math.abs(pct(s.before, s.after)) / 3 })
    }
  }

  lines.sort((a, b) => b.weight - a.weight)
  // Uncapped elemental resistances are worth a lot; chaos counts half.
  const score = dps + ehp + resFix * 0.5 + (ms ? ms.delta * 50 : 0)
  void before
  return { dps, ehp, lines, score }
}

export interface ItemVerdict {
  tone: 'better' | 'worse' | 'mixed' | 'same'
  text: string
}

/**
 * One sentence on an item comparison. `deathRate` (share of recent maps with a death,
 * null when unknown) tells whether trading defence for damage is a good idea.
 */
export function itemVerdict(impact: Impact, deathRate: number | null, t: Translator = en): ItemVerdict {
  const losesCap = impact.lines.some((l) => l.capLoss)
  const up = impact.lines.filter((l) => l.good)
  const down = impact.lines.filter((l) => !l.good)
  const top = (ls: ImpactLine[]) => ls.slice(0, 2).map((l) => l.text).join(', ')

  if (losesCap) {
    return {
      tone: 'worse',
      text: t('Not recommended: {loss}. Fix your resistances elsewhere first.', { loss: down.find((l) => l.capLoss)!.text })
    }
  }
  if (!up.length && !down.length) return { tone: 'same', text: t('No real difference for your build.') }
  if (!down.length) return { tone: 'better', text: t('Upgrade: {gains}.', { gains: top(up) }) }
  if (!up.length) return { tone: 'worse', text: t('Downgrade: {losses}.', { losses: top(down) }) }

  // Mixed: damage against defence.
  const moreDamage = impact.dps > 0 && impact.ehp < 0
  const moreDefence = impact.ehp > 0 && impact.dps < 0
  const pct = deathRate === null ? null : Math.round(deathRate * 100)
  if (moreDamage && deathRate !== null) {
    if (deathRate >= 0.25) {
      return {
        tone: 'mixed',
        text: t('More damage ({gains}) but less defence ({losses}). You already die in {pct}% of your maps: not recommended.', {
          gains: top(up),
          losses: top(down),
          pct: pct!
        })
      }
    }
    if (deathRate <= 0.1) {
      return {
        tone: 'mixed',
        text: t('More damage ({gains}) for less defence ({losses}). You rarely die ({pct}% of maps): worth it.', {
          gains: top(up),
          losses: top(down),
          pct: pct!
        })
      }
    }
  }
  if (moreDefence && deathRate !== null && deathRate >= 0.25) {
    return {
      tone: 'mixed',
      text: t('Safer ({gains}) at the cost of {losses}. You die in {pct}% of your maps: worth it.', { gains: top(up), losses: top(down), pct: pct! })
    }
  }
  return {
    tone: impact.score > 0 ? 'mixed' : 'worse',
    text:
      impact.score > 0
        ? t('Gains: {gains}. Losses: {losses}. Slightly better overall.', { gains: top(up), losses: top(down) })
        : t('Gains: {gains}. Losses: {losses}. Slightly worse overall.', { gains: top(up), losses: top(down) })
  }
}

// ── Costs and passive points ────────────────────────────────────────────────

export interface ManaSustain {
  /** Mana spent per second using the main skill non-stop. */
  perSecond: number
  /** Mana regenerated per second. */
  regen: number
  /** Seconds of non-stop use before running dry, null when regen keeps up. */
  secondsUntilEmpty: number | null
}

/** Can the player keep using the main skill? (PoB: cost per second vs regeneration). */
export function manaSustain(stats: StatMap): ManaSustain | null {
  const perSecond = stats.ManaPerSecondCost
  if (!perSecond || perSecond <= 0) return null
  const regen = stats.ManaRegenRecovery ?? 0
  const pool = stats.ManaUnreserved ?? stats.Mana ?? 0
  const deficit = perSecond - regen
  return { perSecond, regen, secondsUntilEmpty: deficit > 0 ? pool / deficit : null }
}

/** Stats after a change, from the stats before and the PoB difference. */
export function applyDiff(before: StatMap, diff: StatDiff): StatMap {
  const out = { ...before }
  for (const [k, c] of Object.entries(diff)) out[k] = c.after
  return out
}

/**
 * What a change does to the costs of the build, in plain words: mana per use, how long the
 * mana lasts, Spirit left. Only problems are reported.
 */
export function costWarnings(before: StatMap, diff: StatDiff, t: Translator = en): ImpactLine[] {
  const after = applyDiff(before, diff)
  const out: ImpactLine[] = []
  const cost = diff.ManaCost
  if (cost && cost.delta >= 1) {
    out.push({
      text: t('+{n} mana per use ({before} → {after})', { n: Math.round(cost.delta), before: Math.round(cost.before), after: Math.round(cost.after) }),
      good: false,
      weight: 3
    })
  }
  const was = manaSustain(before)
  const now = manaSustain(after)
  if (now?.secondsUntilEmpty != null && now.secondsUntilEmpty < 20 && (was?.secondsUntilEmpty == null || now.secondsUntilEmpty < was.secondsUntilEmpty - 1)) {
    out.push({ text: t('Mana runs out after ~{s} s of non-stop use', { s: Math.max(1, Math.round(now.secondsUntilEmpty)) }), good: false, weight: 12 })
  }
  const spirit = after.SpiritUnreserved
  if (spirit !== undefined && spirit < 0 && (before.SpiritUnreserved ?? 0) >= 0) {
    out.push({ text: t('Not enough Spirit ({n})', { n: Math.round(spirit) }), good: false, weight: 15 })
  }
  return out
}

export interface PassivePointsInfo {
  used: number
  available: number
  campaignLevel: number
  level: number
}

/** Unspent passive points, null when none or when quest points may not all be collected yet. */
export function unspentPoints(p: PassivePointsInfo): number | null {
  if (p.level < p.campaignLevel) return null
  const n = p.available - p.used
  return n > 0 ? n : null
}
