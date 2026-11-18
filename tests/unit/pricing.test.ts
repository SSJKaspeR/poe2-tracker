import type { AxiosInstance } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '@core/db/Database'
import { SqlitePriceCache } from '@core/db/SqlitePriceCache'
import { PoeNinjaClient, toPrices, type ExchangeOverview } from '@core/pricing/PoeNinjaClient'

// Shape observed on poe.ninja (Nov 2026).
const SAMPLE: ExchangeOverview = {
  core: {
    primary: 'divine',
    secondary: 'chaos',
    rates: { exalted: 272.8 },
    items: [{ id: 'divine', name: 'Divine Orb' }]
  },
  lines: [
    { id: 'alch', primaryValue: 0.006875 },
    { id: 'exalted', primaryValue: 0.003666 }
  ],
  items: [
    { id: 'alch', name: 'Orb of Alchemy' },
    { id: 'exalted', name: 'Exalted Orb' }
  ]
}

function fakeHttp(data: unknown) {
  const get = vi.fn().mockResolvedValue({ data })
  return { http: { get } as unknown as AxiosInstance, get }
}

describe('toPrices', () => {
  it('joins values with names and includes the primary currency', () => {
    const prices = toPrices(SAMPLE)
    expect(prices).toContainEqual({ id: 'alch', name: 'Orb of Alchemy', value: 0.006875, currency: 'divine' })
    expect(prices).toContainEqual({ id: 'divine', name: 'Divine Orb', value: 1, currency: 'divine' })
  })
})

describe('PoeNinjaClient', () => {
  it('calls the documented endpoint and caches for an hour', async () => {
    const db = new AppDatabase(':memory:')
    let now = 1_000_000
    const { http, get } = fakeHttp(SAMPLE)
    const client = new PoeNinjaClient({ cache: new SqlitePriceCache(db.db), http, now: () => now })

    await client.prices('Standard', 'Currency')
    expect(get).toHaveBeenCalledWith('/poe2/api/economy/exchange/current/overview', {
      params: { league: 'Standard', type: 'Currency' }
    })

    now += 30 * 60_000
    await client.prices('Standard', 'Currency')
    expect(get).toHaveBeenCalledTimes(1)

    now += 31 * 60_000
    await client.prices('Standard', 'Currency')
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('falls back to stale cache when the network fails', async () => {
    const db = new AppDatabase(':memory:')
    let now = 0
    const { http, get } = fakeHttp(SAMPLE)
    const client = new PoeNinjaClient({ cache: new SqlitePriceCache(db.db), http, now: () => now })
    await client.prices('Standard', 'Currency')
    get.mockRejectedValueOnce(new Error('offline'))
    now += 2 * 60 * 60_000
    const prices = await client.prices('Standard', 'Currency')
    expect(prices.length).toBeGreaterThan(0)
  })
})

describe('toStashPrices (precursor tablets, real poe.ninja lines Nov 2026)', () => {
  const overview = {
    core: { primary: 'divine' },
    lines: [
      { id: 735, detailsId: 'abyss-tablet-abyss-tablet-rare', name: 'Abyss Tablet', variant: 'Rare', primaryValue: 0.7594 },
      { id: 733, detailsId: 'abyss-tablet-abyss-tablet-normal', name: 'Abyss Tablet', variant: 'Normal', primaryValue: 0.6731 },
      { id: 734, detailsId: 'abyss-tablet-abyss-tablet-magic', name: 'Abyss Tablet', variant: 'Magic', primaryValue: 0.6714 },
      { id: 411, detailsId: 'the-grand-project-irradiated-tablet', name: 'The Grand Project', primaryValue: 3.2 }
    ]
  }

  it('names variants and maps the plain name to the cheapest one', async () => {
    const { toStashPrices } = await import('@core/pricing/PoeNinjaClient')
    const { PriceBook } = await import('@core/pricing/PriceBook')
    const book = new PriceBook(toStashPrices(overview))
    expect(book.get('Abyss Tablet (Rare)')?.value).toBe(0.7594)
    expect(book.get('Abyss Tablet')?.value).toBe(0.6714)
    expect(book.get('The Grand Project')?.value).toBe(3.2)
  })

  it('calls the documented stash endpoint and stores a slim payload', async () => {
    const db = new AppDatabase(':memory:')
    const { http, get } = fakeHttp({ ...overview, lines: overview.lines.map((l) => ({ ...l, explicitModifiers: ['x'] })) })
    const cache = new SqlitePriceCache(db.db)
    const client = new PoeNinjaClient({ cache, http })
    await client.stashPrices('Forbidden Rites', 'PrecursorTablets')
    expect(get).toHaveBeenCalledWith('/poe2/api/economy/stash/current/item/overview', {
      params: { league: 'Forbidden Rites', type: 'PrecursorTablets' }
    })
    expect(cache.get('Forbidden Rites|stash|PrecursorTablets')!.payload).not.toContain('explicitModifiers')
  })
})
