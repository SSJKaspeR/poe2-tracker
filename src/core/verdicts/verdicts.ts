import { manaSustain, unspentPoints, type PassivePointsInfo } from '../../shared/impact'
/**
 * Verdicts: short, rule-based observations on the player's maps, bosses and build,
 * each backed by numbers and pointing to where to act. No AI, no network: the same
 * data always gives the same verdicts.
 *
 * Every rule needs a minimum sample before saying anything (no conclusion from 2 maps).
 */

export type VerdictArea = 'maps' | 'economy' | 'bosses' | 'build'
export type VerdictSeverity = 'warn' | 'tip' | 'good'

export interface Verdict {
  id: string
  area: VerdictArea
  severity: VerdictSeverity
  title: string
  detail: string
  /** Tab where the player can act on it. */
  tab: 'dashboard' | 'maps' | 'sessions' | 'build'
}

export interface VerdictRun {
  areaName: string | null
  areaId: string
  areaLevel: number
  activeMs: number
  deaths: number
  ended: boolean
  kind?: 'map' | 'boss'
  outcome?: 'kill' | 'fail' | null
  invested: number
  looted: number
  hasLoot: boolean
  strategyName: string | null
  versionLabel: string | null
  /** Build version id, to compare versions in order. */
  versionId?: number | null
}

export interface VerdictBuild {
  level: number | null
  stats: Record<string, number>
  /** Gear findings the player can fix cheaply (empty rune sockets, open mods…). */
  easyGearFixes: number
  /** Passive points used / available (PoB's counting). */
  points?: PassivePointsInfo
}

export interface VerdictInput {
  runs: VerdictRun[]
  build: VerdictBuild | null
  /** Value formatting in the player's currency (e.g. "1.2 div"). */
  money: (divine: number) => string
}

export const MIN = {
  /** Maps before talking about deaths or loot coverage. */
  maps: 8,
  /** Runs of one map / strategy / boss before comparing it. */
  perGroup: 3,
  /** Maps per build version before comparing versions. */
  perVersion: 5
}

const name = (r: VerdictRun) => r.areaName ?? r.areaId
const pct = (x: number) => `${Math.round(x * 100)}%`

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

function groupBy<T>(xs: T[], key: (x: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of xs) {
    const k = key(x)
    if (k === null) continue
    const arr = m.get(k) ?? []
    arr.push(x)
    m.set(k, arr)
  }
  return m
}

/** Profit per hour over runs with declared loot (divine). */
function profitPerHour(runs: VerdictRun[]): number | null {
  const withLoot = runs.filter((r) => r.hasLoot)
  const ms = withLoot.reduce((a, r) => a + r.activeMs, 0)
  if (ms <= 0) return null
  return (withLoot.reduce((a, r) => a + r.looted - r.invested, 0) / ms) * 3_600_000
}

// ── Maps ─────────────────────────────────────────────────────────────────────

function mapVerdicts(maps: VerdictRun[]): Verdict[] {
  const out: Verdict[] = []
  if (maps.length < MIN.maps) return out

  // Deaths
  const withDeath = maps.filter((r) => r.deaths > 0)
  const rate = withDeath.length / maps.length
  if (rate >= 0.25) {
    const byMap = [...groupBy(maps, name)]
      .filter(([, rs]) => rs.length >= MIN.perGroup)
      .map(([n, rs]) => ({ n, rate: rs.filter((r) => r.deaths > 0).length / rs.length, runs: rs.length }))
      .sort((a, b) => b.rate - a.rate)
    const worst = byMap[0] && byMap[0].rate > rate ? byMap[0] : null
    out.push({
      id: 'maps.deaths',
      area: 'maps',
      severity: 'warn',
      title: `You die in ${pct(rate)} of your maps`,
      detail:
        `${withDeath.length} of your last ${maps.length} maps had at least one death` +
        (worst ? `, worst on ${worst.n} (${pct(worst.rate)} of ${worst.runs} runs)` : '') +
        '. Each death costs experience and time: check your defences in the Build tab.',
      tab: 'build'
    })
  } else if (rate === 0 && maps.length >= MIN.maps * 2) {
    out.push({
      id: 'maps.no-deaths',
      area: 'maps',
      severity: 'good',
      title: `No death in your last ${maps.length} maps`,
      detail: 'Your build is safe for this content: you can push harder maps or more juice.',
      tab: 'maps'
    })
  }

  // Slow maps
  const durations = [...groupBy(maps, name)]
    .filter(([, rs]) => rs.length >= MIN.perGroup)
    .map(([n, rs]) => ({ n, avg: rs.reduce((a, r) => a + r.activeMs, 0) / rs.length, runs: rs.length }))
  if (durations.length >= 2) {
    const overall = median(maps.map((r) => r.activeMs))
    const slowest = durations.sort((a, b) => b.avg - a.avg)[0]!
    if (slowest.avg >= overall * 1.5) {
      out.push({
        id: `maps.slow.${slowest.n}`,
        area: 'maps',
        severity: 'tip',
        title: `${slowest.n} takes you much longer`,
        detail: `${formatDuration(slowest.avg)} on average over ${slowest.runs} runs, against ${formatDuration(overall)} for a typical map. Unless it pays more, run it less.`,
        tab: 'maps'
      })
    }
  }
  return out
}

// ── Economy ──────────────────────────────────────────────────────────────────

function compareGroups(
  maps: VerdictRun[],
  key: (r: VerdictRun) => string | null,
  what: string,
  idPrefix: string,
  money: (d: number) => string
): Verdict | null {
  const groups = [...groupBy(
    maps.filter((r) => r.hasLoot),
    key
  )]
    .filter(([, rs]) => rs.length >= MIN.perGroup)
    .map(([n, rs]) => ({ n, perHour: profitPerHour(rs)!, runs: rs.length }))
    .filter((g) => Number.isFinite(g.perHour))
    .sort((a, b) => b.perHour - a.perHour)
  if (groups.length < 2) return null
  const best = groups[0]!
  const worst = groups[groups.length - 1]!
  if (best.perHour <= 0) return null
  const gap = (best.perHour - worst.perHour) / Math.abs(best.perHour)
  if (gap < 0.3) return null
  return {
    id: `${idPrefix}.${best.n}`,
    area: 'economy',
    severity: 'tip',
    title: `${best.n} is your most profitable ${what}`,
    detail: `${money(best.perHour)}/h over ${best.runs} runs, against ${money(worst.perHour)}/h for ${worst.n} (${worst.runs} runs). Favour ${best.n}.`,
    tab: 'maps'
  }
}

function economyVerdicts(maps: VerdictRun[], money: (d: number) => string): Verdict[] {
  const out: Verdict[] = []
  if (maps.length < MIN.maps) return out
  const declared = maps.filter((r) => r.hasLoot).length
  if (declared / maps.length < 0.3) {
    out.push({
      id: 'economy.coverage',
      area: 'economy',
      severity: 'tip',
      title: 'Your profit numbers rest on few maps',
      detail: `Loot is declared on ${declared} of your last ${maps.length} maps. Declare it on more maps (or use a strategy preset) for reliable profit per hour.`,
      tab: 'maps'
    })
  }
  const byMap = compareGroups(maps, name, 'map', 'economy.map', money)
  if (byMap) out.push(byMap)
  const byStrategy = compareGroups(maps, (r) => r.strategyName, 'strategy', 'economy.strategy', money)
  if (byStrategy) out.push(byStrategy)
  return out
}

// ── Build versions ───────────────────────────────────────────────────────────

function versionVerdict(maps: VerdictRun[]): Verdict | null {
  const byVersion = [...groupBy(maps, (r) => (r.versionId == null ? null : String(r.versionId)))]
    .map(([id, rs]) => ({ id: Number(id), label: rs[0]!.versionLabel, rs }))
    .filter((v) => v.rs.length >= MIN.perVersion)
    .sort((a, b) => a.id - b.id)
  if (byVersion.length < 2) return null
  const [prev, last] = byVersion.slice(-2) as [(typeof byVersion)[0], (typeof byVersion)[0]]
  const avg = (rs: VerdictRun[]) => rs.reduce((a, r) => a + r.activeMs, 0) / rs.length
  const deathRate = (rs: VerdictRun[]) => rs.filter((r) => r.deaths > 0).length / rs.length
  const speed = (avg(prev.rs) - avg(last.rs)) / avg(prev.rs)
  const deaths = deathRate(last.rs) - deathRate(prev.rs)
  const label = last.label ?? `version ${last.id}`
  const before = prev.label ?? `version ${prev.id}`
  if (deaths >= 0.15) {
    return {
      id: 'build.version.deaths',
      area: 'build',
      severity: 'warn',
      title: `More deaths since "${label}"`,
      detail: `${pct(deathRate(last.rs))} of maps with a death, against ${pct(deathRate(prev.rs))} with "${before}". The last gear or tree change cost you defence.`,
      tab: 'build'
    }
  }
  if (speed >= 0.1) {
    return {
      id: 'build.version.faster',
      area: 'build',
      severity: 'good',
      title: `Your maps are ${pct(speed)} faster since "${label}"`,
      detail: `${formatDuration(avg(last.rs))} per map on average, against ${formatDuration(avg(prev.rs))} with "${before}".`,
      tab: 'build'
    }
  }
  if (speed <= -0.1) {
    return {
      id: 'build.version.slower',
      area: 'build',
      severity: 'warn',
      title: `Your maps are ${pct(-speed)} slower since "${label}"`,
      detail: `${formatDuration(avg(last.rs))} per map on average, against ${formatDuration(avg(prev.rs))} with "${before}".`,
      tab: 'build'
    }
  }
  return null
}

// ── Bosses ───────────────────────────────────────────────────────────────────

function bossVerdicts(bosses: VerdictRun[]): Verdict[] {
  const out: Verdict[] = []
  for (const [n, rs] of groupBy(
    bosses.filter((r) => r.outcome),
    name
  )) {
    if (rs.length < MIN.perGroup) continue
    const kills = rs.filter((r) => r.outcome === 'kill').length
    const rate = kills / rs.length
    if (rate < 0.5) {
      out.push({
        id: `bosses.${n}`,
        area: 'bosses',
        severity: 'warn',
        title: `${n}: ${kills} kill${kills > 1 ? 's' : ''} in ${rs.length} attempts`,
        detail: 'Each failed attempt burns the fragments. Check your maximum hits taken and damage before the next try.',
        tab: 'build'
      })
    } else if (rate === 1 && rs.length >= MIN.perGroup + 2) {
      out.push({
        id: `bosses.${n}.farm`,
        area: 'bosses',
        severity: 'good',
        title: `${n}: ${kills}/${rs.length} kills`,
        detail: 'You farm it reliably.',
        tab: 'sessions'
      })
    }
  }
  return out
}

// ── Build stats ──────────────────────────────────────────────────────────────

const ELEMENTS = [
  ['FireResist', 'Fire'],
  ['ColdResist', 'Cold'],
  ['LightningResist', 'Lightning']
] as const

const MAX_HITS = [
  ['PhysicalMaximumHitTaken', 'physical'],
  ['FireMaximumHitTaken', 'fire'],
  ['ColdMaximumHitTaken', 'cold'],
  ['LightningMaximumHitTaken', 'lightning'],
  ['ChaosMaximumHitTaken', 'chaos']
] as const

function buildVerdicts(b: VerdictBuild, playsEndgame: boolean): Verdict[] {
  const out: Verdict[] = []
  const s = b.stats
  const endgame = playsEndgame || (b.level ?? 0) >= 65

  const lowRes = ELEMENTS.filter(([k]) => typeof s[k] === 'number' && s[k]! < 75).map(([k, label]) => `${label} ${Math.round(s[k]!)}%`)
  if (lowRes.length) {
    out.push({
      id: 'build.res',
      area: 'build',
      severity: 'warn',
      title: 'Elemental resistances not capped',
      detail: `${lowRes.join(', ')} (cap 75%). Uncapped resistances are the most common cause of deaths: cap them first.`,
      tab: 'build'
    })
  }
  if (endgame && typeof s.ChaosResist === 'number' && s.ChaosResist < 0) {
    out.push({
      id: 'build.chaos',
      area: 'build',
      severity: 'tip',
      title: `Chaos resistance ${Math.round(s.ChaosResist)}%`,
      detail: 'Negative chaos resistance hurts in endgame maps and against pinnacle bosses. Aim for at least 0%.',
      tab: 'build'
    })
  }

  const hits = MAX_HITS.filter(([k]) => typeof s[k] === 'number' && s[k]! > 0).map(([k, label]) => ({ label, v: s[k]! }))
  if (hits.length >= 3) {
    const sorted = [...hits].sort((a, x) => a.v - x.v)
    const weakest = sorted[0]!
    const others = median(sorted.slice(1).map((h) => h.v))
    if (weakest.v < others * 0.6) {
      out.push({
        id: `build.maxhit.${weakest.label}`,
        area: 'build',
        severity: 'warn',
        title: `Weak against ${weakest.label} hits`,
        detail: `You survive a ${weakest.label} hit of at most ${Math.round(weakest.v).toLocaleString('en')}, against ~${Math.round(others).toLocaleString('en')} for the other damage types. A big ${weakest.label} hit is what will one-shot you.`,
        tab: 'build'
      })
    }
  }

  if (endgame && typeof s.EffectiveMovementSpeedMod === 'number' && s.EffectiveMovementSpeedMod < 1.1) {
    const ms = Math.round((s.EffectiveMovementSpeedMod - 1) * 100)
    out.push({
      id: 'build.movespeed',
      area: 'build',
      severity: 'tip',
      title: ms < 0 ? `Movement speed ${ms}%` : `Movement speed only +${ms}%`,
      detail:
        (ms < 0 ? 'Your gear slows you down (heavy armour penalty). ' : '') +
        'Boots with 25–35% movement speed make every map faster: the cheapest profit per hour upgrade.',
      tab: 'build'
    })
  }

  if (typeof s.SpiritUnreserved === 'number' && s.SpiritUnreserved >= 30) {
    out.push({
      id: 'build.spirit',
      area: 'build',
      severity: 'tip',
      title: `${Math.round(s.SpiritUnreserved)} Spirit unused`,
      detail: 'Room for another persistent buff or a meta gem.',
      tab: 'build'
    })
  }

  const unspent = b.points ? unspentPoints(b.points) : null
  if (unspent) {
    out.push({
      id: 'build.unspent-points',
      area: 'build',
      severity: 'warn',
      title: `${unspent} passive point${unspent > 1 ? 's' : ''} not spent`,
      detail: `${b.points!.used} of ${b.points!.available} points used (all quest points counted). Free power: see the best next points in Build → Optimisations.`,
      tab: 'build'
    })
  }

  const mana = manaSustain(s)
  if (mana?.secondsUntilEmpty != null && mana.secondsUntilEmpty < 20) {
    const secs = Math.max(1, Math.round(mana.secondsUntilEmpty))
    out.push({
      id: 'build.mana',
      area: 'build',
      severity: secs < 10 ? 'warn' : 'tip',
      title: `Your main skill runs out of mana after ~${secs} s`,
      detail: `It costs ${Math.round(mana.perSecond)} mana per second used non-stop, you regenerate ${Math.round(mana.regen)}. More mana regeneration, leech or a cheaper support fixes it.`,
      tab: 'build'
    })
  }

  if (b.easyGearFixes > 0) {
    out.push({
      id: 'build.gear',
      area: 'build',
      severity: 'tip',
      title: `${b.easyGearFixes} easy gear improvement${b.easyGearFixes > 1 ? 's' : ''}`,
      detail: 'Empty rune sockets, open affixes or low-level items: cheap fixes listed in the Build tab.',
      tab: 'build'
    })
  }
  return out
}

const ORDER: Record<VerdictSeverity, number> = { warn: 0, tip: 1, good: 2 }

/** All verdicts, most important first. */
export function computeVerdicts(input: VerdictInput): Verdict[] {
  const ended = input.runs.filter((r) => r.ended)
  const maps = ended.filter((r) => (r.kind ?? 'map') === 'map')
  const bosses = ended.filter((r) => r.kind === 'boss')
  const playsEndgame = maps.some((r) => r.areaLevel >= 65)
  const out = [
    ...(input.build ? buildVerdicts(input.build, playsEndgame) : []),
    ...mapVerdicts(maps),
    ...bossVerdicts(bosses),
    ...economyVerdicts(maps, input.money)
  ]
  const v = versionVerdict(maps)
  if (v) out.push(v)
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
}
