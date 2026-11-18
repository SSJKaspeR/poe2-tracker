import axios, { type AxiosInstance } from 'axios'
import Bottleneck from 'bottleneck'

/**
 * poe.ninja PoE 2 economy API client.
 *
 *   GET /poe2/api/economy/exchange/current/overview?league=&type=
 *   { core: { items, rates, primary, secondary }, lines: [{ id, primaryValue, ... }], items: [{ id, name, ... }] }
 *
 * The API is documented but not guaranteed stable, and abusive clients are
 * blocked: responses are cached locally and refreshed at most once per hour.
 */

export const NINJA_BASE_URL = 'https://poe.ninja'
export const DEFAULT_TTL_MS = 60 * 60 * 1000

export interface PriceCache {
  get(key: string): { payload: string; fetchedAt: number } | null
  set(key: string, payload: string, fetchedAt: number): void
}

export interface ExchangeOverview {
  core?: {
    primary?: string
    secondary?: string
    rates?: Record<string, number>
    items?: NinjaItem[]
  }
  lines: NinjaLine[]
  items: NinjaItem[]
}

export interface NinjaLine {
  id: string
  primaryValue: number
  volumePrimaryValue?: number
}

export interface NinjaItem {
  id: string
  name: string
  image?: string
  category?: string
  detailsId?: string
}

/** Line of /poe2/api/economy/stash/current/item/overview (uniques, tablets). */
export interface StashLine {
  id: number
  detailsId: string
  name: string
  baseType?: string
  variant?: string
  primaryValue: number
  listingCount?: number
}

export interface StashOverview {
  core?: { primary?: string }
  lines: StashLine[]
}

export interface Price {
  id: string
  name: string
  /** Value expressed in the primary currency (usually Divine Orb). */
  value: number
  currency: string
}

export interface PoeNinjaClientOptions {
  cache: PriceCache
  ttlMs?: number
  http?: AxiosInstance
  userAgent?: string
  now?: () => number
}

export class PoeNinjaClient {
  private readonly http: AxiosInstance
  private readonly limiter = new Bottleneck({ maxConcurrent: 1, minTime: 1500 })
  private readonly ttlMs: number
  private readonly cache: PriceCache
  private readonly now: () => number

  constructor(opts: PoeNinjaClientOptions) {
    this.cache = opts.cache
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
    this.now = opts.now ?? Date.now
    this.http =
      opts.http ??
      axios.create({
        baseURL: NINJA_BASE_URL,
        timeout: 15_000,
        headers: { 'User-Agent': opts.userAgent ?? 'poe2-tracker (github.com/SSJKaspeR/poe2-tracker)' }
      })
  }

  /**
   * Exchange overview for one type (Currency, Fragments, Runes, ...).
   * Serves from cache when fresh; on network failure, falls back to stale cache.
   */
  async exchangeOverview(league: string, type: string, opts: { force?: boolean } = {}): Promise<ExchangeOverview> {
    const key = `${league}|exchange|${type}`
    const cached = this.cache.get(key)
    if (cached && !opts.force && this.now() - cached.fetchedAt < this.ttlMs) {
      return JSON.parse(cached.payload) as ExchangeOverview
    }
    try {
      const res = await this.limiter.schedule(() =>
        this.http.get<ExchangeOverview>('/poe2/api/economy/exchange/current/overview', { params: { league, type } })
      )
      this.cache.set(key, JSON.stringify(res.data), this.now())
      return res.data
    } catch (err) {
      if (cached) return JSON.parse(cached.payload) as ExchangeOverview
      throw err
    }
  }

  /** Leagues known to poe.ninja, current challenge league first. Cached for a day. */
  async leagues(): Promise<{ id: string; name: string }[]> {
    const key = 'leagues'
    const cached = this.cache.get(key)
    if (cached && this.now() - cached.fetchedAt < 24 * this.ttlMs) {
      return JSON.parse(cached.payload) as { id: string; name: string }[]
    }
    try {
      const res = await this.limiter.schedule(() =>
        this.http.get<{ id: string; name: string }[]>('/poe2/api/economy/leagues')
      )
      this.cache.set(key, JSON.stringify(res.data), this.now())
      return res.data
    } catch (err) {
      if (cached) return JSON.parse(cached.payload) as { id: string; name: string }[]
      throw err
    }
  }

  async prices(league: string, type: string): Promise<Price[]> {
    return toPrices(await this.exchangeOverview(league, type))
  }

  /** Item overview (uniques, precursor tablets…), same caching rules as the exchange. */
  async stashOverview(league: string, type: string, opts: { force?: boolean } = {}): Promise<StashOverview> {
    const key = `${league}|stash|${type}`
    const cached = this.cache.get(key)
    if (cached && !opts.force && this.now() - cached.fetchedAt < this.ttlMs) {
      return JSON.parse(cached.payload) as StashOverview
    }
    try {
      const res = await this.limiter.schedule(() =>
        this.http.get<StashOverview>('/poe2/api/economy/stash/current/item/overview', { params: { league, type } })
      )
      // Keep only what we use: the full payload carries every modifier and icon.
      const slim: StashOverview = {
        core: { primary: res.data.core?.primary ?? 'divine' },
        lines: (res.data.lines ?? []).map((l) => ({
          id: l.id,
          detailsId: l.detailsId,
          name: l.name,
          baseType: l.baseType,
          variant: l.variant,
          primaryValue: l.primaryValue,
          listingCount: l.listingCount
        }))
      }
      this.cache.set(key, JSON.stringify(slim), this.now())
      return slim
    } catch (err) {
      if (cached) return JSON.parse(cached.payload) as StashOverview
      throw err
    }
  }

  async stashPrices(league: string, type: string): Promise<Price[]> {
    return toStashPrices(await this.stashOverview(league, type))
  }
}

/**
 * Stash lines → prices. Items with variants (tablet rarity) get it in the name:
 * "Abyss Tablet (Rare)". The plain name maps to the cheapest variant, which is
 * the safe default when the player doesn't say which one.
 */
export function toStashPrices(o: StashOverview): Price[] {
  const currency = o.core?.primary ?? 'divine'
  const out: Price[] = []
  const cheapestByName = new Map<string, StashLine>()
  for (const l of o.lines ?? []) {
    if (typeof l.primaryValue !== 'number' || !Number.isFinite(l.primaryValue)) continue
    const name = l.variant ? `${l.name} (${l.variant})` : l.name
    out.push({ id: l.detailsId, name, value: l.primaryValue, currency })
    if (l.variant) {
      const prev = cheapestByName.get(l.name)
      if (!prev || l.primaryValue < prev.primaryValue) cheapestByName.set(l.name, l)
    }
  }
  for (const [name, l] of cheapestByName) {
    out.push({ id: `${l.detailsId}#any`, name, value: l.primaryValue, currency })
  }
  return out
}

/** Join `lines` (values) with `items` (names) into a flat price list. */
export function toPrices(o: ExchangeOverview): Price[] {
  const names = new Map<string, string>()
  for (const it of [...(o.core?.items ?? []), ...(o.items ?? [])]) names.set(it.id, it.name)
  const currency = o.core?.primary ?? 'divine'
  const out: Price[] = []
  for (const line of o.lines ?? []) {
    if (typeof line.primaryValue !== 'number' || !Number.isFinite(line.primaryValue)) continue
    out.push({ id: line.id, name: names.get(line.id) ?? line.id, value: line.primaryValue, currency })
  }
  // The primary currency itself is worth exactly 1 of itself.
  if (!out.some((p) => p.id === currency)) {
    out.push({ id: currency, name: names.get(currency) ?? currency, value: 1, currency })
  }
  return out
}
