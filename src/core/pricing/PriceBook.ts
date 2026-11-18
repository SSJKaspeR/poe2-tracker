import type { Price } from './PoeNinjaClient'

/**
 * Categories from the poe.ninja API docs (verified against the live API, Nov 2026).
 * Omens are listed under Ritual. Waystones are not priced: use a manual value.
 */
export const EXCHANGE_TYPES = [
  'Currency',
  'Fragments',
  'Abyss',
  'UncutGems',
  'LineageSupportGems',
  'Essences',
  'SoulCores',
  'Idols',
  'Runes',
  'Ritual',
  'Expedition',
  'Delirium',
  'Breach',
  'Verisium'
] as const

/** Item (stash) overview categories needed for investment tracking. Uniques come with the upgrade finder. */
export const STASH_TYPES = ['PrecursorTablets', 'UniqueTablets'] as const

/** Lookup table over every cached price, by poe.ninja id or by item name. */
export class PriceBook {
  private readonly byId = new Map<string, Price>()
  private readonly byName = new Map<string, Price>()

  constructor(prices: Price[] = []) {
    for (const p of prices) this.add(p)
  }

  add(p: Price): void {
    this.byId.set(p.id, p)
    this.byName.set(normalise(p.name), p)
  }

  get size(): number {
    return this.byId.size
  }

  get(idOrName: string): Price | undefined {
    return this.byId.get(idOrName) ?? this.byName.get(normalise(idOrName))
  }

  /** Simple contains search for the item picker. */
  search(query: string, limit = 20): Price[] {
    const q = normalise(query)
    if (!q) return []
    const out: Price[] = []
    for (const p of this.byId.values()) {
      if (normalise(p.name).includes(q)) out.push(p)
    }
    out.sort((a, b) => {
      const as = normalise(a.name).startsWith(q) ? 0 : 1
      const bs = normalise(b.name).startsWith(q) ? 0 : 1
      return as - bs || a.name.localeCompare(b.name)
    })
    return out.slice(0, limit)
  }
}

function normalise(s: string): string {
  return s.trim().toLowerCase()
}
