import { describe, expect, it } from 'vitest'
import { AppDatabase } from '@core/db/Database'
import { SqlitePriceCache } from '@core/db/SqlitePriceCache'
import { PoeNinjaClient } from '@core/pricing/PoeNinjaClient'
import { EXCHANGE_TYPES, PriceBook, STASH_TYPES } from '@core/pricing/PriceBook'

// Hits the real poe.ninja API. Run manually: npm run test:live
describe('poe.ninja (live)', () => {
  it('loads every category used by the app', async () => {
    const client = new PoeNinjaClient({ cache: new SqlitePriceCache(new AppDatabase(':memory:').db) })
    const leagues = await client.leagues()
    const league = leagues[0]!.id
    const book = new PriceBook()
    const counts: Record<string, number> = {}
    for (const t of EXCHANGE_TYPES) {
      const p = await client.prices(league, t)
      counts[t] = p.length
      p.forEach((x) => book.add(x))
    }
    for (const t of STASH_TYPES) {
      const p = await client.stashPrices(league, t)
      counts[t] = p.length
      p.forEach((x) => book.add(x))
    }
    console.log(league, counts, 'total', book.size)
    for (const [t, n] of Object.entries(counts)) expect(n, t).toBeGreaterThan(0)
    expect(book.get('Divine Orb')?.value).toBe(1)
    expect(book.get('Exalted Orb')!.value).toBeGreaterThan(0)
    expect(book.get('Breach Tablet')!.value).toBeGreaterThan(0)
    console.log('1 div =', Math.round(1 / book.get('Exalted Orb')!.value), 'ex; Breach Tablet =', book.get('Breach Tablet')!.value, 'div')
  }, 120_000)
})
