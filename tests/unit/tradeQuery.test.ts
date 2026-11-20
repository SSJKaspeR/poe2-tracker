import { describe, expect, it } from 'vitest'
import {
  MAX_STAT_FILTERS,
  TRADE_BASE_URL,
  buildTradeQuery,
  defaultChoices,
  previewMods,
  tradeSearchUrl,
  type StatChoice,
  type TradeStatWeight
} from '@shared/trade'

const W: TradeStatWeight[] = [
  { tradeId: 'explicit.stat_life', text: '# to maximum Life', weight: 4.76, score: 528, typical: 111 },
  { tradeId: 'explicit.stat_dex', text: '# to Dexterity', weight: 45.2, score: 859, typical: 19 },
  { tradeId: 'explicit.stat_fire', text: '#% to Fire Resistance', weight: 0.5, score: 13, typical: 26 },
  { tradeId: 'explicit.stat_es', text: '# to maximum Energy Shield (Local)', weight: 2.25, score: 110, typical: 49 }
]

describe('trade search', () => {
  it('default selection: best stats weighted, sorted by score', () => {
    const c = defaultChoices(W, 2)
    expect(c.map((x) => [x.tradeId, x.mode])).toEqual([
      ['explicit.stat_dex', 'weighted'],
      ['explicit.stat_life', 'weighted'],
      ['explicit.stat_es', 'off'],
      ['explicit.stat_fire', 'off']
    ])
  })

  it('builds a weighted sum with category, minimum and online status', () => {
    const q = buildTradeQuery(defaultChoices(W, 2), { league: 'Forbidden Rites', category: 'armour.chest', minWeight: 103.2876 })
    expect(q).toEqual({
      query: {
        status: { option: 'online' },
        stats: [
          {
            type: 'weight',
            value: { min: 103.288 },
            filters: [
              { id: 'explicit.stat_dex', value: { weight: 45.2 } },
              { id: 'explicit.stat_life', value: { weight: 4.76 } }
            ]
          }
        ],
        filters: {
          type_filters: { filters: { category: { option: 'armour.chest' }, rarity: { option: 'nonunique' } } },
          misc_filters: { disabled: false, filters: { mirrored: false } }
        }
      },
      sort: { 'statgroup.0': 'desc' },
      engine: 'new'
    })
  })

  it('required stats have a minimum and still rank results; excluded stats are filtered out', () => {
    const choices: StatChoice[] = defaultChoices(W, 1).map((c) =>
      c.tradeId === 'explicit.stat_fire' ? { ...c, mode: 'required', min: 30 } : c.tradeId === 'explicit.stat_es' ? { ...c, mode: 'excluded' } : c
    )
    const q = buildTradeQuery(choices, { league: 'Standard', maxPrice: { amount: 2, currency: 'divine' }, instantBuyout: true }) as {
      query: { status: unknown; stats: { type: string; filters: { id: string; value?: unknown }[] }[]; filters: Record<string, unknown> }
    }
    expect(q.query.status).toEqual({ option: 'securable' })
    expect(q.query.stats.map((s) => s.type)).toEqual(['weight', 'and', 'not'])
    expect(q.query.stats[0]!.filters.map((f) => f.id)).toEqual(['explicit.stat_dex', 'explicit.stat_fire'])
    expect(q.query.stats[1]!.filters).toEqual([{ id: 'explicit.stat_fire', value: { min: 30 } }])
    expect(q.query.stats[2]!.filters).toEqual([{ id: 'explicit.stat_es' }])
    expect(q.query.filters.trade_filters).toEqual({ filters: { price: { option: 'divine', max: 2 } } })
    expect(q.query.stats[0]).not.toHaveProperty('value') // no minimum given
  })

  it('stays under the trade site filter limit', () => {
    const many: StatChoice[] = Array.from({ length: 60 }, (_, i) => ({
      tradeId: `explicit.stat_${i}`,
      text: `#% stat ${i}`,
      weight: 1,
      score: 60 - i,
      typical: 1,
      mode: i < 5 ? 'required' : i < 10 ? 'excluded' : 'weighted'
    }))
    const q = buildTradeQuery(many, { league: 'Standard' }) as { query: { stats: { filters: unknown[] }[] } }
    const total = q.query.stats.reduce((n, s) => n + s.filters.length, 0)
    expect(total).toBeLessThanOrEqual(MAX_STAT_FILTERS + 5) // required stats are in the sum and in the AND group
    expect(q.query.stats[0]!.filters.length).toBe(MAX_STAT_FILTERS - 10)
  })

  it('opens the official PoE 2 trade site for the league, query in ?q=', () => {
    const url = tradeSearchUrl(defaultChoices(W, 1), { league: 'Forbidden Rites', category: 'armour.chest' })
    expect(url.startsWith(`${TRADE_BASE_URL}/Forbidden%20Rites?q=`)).toBe(true)
    const q = JSON.parse(decodeURIComponent(url.split('?q=')[1]!))
    expect(q.query.stats[0].filters[0].id).toBe('explicit.stat_dex')
  })

  it('preview item: required stats at their minimum, weighted stats at the tested value', () => {
    const choices = defaultChoices(W, 3).map((c) => (c.tradeId === 'explicit.stat_fire' ? { ...c, mode: 'required' as const, min: 35 } : c))
    expect(previewMods(choices, 3)).toEqual([
      { tradeId: 'explicit.stat_fire', text: '#% to Fire Resistance', value: 35 },
      { tradeId: 'explicit.stat_dex', text: '# to Dexterity', value: 19 },
      { tradeId: 'explicit.stat_life', text: '# to maximum Life', value: 111 }
    ])
  })
})
