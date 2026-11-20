/**
 * Request budget towards poe.ninja: the app must stay a polite client
 * ("be reasonable with concurrency and volume", "use conditional requests",
 * misbehaving clients get blocked). A fake clock and a fake server count
 * every HTTP request.
 */
import type { AxiosInstance } from 'axios'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '@core/db/Database'
import { SqlitePriceCache } from '@core/db/SqlitePriceCache'
import { EXCHANGE_TYPES, STASH_TYPES } from '@core/pricing/PriceBook'
import { DEFAULT_USER_AGENT, NinjaPausedError, PAUSE_MS, PoeNinjaClient, retryAfterMs } from '@core/pricing/PoeNinjaClient'

const HOUR = 3600_000

interface Reply {
  status: number
  data?: unknown
  headers?: Record<string, string>
}

function setup(reply: (url: string, cfg: { headers?: Record<string, string>; params?: Record<string, string> }) => Reply = () => ({ status: 200, data: { lines: [], items: [] } })) {
  const clock = { now: 1_000_000_000 }
  const calls: { url: string; type?: string; ifNoneMatch?: string }[] = []
  const http = {
    get: async (url: string, cfg: { headers?: Record<string, string>; params?: Record<string, string>; validateStatus?: (s: number) => boolean }) => {
      calls.push({ url, type: cfg.params?.type, ifNoneMatch: cfg.headers?.['If-None-Match'] })
      const r = reply(url, cfg)
      if (cfg.validateStatus && !cfg.validateStatus(r.status)) {
        throw Object.assign(new Error(`HTTP ${r.status}`), { response: { status: r.status, headers: r.headers ?? {} } })
      }
      return { status: r.status, data: r.data, headers: r.headers ?? {} }
    }
  }
  const db = new AppDatabase(':memory:')
  const cache = new SqlitePriceCache(db.db)
  const client = new PoeNinjaClient({ cache, http: http as unknown as AxiosInstance, now: () => clock.now, minTimeMs: 0 })
  return { client, calls, clock, cache, db }
}

/** What the app does on each refresh: every exchange and stash category. */
async function refreshAll(client: PoeNinjaClient) {
  for (const t of EXCHANGE_TYPES) await client.prices('L', t).catch(() => undefined)
  for (const t of STASH_TYPES) await client.stashPrices('L', t).catch(() => undefined)
}

const PER_REFRESH = EXCHANGE_TYPES.length + STASH_TYPES.length

describe('poe.ninja request budget', () => {
  it('a fresh cache sends no request; expired categories are fetched once', async () => {
    const { client, calls, clock } = setup()
    await refreshAll(client)
    expect(calls).toHaveLength(PER_REFRESH)
    await refreshAll(client)
    clock.now += 59 * 60_000
    await refreshAll(client)
    expect(calls).toHaveLength(PER_REFRESH)
    clock.now += 2 * 60_000
    await refreshAll(client)
    expect(calls).toHaveLength(2 * PER_REFRESH)
  })

  it('a whole day of play with restarts stays under one refresh per hour', async () => {
    const { client, calls, clock, cache } = setup()
    // 16 h of play: startup, hourly timer, 4 app restarts (new client, same cache), overlapping refreshes.
    let c = client
    for (let h = 0; h < 16; h++) {
      await refreshAll(c)
      await Promise.all([refreshAll(c), refreshAll(c)]) // timer + manual refresh at once
      if (h % 4 === 3) {
        c = new PoeNinjaClient({ cache, http: (c as unknown as { http: AxiosInstance }).http, now: () => clock.now, minTimeMs: 0 })
        await refreshAll(c) // restart: cache still fresh
      }
      clock.now += HOUR
    }
    expect(calls.length).toBeLessThanOrEqual(16 * PER_REFRESH)
  }, 60_000) // ~1 000 queued lookups: slow on the Windows CI runner

  it('never sends the same request twice at the same time', async () => {
    const { client, calls } = setup()
    await Promise.all(Array.from({ length: 10 }, () => client.prices('L', 'Currency')))
    expect(calls).toHaveLength(1)
  })

  it('uses conditional requests: 304 keeps the cached payload and restarts its freshness', async () => {
    let first = true
    const { client, calls, clock } = setup(() => {
      if (first) {
        first = false
        return { status: 200, data: { lines: [{ id: 'exalted', primaryValue: 0.002 }], items: [{ id: 'exalted', name: 'Exalted Orb' }] }, headers: { etag: '"v1"' } }
      }
      return { status: 304, headers: { etag: '"v1"' } }
    })
    await client.prices('L', 'Currency')
    clock.now += HOUR + 1
    const prices = await client.prices('L', 'Currency')
    expect(calls[1]!.ifNoneMatch).toBe('"v1"')
    expect(prices.find((p) => p.id === 'exalted')?.value).toBe(0.002)
    clock.now += 30 * 60_000
    await client.prices('L', 'Currency')
    expect(calls).toHaveLength(2) // fresh again after the 304
  })

  it('429: pauses for Retry-After, serves the cache, then resumes', async () => {
    let limited = false
    const { client, calls, clock } = setup(() =>
      limited ? { status: 429, headers: { 'retry-after': '120' } } : { status: 200, data: { lines: [], items: [] } }
    )
    await client.prices('L', 'Currency')
    limited = true
    clock.now += HOUR + 1
    await client.prices('L', 'Currency') // 429 → cache served
    expect(client.usage()).toMatchObject({ pauseReason: 'too many requests', pausedUntil: clock.now + 120_000 })
    await refreshAll(client) // paused: nothing is sent
    expect(calls).toHaveLength(2)
    limited = false
    clock.now += 121_000
    await client.prices('L', 'Currency')
    expect(calls).toHaveLength(3)
    expect(client.usage().pausedUntil).toBeNull()
  })

  it('a full refresh stops at the first 429 instead of trying every category', async () => {
    const { client, calls } = setup(() => ({ status: 429 }))
    await refreshAll(client)
    expect(calls).toHaveLength(1)
    expect(client.usage().pausedUntil).toBeGreaterThan(0)
  })

  it('403 backs off for hours; network errors for minutes; a 404 on one category does not pause the rest', async () => {
    const forbidden = setup(() => ({ status: 403 }))
    await refreshAll(forbidden.client)
    expect(forbidden.calls).toHaveLength(1)
    expect(forbidden.client.usage().pausedUntil).toBe(forbidden.clock.now + PAUSE_MS.forbidden)

    const offline = setup(() => {
      throw new Error('ECONNREFUSED')
    })
    await expect(offline.client.prices('L', 'Currency')).rejects.toThrow('ECONNREFUSED')
    await expect(offline.client.prices('L', 'Runes')).rejects.toBeInstanceOf(NinjaPausedError)
    expect(offline.calls).toHaveLength(1)
    expect(offline.client.usage().pausedUntil).toBe(offline.clock.now + PAUSE_MS.serverOrNetwork)

    const missing = setup((_, cfg) => (cfg.params?.type === 'Fragments' ? { status: 404 } : { status: 200, data: { lines: [], items: [] } }))
    await refreshAll(missing.client)
    expect(missing.calls).toHaveLength(PER_REFRESH)
    expect(missing.client.usage().pausedUntil).toBeNull()
  })

  it('reports usage and identifies itself', async () => {
    const { client, clock } = setup()
    await refreshAll(client)
    expect(client.usage()).toMatchObject({ lastHour: PER_REFRESH, last24h: PER_REFRESH })
    clock.now += 2 * HOUR
    expect(client.usage().lastHour).toBe(0)
    expect(DEFAULT_USER_AGENT).toMatch(/PoE2Tracker .*github\.com/)
    expect(retryAfterMs('30', 0)).toBe(30_000)
    expect(retryAfterMs(new Date(60_000).toUTCString(), 0)).toBe(60_000)
    expect(retryAfterMs('soon', 0)).toBeNull()
  })

  it('the requests are spaced out (1.5 s by default)', async () => {
    const db = new AppDatabase(':memory:')
    const times: number[] = []
    const http = { get: async () => (times.push(Date.now()), { status: 200, data: { lines: [], items: [] }, headers: {} }) }
    const client = new PoeNinjaClient({ cache: new SqlitePriceCache(db.db), http: http as unknown as AxiosInstance, minTimeMs: 200 })
    await Promise.all([client.prices('L', 'A'), client.prices('L', 'B'), client.prices('L', 'C')])
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(190)
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(190)
  })
})
