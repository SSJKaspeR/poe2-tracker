/**
 * Pre-filled searches on the official PoE 2 trade site.
 *
 * The app never calls the trade API: it builds the same query the site would
 * send and opens https://www.pathofexile.com/trade2/search/poe2/<league>?q=<json>
 * in the browser, where the player searches with their own account.
 *
 * Stats come from PoB's trade query generator (weights per stat for this build
 * and slot); the player can force a stat (with a minimum), exclude one, or drop it.
 */

export const TRADE_BASE_URL = 'https://www.pathofexile.com/trade2/search/poe2'

/** The trade site rejects queries with too many stat filters. Same budget as PoB. */
export const MAX_STAT_FILTERS = 35

export interface TradeStatWeight {
  tradeId: string
  /** Trade site text, e.g. "# to maximum Life". */
  text: string
  /** PoB weight per point of this stat for this build and slot. */
  weight: number
  /** PoB score of the stat at its typical value (for ranking and display). */
  score: number
  /** Value PoB tested (middle of the roll range for this slot). */
  typical: number
}

export type StatMode = 'weighted' | 'required' | 'excluded' | 'off'

export interface StatChoice extends TradeStatWeight {
  mode: StatMode
  /** Minimum value when the stat is required. */
  min?: number
}

export interface TradeSearchOptions {
  league: string
  /** Trade category, e.g. "armour.chest" (from PoB). */
  category?: string
  /**
   * Minimum weighted sum. PoB proposes one that roughly matches your current
   * item, so results are upgrades. Null or 0 = no minimum.
   */
  minWeight?: number | null
  maxPrice?: { amount: number; currency: 'divine' | 'exalted' } | null
  /** Only items with instant buyout. Default: any online seller. */
  instantBuyout?: boolean
}

/** Default selection: the best stats weighted, the rest off. */
export function defaultChoices(weights: TradeStatWeight[], weightedCount = 8): StatChoice[] {
  return [...weights]
    .sort((a, b) => b.score - a.score)
    .map((w, i) => ({ ...w, mode: i < weightedCount ? 'weighted' : 'off' }))
}

export function buildTradeQuery(choices: StatChoice[], opts: TradeSearchOptions): Record<string, unknown> {
  const required = choices.filter((c) => c.mode === 'required')
  const excluded = choices.filter((c) => c.mode === 'excluded')
  const budget = Math.max(0, MAX_STAT_FILTERS - required.length - excluded.length)
  // Required stats also count in the weighted sum, so better rolls rank first.
  const weighted = choices
    .filter((c) => c.mode === 'weighted' || c.mode === 'required')
    .filter((c) => c.weight !== 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, budget)

  const stats: Record<string, unknown>[] = []
  if (weighted.length > 0) {
    stats.push({
      type: 'weight',
      ...(opts.minWeight && opts.minWeight > 0 ? { value: { min: round(opts.minWeight) } } : {}),
      filters: weighted.map((c) => ({ id: c.tradeId, value: { weight: round(c.weight) } }))
    })
  }
  if (required.length > 0) {
    stats.push({
      type: 'and',
      filters: required.map((c) => ({ id: c.tradeId, ...(c.min !== undefined ? { value: { min: c.min } } : {}) }))
    })
  }
  if (excluded.length > 0) {
    stats.push({ type: 'not', filters: excluded.map((c) => ({ id: c.tradeId })) })
  }

  const filters: Record<string, unknown> = {
    type_filters: {
      filters: {
        ...(opts.category ? { category: { option: opts.category } } : {}),
        rarity: { option: 'nonunique' }
      }
    },
    // Same form as PoB's own trade queries.
    misc_filters: { disabled: false, filters: { mirrored: false } }
  }
  if (opts.maxPrice && opts.maxPrice.amount > 0) {
    filters.trade_filters = { filters: { price: { option: opts.maxPrice.currency, max: opts.maxPrice.amount } } }
  }

  return {
    query: {
      status: { option: opts.instantBuyout ? 'securable' : 'online' },
      stats,
      filters
    },
    sort: weighted.length > 0 ? { 'statgroup.0': 'desc' } : { price: 'asc' },
    engine: 'new'
  }
}

export function tradeSearchUrl(choices: StatChoice[], opts: TradeSearchOptions): string {
  const q = JSON.stringify(buildTradeQuery(choices, opts))
  return `${TRADE_BASE_URL}/${encodeURIComponent(opts.league)}?q=${encodeURIComponent(q)}`
}

/**
 * Stat lines for the preview item: required stats at their minimum, weighted
 * stats at the value PoB tested. Used to show what such an item would give.
 */
export function previewMods(choices: StatChoice[], maxWeighted = 6): { tradeId: string; text: string; value: number }[] {
  const required = choices.filter((c) => c.mode === 'required')
  const weighted = choices
    .filter((c) => c.mode === 'weighted')
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, maxWeighted - required.length))
  return [
    ...required.map((c) => ({ tradeId: c.tradeId, text: c.text, value: c.min ?? c.typical })),
    ...weighted.map((c) => ({ tradeId: c.tradeId, text: c.text, value: c.typical }))
  ]
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
