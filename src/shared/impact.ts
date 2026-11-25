/**
 * Turns a PoB stat difference into plain sentences and one score, so every gear
 * suggestion speaks the same language: "+9% damage", "Fire resistance capped (75%)".
 */

export type StatMap = Record<string, number>
export type StatDiff = Record<string, { before: number; after: number; delta: number }>

export interface ImpactLine {
  text: string
  good: boolean
  /** How much it matters, to keep the top lines (percent-like). */
  weight: number
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

const RES = [
  ['FireResist', 'Fire resistance'],
  ['ColdResist', 'Cold resistance'],
  ['LightningResist', 'Lightning resistance'],
  ['ChaosResist', 'Chaos resistance']
] as const

const CAP = 75

function pct(before: number, after: number): number {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 0
  if (Math.abs(before) < 1e-9) return after > 0 ? 100 : 0
  return ((after - before) / Math.abs(before)) * 100
}

const fmtPct = (x: number) => `${x > 0 ? '+' : ''}${Math.abs(x) >= 10 ? Math.round(x) : Math.round(x * 10) / 10}%`

export function summarizeImpact(diff: StatDiff, before: StatMap): Impact {
  const lines: ImpactLine[] = []
  const get = (k: string) => diff[k]
  const d = get('CombinedDPS')
  const dps = d ? pct(d.before, d.after) : 0
  const e = get('TotalEHP')
  const ehp = e ? pct(e.before, e.after) : 0

  if (Math.abs(dps) >= 0.5) lines.push({ text: `${fmtPct(dps)} damage`, good: dps > 0, weight: Math.abs(dps) })
  if (Math.abs(ehp) >= 0.5) lines.push({ text: `${fmtPct(ehp)} survivability (effective HP)`, good: ehp > 0, weight: Math.abs(ehp) })

  // Resistances: what matters is reaching or losing the 75% cap.
  let resFix = 0
  for (const [k, label] of RES) {
    const r = get(k)
    if (!r) continue
    const isChaos = k === 'ChaosResist'
    const capped = (v: number) => v >= CAP
    if (!capped(r.before) && capped(r.after)) {
      lines.push({ text: `${label} capped (${CAP}%)`, good: true, weight: 15 })
      resFix += CAP - r.before
    } else if (capped(r.before) && !capped(r.after)) {
      lines.push({ text: `${label} drops below the cap: ${Math.round(r.after)}%`, good: false, weight: 20 })
      resFix -= CAP - r.after
    } else if (!capped(r.after) && Math.abs(r.delta) >= 1) {
      const text = `${label} ${r.delta > 0 ? '+' : ''}${Math.round(r.delta)}% (now ${Math.round(r.after)}%)`
      lines.push({ text, good: r.delta > 0, weight: Math.min(Math.abs(r.delta), isChaos ? 8 : 12) })
      resFix += isChaos ? r.delta / 2 : r.delta
    }
  }

  const ms = get('EffectiveMovementSpeedMod')
  if (ms && Math.abs(ms.delta) >= 0.01) {
    const p = Math.round(ms.delta * 100)
    lines.push({ text: `${p > 0 ? '+' : ''}${p}% movement speed`, good: p > 0, weight: Math.abs(p) / 2 })
  }
  for (const [k, label] of [
    ['Life', 'life'],
    ['EnergyShield', 'energy shield'],
    ['Spirit', 'Spirit']
  ] as const) {
    const s = get(k)
    if (s && Math.abs(s.delta) >= 1 && Math.abs(pct(s.before, s.after)) >= 2) {
      lines.push({ text: `${s.delta > 0 ? '+' : ''}${Math.round(s.delta)} ${label}`, good: s.delta > 0, weight: Math.abs(pct(s.before, s.after)) / 3 })
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
export function itemVerdict(impact: Impact, deathRate: number | null): ItemVerdict {
  const losesCap = impact.lines.some((l) => !l.good && l.text.includes('below the cap'))
  const up = impact.lines.filter((l) => l.good)
  const down = impact.lines.filter((l) => !l.good)
  const top = (ls: ImpactLine[]) => ls.slice(0, 2).map((l) => l.text).join(', ')

  if (losesCap) {
    return {
      tone: 'worse',
      text: `Not recommended: ${down.find((l) => l.text.includes('below the cap'))!.text}. Fix your resistances elsewhere first.`
    }
  }
  if (!up.length && !down.length) return { tone: 'same', text: 'No real difference for your build.' }
  if (!down.length) return { tone: 'better', text: `Upgrade: ${top(up)}.` }
  if (!up.length) return { tone: 'worse', text: `Downgrade: ${top(down)}.` }

  // Mixed: damage against defence.
  const moreDamage = impact.dps > 0 && impact.ehp < 0
  const moreDefence = impact.ehp > 0 && impact.dps < 0
  const pct = deathRate === null ? null : Math.round(deathRate * 100)
  if (moreDamage && deathRate !== null) {
    if (deathRate >= 0.25) {
      return { tone: 'mixed', text: `More damage (${top(up)}) but less defence (${top(down)}). You already die in ${pct}% of your maps: not recommended.` }
    }
    if (deathRate <= 0.1) {
      return { tone: 'mixed', text: `More damage (${top(up)}) for less defence (${top(down)}). You rarely die (${pct}% of maps): worth it.` }
    }
  }
  if (moreDefence && deathRate !== null && deathRate >= 0.25) {
    return { tone: 'mixed', text: `Safer (${top(up)}) at the cost of ${top(down)}. You die in ${pct}% of your maps: worth it.` }
  }
  return {
    tone: impact.score > 0 ? 'mixed' : 'worse',
    text: `Gains: ${top(up)}. Losses: ${top(down)}. ${impact.score > 0 ? 'Slightly better overall.' : 'Slightly worse overall.'}`
  }
}
