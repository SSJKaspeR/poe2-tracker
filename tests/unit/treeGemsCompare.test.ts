import { describe, expect, it } from 'vitest'
import { compareSkills, compareTree, type SkillGroup, type TreeDetail } from '@core/build/treeGemsCompare'

const n = (id: number, name: string, kind: 'keystone' | 'notable' | 'normal' | 'ascendancy' | 'jewel' = 'normal') => ({ id, name, kind })

describe('compareTree', () => {
  const guide: TreeDetail = {
    ascendancy: 'Deadeye',
    pointsUsed: 6,
    nodes: [n(1, 'a'), n(2, 'b'), n(3, 'Honed Instincts', 'notable'), n(4, 'Clean Shot', 'notable'), n(5, 'Heartstopper', 'keystone'), n(6, 'j', 'jewel'), n(90, 'Point Blank', 'ascendancy')]
  }
  const player: TreeDetail = {
    ascendancy: 'Deadeye',
    pointsUsed: 4,
    nodes: [n(1, 'a'), n(3, 'Honed Instincts', 'notable'), n(7, 'x'), n(8, 'Other Notable', 'notable')]
  }

  it('lists what the guide has that you do not, and the other way round', () => {
    const c = compareTree(guide, player)
    expect(c.missing.keystones.map((x) => x.name)).toEqual(['Heartstopper'])
    expect(c.missing.notables.map((x) => x.name)).toEqual(['Clean Shot'])
    expect(c.missing.ascendancy.map((x) => x.name)).toEqual(['Point Blank'])
    expect([c.missing.normal, c.missing.jewels]).toEqual([1, 1])
    expect(c.extra.notables.map((x) => x.name)).toEqual(['Other Notable'])
    expect(c.extra.normal).toBe(1)
    expect(c.coverage).toBeCloseTo(2 / 6) // ascendancy nodes not counted
    expect(c.sameAscendancy).toBe(true)
  })
})

describe('compareSkills', () => {
  const gem = (name: string, level = 20, quality = 0, support = false) => ({ name, level, quality, support, enabled: true })
  const guide: SkillGroup[] = [
    { enabled: true, gems: [gem('Lightning Arrow', 20, 20), gem('Lightning Penetration', 1, 0, true), gem('Multishot I', 1, 0, true)] },
    { enabled: true, gems: [gem('Ice Nova')] }
  ]
  const player: SkillGroup[] = [
    { enabled: true, gems: [gem('Lightning Arrow', 15), gem('Lightning Penetration', 1, 0, true), gem('Pierce I', 1, 0, true)] },
    { enabled: true, gems: [gem('Leap Slam', 10)] }
  ]

  it('compares each guide skill: level, quality, supports', () => {
    const c = compareSkills(guide, player)
    expect(c.skills).toEqual([
      {
        skill: 'Lightning Arrow',
        status: 'partial',
        guideLevel: 20,
        playerLevel: 15,
        guideQuality: 20,
        playerQuality: 0,
        missingSupports: ['Multishot I'],
        extraSupports: ['Pierce I']
      },
      {
        skill: 'Ice Nova',
        status: 'missing',
        guideLevel: 20,
        playerLevel: null,
        guideQuality: 0,
        playerQuality: null,
        missingSupports: [],
        extraSupports: []
      }
    ])
    expect(c.extraSkills).toEqual(['Leap Slam'])
  })

  it('a skill at the guide level with every support matches; disabled groups are ignored', () => {
    const same: SkillGroup[] = [
      { enabled: true, gems: [gem('Lightning Arrow', 20, 20), gem('Lightning Penetration', 1, 0, true), gem('Multishot I', 1, 0, true)] },
      { enabled: false, gems: [gem('Ice Nova')] }
    ]
    const c = compareSkills(guide, same)
    expect(c.skills[0]!.status).toBe('match')
    expect(c.skills[1]!.status).toBe('missing')
  })
})
