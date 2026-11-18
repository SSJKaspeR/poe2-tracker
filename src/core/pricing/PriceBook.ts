import type { Price } from './PoeNinjaClient'

/**
 * Exchange categories queried on poe.ninja. Unknown categories just come back
 * empty, so this list can be generous.
 * ⚠️ to verify: category names for 1.0 (Waystones / Tablets may not be priced).
 */
export const PRICE_TYPES = [
  'Currency',
  'Fragments',
  'Runes',
  'Essences',
  'SoulCores',
  'Idols',
  'Omens',
  'Breach',
  'Delirium',
  'Expedition',
  'Ritual',
  'Abyss',
  'UncutGems',
  'LineageSupportGems'
] as const

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
