import { describe, expect, it } from 'vitest'
import { itemVerdict, summarizeImpact, type StatDiff } from '../../src/shared/impact'

const d = (before: number, after: number) => ({ before, after, delta: after - before })

describe('impact in plain words', () => {
  it('damage, survivability, resistance cap, movement speed', () => {
    const diff: StatDiff = {
      CombinedDPS: d(1000, 1120),
      TotalEHP: d(5000, 4800),
      FireResist: d(60, 75),
      ColdResist: d(75, 70),
      EffectiveMovementSpeedMod: d(1.2, 1.1),
      Life: d(2000, 1900)
    }
    const i = summarizeImpact(diff, {})
    expect(i.dps).toBeCloseTo(12)
    expect(i.ehp).toBeCloseTo(-4)
    expect(i.lines.map((l) => l.text)).toEqual([
      'Cold resistance drops below the cap: 70%',
      'Fire resistance capped (75%)',
      '+12% damage',
      '-10% movement speed',
      '-4% survivability (effective HP)',
      '-100 life'
    ])
  })

  it('small changes are ignored; uncapped resistance gains are explained', () => {
    const i = summarizeImpact({ CombinedDPS: d(1000, 1002), ChaosResist: d(-20, -5) }, {})
    expect(i.lines.map((l) => l.text)).toEqual(['Chaos resistance +15% (now -5%)'])
  })
})

describe('comparison verdict', () => {
  const imp = (diff: StatDiff) => summarizeImpact(diff, {})

  it('clear upgrade, downgrade, no change', () => {
    expect(itemVerdict(imp({ CombinedDPS: d(100, 112), FireResist: d(60, 75) }), null)).toEqual({
      tone: 'better',
      text: 'Upgrade: Fire resistance capped (75%), +12% damage.'
    })
    expect(itemVerdict(imp({ TotalEHP: d(100, 90) }), null).tone).toBe('worse')
    expect(itemVerdict(imp({}), null)).toEqual({ tone: 'same', text: 'No real difference for your build.' })
  })

  it('never recommends losing the resistance cap, even for damage', () => {
    const v = itemVerdict(imp({ CombinedDPS: d(100, 150), LightningResist: d(75, 60) }), 0)
    expect(v.tone).toBe('worse')
    expect(v.text).toMatch(/^Not recommended: Lightning resistance drops below the cap: 60%/)
  })

  it('damage for defence depends on how often the player dies', () => {
    const trade = imp({ CombinedDPS: d(100, 120), TotalEHP: d(100, 92) })
    expect(itemVerdict(trade, 0.4).text).toMatch(/You already die in 40% of your maps: not recommended/)
    expect(itemVerdict(trade, 0.05).text).toMatch(/You rarely die \(5% of maps\): worth it/)
    expect(itemVerdict(trade, null).text).toMatch(/^Gains: \+20% damage\. Losses: -8% survivability/)
    const safer = imp({ CombinedDPS: d(100, 95), TotalEHP: d(100, 115) })
    expect(itemVerdict(safer, 0.3).text).toMatch(/You die in 30% of your maps: worth it/)
  })
})
