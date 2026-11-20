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
  get(key: string): { payload: string; fetchedAt: number; etag?: string | null } | null
  set(key: string, payload: string, fetchedAt: number, etag?: string | null): void
}

/** poe.ninja asked us to slow down or refused us: requests are paused until `until`. */
export class NinjaPausedError extends Error {
  constructor(readonly until: number, readonly reason: string) {
    super(`poe.ninja paused until ${new Date(until).toISOString()} (${reason})`)
  }
}

/** How long requests pause after each kind of failure (when no Retry-After is given). */
export const PAUSE_MS = {
  tooManyRequests: 60 * 60 * 1000, // 429
  forbidden: 6 * 60 * 60 * 1000, // 401 / 403: possibly blocked, back off hard
  serverOrNetwork: 10 * 60 * 1000 // 5xx, timeouts, offline
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
  /** exchange: currency-like stackables (named by base type); item: uniques and tablets. */
  kind?: 'exchange' | 'item'
}

export interface PoeNinjaClientOptions {
  cache: PriceCache
  ttlMs?: number
  http?: AxiosInstance
  userAgent?: string
  now?: () => number
  /** Minimum delay between two requests. Default 1.5 s. */
  minTimeMs?: number
}

export const DEFAULT_USER_AGENT = 'PoE2Tracker (+https://github.com/SSJKaspeR/poe2-tracker)'

interface CachedFetch<T> {
  key: string
  path: string
  params?: Record<string, string>
  ttlMs: number
  /** Shrink the response before caching it. */
  transform?: (data: T) => T
}

/**
 * Polite client for poe.ninja's documented economy API:
 * - one request at a time, at least 1.5 s apart, identifiable User-Agent
 * - local cache (1 h for prices, 24 h for leagues); fresh cache = no request
 * - conditional requests (If-None-Match / 304) as poe.ninja asks
 * - one request in flight per resource (no duplicates when refreshes overlap)
 * - pauses itself on 429 (honouring Retry-After), 401/403, 5xx and network errors,
 *   serving the cache meanwhile
 */
export class PoeNinjaClient {
  private readonly http: AxiosInstance
  private readonly limiter: Bottleneck
  private readonly ttlMs: number
  private readonly cache: PriceCache
  private readonly now: () => number
  private readonly inFlight = new Map<string, Promise<unknown>>()
  private pausedUntil = 0
  private pauseReason = ''
  /** Timestamps of requests actually sent (last 24 h), for transparency and tests. */
  private sent: number[] = []

  constructor(opts: PoeNinjaClientOptions) {
    this.cache = opts.cache
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
    this.now = opts.now ?? Date.now
    this.limiter = new Bottleneck({ maxConcurrent: 1, minTime: opts.minTimeMs ?? 1500 })
    this.http =
      opts.http ??
      axios.create({
        baseURL: NINJA_BASE_URL,
        timeout: 15_000,
        headers: { 'User-Agent': opts.userAgent ?? DEFAULT_USER_AGENT }
      })
  }

  /** Requests sent recently, and whether requests are paused. */
  usage(): { lastHour: number; last24h: number; pausedUntil: number | null; pauseReason: string | null } {
    const now = this.now()
    this.sent = this.sent.filter((t) => now - t < 24 * 3600_000)
    const paused = this.pausedUntil > now
    return {
      lastHour: this.sent.filter((t) => now - t < 3600_000).length,
      last24h: this.sent.length,
      pausedUntil: paused ? this.pausedUntil : null,
      pauseReason: paused ? this.pauseReason : null
    }
  }

  /** Exchange overview for one type (Currency, Fragments, Runes, ...). */
  exchangeOverview(league: string, type: string): Promise<ExchangeOverview> {
    return this.cached<ExchangeOverview>({
      key: `${league}|exchange|${type}`,
      path: '/poe2/api/economy/exchange/current/overview',
      params: { league, type },
      ttlMs: this.ttlMs
    })
  }

  /** Leagues known to poe.ninja, current challenge league first. Cached for a day. */
  leagues(): Promise<{ id: string; name: string }[]> {
    return this.cached<{ id: string; name: string }[]>({ key: 'leagues', path: '/poe2/api/economy/leagues', ttlMs: 24 * this.ttlMs })
  }

  async prices(league: string, type: string): Promise<Price[]> {
    return toPrices(await this.exchangeOverview(league, type))
  }

  /** Item overview (uniques, precursor tablets…), same caching rules as the exchange. */
  stashOverview(league: string, type: string): Promise<StashOverview> {
    return this.cached<StashOverview>({
      key: `${league}|stash|${type}`,
      path: '/poe2/api/economy/stash/current/item/overview',
      params: { league, type },
      ttlMs: this.ttlMs,
      // Keep only what we use: the full payload carries every modifier and icon.
      transform: (data) => ({
        core: { primary: data.core?.primary ?? 'divine' },
        lines: (data.lines ?? []).map((l) => ({
          id: l.id,
          detailsId: l.detailsId,
          name: l.name,
          baseType: l.baseType,
          variant: l.variant,
          primaryValue: l.primaryValue,
          listingCount: l.listingCount
        }))
      })
    })
  }

  async stashPrices(league: string, type: string): Promise<Price[]> {
    return toStashPrices(await this.stashOverview(league, type))
  }

  private async cached<T>(req: CachedFetch<T>): Promise<T> {
    const cached = this.cache.get(req.key)
    if (cached && this.now() - cached.fetchedAt < req.ttlMs) return JSON.parse(cached.payload) as T
    if (this.pausedUntil > this.now()) {
      if (cached) return JSON.parse(cached.payload) as T
      throw new NinjaPausedError(this.pausedUntil, this.pauseReason)
    }
    const running = this.inFlight.get(req.key) as Promise<T> | undefined
    if (running) return running
    const p = this.fetchAndStore(req).finally(() => this.inFlight.delete(req.key))
    this.inFlight.set(req.key, p)
    return p
  }

  private async fetchAndStore<T>(req: CachedFetch<T>): Promise<T> {
    try {
      return await this.limiter.schedule(async () => {
        // Re-check: an earlier request may have refreshed it, or a pause started meanwhile.
        const cached = this.cache.get(req.key)
        if (cached && this.now() - cached.fetchedAt < req.ttlMs) return JSON.parse(cached.payload) as T
        if (this.pausedUntil > this.now()) throw new NinjaPausedError(this.pausedUntil, this.pauseReason)

        this.sent.push(this.now())
        const res = await this.http.get<T>(req.path, {
          params: req.params,
          headers: cached?.etag ? { 'If-None-Match': cached.etag } : {},
          validateStatus: (s) => (s >= 200 && s < 300) || s === 304
        })
        const etag = headerValue(res.headers, 'etag')
        if (res.status === 304 && cached) {
          // Not modified: keep the payload, restart its freshness.
          this.cache.set(req.key, cached.payload, this.now(), etag ?? cached.etag ?? null)
          return JSON.parse(cached.payload) as T
        }
        const data = req.transform ? req.transform(res.data) : res.data
        this.cache.set(req.key, JSON.stringify(data), this.now(), etag)
        return data
      })
    } catch (err) {
      this.pauseFor(err)
      const cached = this.cache.get(req.key)
      if (cached) return JSON.parse(cached.payload) as T
      throw err
    }
  }

  private pauseFor(err: unknown): void {
    if (err instanceof NinjaPausedError) return
    const e = err as { response?: { status?: number; headers?: unknown } }
    const status = e.response?.status
    let ms: number
    let reason: string
    if (status === 429) {
      const retry = retryAfterMs(headerValue(e.response?.headers, 'retry-after'), this.now())
      ms = retry ?? PAUSE_MS.tooManyRequests
      reason = 'too many requests'
    } else if (status === 401 || status === 403) {
      ms = PAUSE_MS.forbidden
      reason = `refused (${status})`
    } else if (status === undefined || status >= 500) {
      ms = PAUSE_MS.serverOrNetwork
      reason = status ? `server error ${status}` : 'unreachable'
    } else {
      return // 4xx on one resource (e.g. 404 for an unknown category): no global pause
    }
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms)
    this.pauseReason = reason
  }
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null
  const h = headers as Record<string, unknown> & { get?: (n: string) => unknown }
  const v = typeof h.get === 'function' ? h.get(name) : (h[name] ?? h[name.toLowerCase()])
  return typeof v === 'string' ? v : null
}

/** Retry-After as seconds or HTTP date → milliseconds from now. */
export function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null
  const secs = Number(value)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : null
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
    out.push({ id: l.detailsId, name, value: l.primaryValue, currency, kind: 'item' })
    if (l.variant) {
      const prev = cheapestByName.get(l.name)
      if (!prev || l.primaryValue < prev.primaryValue) cheapestByName.set(l.name, l)
    }
  }
  for (const [name, l] of cheapestByName) {
    out.push({ id: `${l.detailsId}#any`, name, value: l.primaryValue, currency, kind: 'item' })
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
    out.push({ id: line.id, name: names.get(line.id) ?? line.id, value: line.primaryValue, currency, kind: 'exchange' })
  }
  // The primary currency itself is worth exactly 1 of itself.
  if (!out.some((p) => p.id === currency)) {
    out.push({ id: currency, name: names.get(currency) ?? currency, value: 1, currency, kind: 'exchange' })
  }
  return out
}
