/**
 * Passive tree and support gem suggestions from Path of Building numbers, ranked and
 * worded for players. PoB measures single-target damage and effective HP: anything
 * else (clear speed, utility) is pointed out, not judged.
 */
import { costWarnings, summarizeImpact, unspentPoints, type ImpactLine } from '../../shared/impact'
import type { SupportOptions, TreeOptions } from '../pob/PobBridge'

export interface TreeAdd {
  id: number
  name: string
  kind: string
  stats: string[]
  /** Points needed, path included. */
  cost: number
  via: string[]
  pathIds: number[]
  score: number
  perPoint: number
  impact: ImpactLine[]
}

export interface TreeRemove {
  id: number
  name: string
  kind: string
  stats: string[]
  /** Points freed (the node and what only it connects). */
  cost: number
  ids: number[]
  /** What removing it costs (score, ≥ 0 means a loss). */
  loss: number
  impact: ImpactLine[]
}

export interface PointsSummary {
  used: number
  available: number
  /** Points left to spend (null: none, or quest points maybe not all collected yet). */
  unspent: number | null
}

export function pointsSummary(data: TreeOptions): PointsSummary {
  return { used: data.points.used, available: data.points.available, unspent: unspentPoints(data.points) }
}

/** Best next points per point spent, and the allocated points that bring the least. */
export function rankTree(data: TreeOptions, top = 5): { adds: TreeAdd[]; removes: TreeRemove[] } {
  const seen = new Set<string>()
  const adds = data.adds
    .map((a) => {
      const imp = summarizeImpact(a.diff, data.before)
      return {
        id: a.id,
        name: a.name,
        kind: a.kind,
        stats: a.stats,
        cost: a.cost,
        via: a.via,
        pathIds: a.pathIds,
        score: imp.score,
        perPoint: imp.score / Math.max(1, a.cost),
        impact: imp.lines
      }
    })
    .filter((a) => a.score > 0.3 && a.impact.length > 0)
    .sort((a, b) => b.perPoint - a.perPoint || a.cost - b.cost)
    // The same small passive appears in several places: keep the closest.
    .filter((a) => {
      const key = `${a.name}|${a.impact.map((l) => l.text).join()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, top)

  const removes = data.removes
    .map((r) => {
      // diff goes from "now" to "without": a loss shows as a negative score.
      const imp = summarizeImpact(r.diff, data.before)
      return {
        id: r.id,
        name: r.name,
        kind: r.kind,
        stats: r.stats,
        cost: r.cost,
        ids: r.ids,
        loss: -imp.score,
        impact: imp.lines.filter((l) => !l.good)
      }
    })
    .sort((a, b) => a.loss / a.cost - b.loss / b.cost)
    .slice(0, top)
  return { adds, removes }
}

export interface TreeSwapCandidate {
  add: TreeAdd
  remove: TreeRemove
}

/** Respec pairs worth checking: the removal frees enough points and is not on the new path. */
export function swapCandidates(adds: TreeAdd[], removes: TreeRemove[], max = 6): TreeSwapCandidate[] {
  const out: TreeSwapCandidate[] = []
  for (const add of adds.slice(0, 3)) {
    for (const remove of removes.slice(0, 4)) {
      if (remove.cost < add.cost) continue
      if (remove.ids.some((id) => add.pathIds.includes(id))) continue
      if (remove.loss >= add.score) continue
      out.push({ add, remove })
    }
  }
  return out.slice(0, max)
}

export interface CurrentSupport {
  name: string
  /** What the support brings now (score); negative = PoB's damage number is lower with it. */
  score: number
  impact: ImpactLine[]
  /** Explanation when PoB's numbers can't capture the support's value. */
  note: string | null
}

export interface SupportCandidate {
  id: string
  name: string
  tier: number | null
  family: string | null
  lineage: boolean
  price: number | null
  score: number
  impact: ImpactLine[]
  /** Current support of the same family: they don't stack, this one would replace it. */
  replaces: string | null
  /** Cost problems it would cause (mana per use, mana running out, Spirit). */
  costs: ImpactLine[]
}

export interface SupportSwap {
  remove: string
  add: string
  score: number
  impact: ImpactLine[]
  costs: ImpactLine[]
}

export function rankSupports(
  data: SupportOptions,
  priceOf: (name: string) => number | null,
  top = 6
): { skill: string | null; current: CurrentSupport[]; candidates: SupportCandidate[] } {
  const current = data.current.map((c) => {
    // diff goes from "without" to "with": what the support brings.
    const imp = summarizeImpact(c.diff, data.before)
    let note: string | null = null
    if (imp.score < -0.5) {
      note =
        "Lowers Path of Building's single-target damage. Keep it if it helps you otherwise (more projectiles or area for clearing, utility)."
    } else if (imp.lines.length === 0) {
      note = "No effect on Path of Building's numbers: it may help in ways PoB doesn't measure (clear, utility), or not at all."
    }
    return { name: c.name, score: imp.score, impact: imp.lines, note }
  })

  const families = (f: string | null | undefined) => (f ? f.split(/,\s*/) : [])
  const sameFamily = (f: string | null | undefined) =>
    data.current.find((cur) => families(cur.family).some((x) => families(f).includes(x)))?.name ?? null
  const byFamily = new Map<string, SupportCandidate>()
  for (const c of data.candidates) {
    const imp = summarizeImpact(c.diff, data.before)
    if (imp.score <= 0.5 || imp.lines.length === 0) continue
    const cand: SupportCandidate = {
      id: c.id,
      name: c.name,
      tier: c.tier ?? null,
      family: c.family ?? null,
      lineage: c.lineage,
      price: priceOf(c.name),
      score: imp.score,
      impact: imp.lines,
      replaces: sameFamily(c.family),
      costs: costWarnings(data.before, c.diff)
    }
    // Supports of one family don't stack: keep the best of each.
    const key = c.family ?? c.name
    const prev = byFamily.get(key)
    if (!prev || cand.score > prev.score) byFamily.set(key, cand)
  }
  const candidates = [...byFamily.values()].sort((a, b) => b.score - a.score).slice(0, top)
  return { skill: data.skill, current, candidates }
}

/**
 * For each tried candidate, the best support to replace with it; only real improvements.
 * Supports whose value PoB can't see (`keep`: they lower or don't change its numbers, e.g.
 * Multishot for clearing) are never proposed for replacement: their note explains it.
 */
export function rankSupportSwaps(data: SupportOptions, keep: string[] = [], top = 3): SupportSwap[] {
  const best = new Map<string, SupportSwap>()
  for (const s of data.swaps) {
    if (keep.includes(s.remove)) continue
    const imp = summarizeImpact(s.diff, data.before)
    if (imp.score <= 0.5) continue
    const prev = best.get(s.add)
    if (!prev || imp.score > prev.score) {
      best.set(s.add, { remove: s.remove, add: s.add, score: imp.score, impact: imp.lines, costs: costWarnings(data.before, s.diff) })
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, top)
}
