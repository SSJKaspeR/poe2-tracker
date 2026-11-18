import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '@core/db/Database'
import { RunRepository } from '@core/db/RunRepository'
import { Economy } from '@core/economy/Economy'
import { PriceBook } from '@core/pricing/PriceBook'
import type { Run } from '@core/runs/RunTracker'

const prices = new PriceBook([
  { id: 'divine', name: 'Divine Orb', value: 1, currency: 'divine' },
  { id: 'exalted', name: 'Exalted Orb', value: 0.004, currency: 'divine' },
  { id: 'breach-tablet', name: 'Breach Precursor Tablet', value: 0.02, currency: 'divine' },
  { id: 'breach-splinter', name: 'Breach Splinter', value: 0.001, currency: 'divine' }
])

function run(id: string, startIso: string, activeMin: number, ended = true): Run {
  const startedAt = new Date(startIso)
  return {
    id,
    areaId: 'MapCrypt',
    areaName: 'Crypt',
    areaLevel: 80,
    seed: 1,
    instanceIp: null,
    startedAt,
    endedAt: ended ? new Date(startedAt.getTime() + activeMin * 60_000) : null,
    activeMs: activeMin * 60_000,
    deaths: 0,
    reentries: 0
  }
}

describe('Economy', () => {
  let db: AppDatabase
  let runs: RunRepository
  let eco: Economy

  beforeEach(() => {
    db = new AppDatabase(':memory:')
    runs = new RunRepository(db.db)
    eco = new Economy(db.db, () => prices)
  })

  it('prices a strategy preset, with manual values for unpriced items', () => {
    const p = eco.createPreset('T15 Breach', [
      { kind: 'waystone', label: 'Waystone (Tier 15)', quantity: 1, manualValue: 0.05 },
      { kind: 'tablet', label: 'Breach Precursor Tablet', itemId: 'breach-tablet', quantity: 0.1 }, // 1 charge of 10
      { kind: 'currency', label: 'Mystery Orb', quantity: 1 }
    ])
    const cost = eco.presetCost(p)
    expect(cost.total).toBeCloseTo(0.05 + 0.002)
    expect(cost.unpriced).toEqual(['Mystery Orb'])
  })

  it('computes profit and profit per hour over completed runs', () => {
    const preset = eco.createPreset('T15', [
      { kind: 'waystone', label: 'Waystone', quantity: 1, manualValue: 0.05 },
      { kind: 'tablet', label: 'Breach Precursor Tablet', quantity: 1 }
    ])
    runs.upsert(run('a', '2026-11-18T19:00:00Z', 6))
    runs.upsert(run('b', '2026-11-18T19:10:00Z', 6))
    runs.upsert(run('c', '2026-11-18T19:20:00Z', 3, false)) // still running: excluded
    eco.applyPreset('a', preset.id)
    eco.applyPreset('b', preset.id)
    eco.addLoot('a', { label: 'Divine Orb', quantity: 1 })
    eco.addLoot('b', { label: 'exalted', itemId: 'exalted', quantity: 30 })

    const s = eco.summary()
    expect(s.runs).toBe(2)
    expect(s.invested).toBeCloseTo(2 * 0.07)
    expect(s.looted).toBeCloseTo(1 + 0.12)
    expect(s.profit).toBeCloseTo(1.12 - 0.14)
    expect(s.profitPerHour).toBeCloseTo((0.98 / 12) * 60) // 12 min of maps
    expect(s.runsWithLoot).toBe(2)

    expect(eco.summary({ strategyId: preset.id }).runs).toBe(2)
    expect(eco.summary({ since: new Date('2026-11-18T19:05:00Z') }).runs).toBe(1)
  })

  it('re-applying a preset replaces the investment instead of adding to it', () => {
    const p1 = eco.createPreset('cheap', [{ kind: 'waystone', label: 'W', quantity: 1, manualValue: 0.01 }])
    const p2 = eco.createPreset('juiced', [{ kind: 'waystone', label: 'W', quantity: 1, manualValue: 0.2 }])
    runs.upsert(run('a', '2026-11-18T19:00:00Z', 5))
    eco.applyPreset('a', p1.id)
    eco.applyPreset('a', p2.id)
    const lines = eco.runLines('a')
    expect(lines.investments).toHaveLength(1)
    expect(lines.investments[0]!.unitValue).toBe(0.2)
    expect(lines.strategyId).toBe(p2.id)
  })

  it('freezes values at declaration time', () => {
    const book = new PriceBook([{ id: 'divine', name: 'Divine Orb', value: 1, currency: 'divine' }])
    const e = new Economy(db.db, () => book)
    runs.upsert(run('a', '2026-11-18T19:00:00Z', 5))
    e.addLoot('a', { label: 'Divine Orb', quantity: 2 })
    book.add({ id: 'divine', name: 'Divine Orb', value: 999, currency: 'divine' })
    expect(e.summary().looted).toBe(2)
  })

  it('deleting a preset keeps the runs and their declared values', () => {
    const p = eco.createPreset('x', [{ kind: 'waystone', label: 'W', quantity: 1, manualValue: 0.1 }])
    runs.upsert(run('a', '2026-11-18T19:00:00Z', 5))
    eco.applyPreset('a', p.id)
    eco.deletePreset(p.id)
    expect(eco.presets()).toHaveLength(0)
    expect(eco.summary().invested).toBeCloseTo(0.1)
  })
})

describe('PriceBook', () => {
  it('finds prices by id or name and searches', () => {
    expect(prices.get('exalted')?.value).toBe(0.004)
    expect(prices.get('breach splinter')?.id).toBe('breach-splinter')
    expect(prices.search('breach').map((p) => p.id)).toEqual(['breach-tablet', 'breach-splinter'])
    expect(prices.search('orb')[0]?.name).toBe('Divine Orb')
  })
})
