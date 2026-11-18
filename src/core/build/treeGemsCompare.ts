/**
 * Passive tree and skill gem comparison with a guide build.
 */

export type NodeKind = 'keystone' | 'notable' | 'normal' | 'ascendancy' | 'jewel'

export interface TreeNode {
  id: number
  name: string
  kind: NodeKind
}

export interface TreeDetail {
  className?: string
  ascendancy?: string
  pointsUsed: number
  nodes: TreeNode[]
}

export interface TreeDiffSide {
  keystones: TreeNode[]
  notables: TreeNode[]
  ascendancy: TreeNode[]
  jewels: number
  normal: number
}

export interface TreeComparison {
  playerPoints: number
  guidePoints: number
  sameAscendancy: boolean
  playerAscendancy?: string
  guideAscendancy?: string
  /** In the guide, not in your tree. */
  missing: TreeDiffSide
  /** In your tree, not in the guide. */
  extra: TreeDiffSide
  /** Share of the guide's nodes you already have (0..1). */
  coverage: number
}

function side(nodes: TreeNode[]): TreeDiffSide {
  const by = (k: NodeKind) => nodes.filter((n) => n.kind === k).sort((a, b) => a.name.localeCompare(b.name))
  return {
    keystones: by('keystone'),
    notables: by('notable'),
    ascendancy: by('ascendancy'),
    jewels: by('jewel').length,
    normal: by('normal').length
  }
}

export function compareTree(guide: TreeDetail, player: TreeDetail): TreeComparison {
  const mine = new Set(player.nodes.map((n) => n.id))
  const theirs = new Set(guide.nodes.map((n) => n.id))
  const missing = guide.nodes.filter((n) => !mine.has(n.id))
  const extra = player.nodes.filter((n) => !theirs.has(n.id))
  const counted = guide.nodes.filter((n) => n.kind !== 'ascendancy')
  const have = counted.filter((n) => mine.has(n.id)).length
  return {
    playerPoints: player.pointsUsed,
    guidePoints: guide.pointsUsed,
    sameAscendancy: (player.ascendancy ?? '') === (guide.ascendancy ?? ''),
    playerAscendancy: player.ascendancy,
    guideAscendancy: guide.ascendancy,
    missing: side(missing),
    extra: side(extra),
    coverage: counted.length ? have / counted.length : 1
  }
}

// ── Gems ────────────────────────────────────────────────────────────────────

export interface GemDetail {
  name: string
  level: number
  quality: number
  support: boolean
  enabled: boolean
}

export interface SkillGroup {
  label?: string
  slot?: string
  enabled: boolean
  gems: GemDetail[]
}

export interface SkillComparison {
  skill: string
  status: 'match' | 'partial' | 'missing'
  guideLevel: number
  playerLevel: number | null
  guideQuality: number
  playerQuality: number | null
  missingSupports: string[]
  extraSupports: string[]
}

export interface SkillsComparison {
  skills: SkillComparison[]
  /** Active skills you use that the guide doesn't. */
  extraSkills: string[]
}

/** Supports in PoE 2 have tiers in their name ("Multishot I/II"): the tier is part of the identity. */
function norm(name: string): string {
  return name.trim().toLowerCase()
}

function activeGems(groups: SkillGroup[]): { gem: GemDetail; group: SkillGroup }[] {
  return groups.filter((g) => g.enabled).flatMap((group) => group.gems.filter((g) => !g.support && g.enabled).map((gem) => ({ gem, group })))
}

export function compareSkills(guide: SkillGroup[], player: SkillGroup[]): SkillsComparison {
  const mine = activeGems(player)
  const skills: SkillComparison[] = []
  for (const { gem, group } of activeGems(guide)) {
    const found = mine.find((m) => norm(m.gem.name) === norm(gem.name))
    const guideSupports = group.gems.filter((g) => g.support && g.enabled).map((g) => g.name)
    if (!found) {
      skills.push({
        skill: gem.name,
        status: 'missing',
        guideLevel: gem.level,
        playerLevel: null,
        guideQuality: gem.quality,
        playerQuality: null,
        missingSupports: guideSupports,
        extraSupports: []
      })
      continue
    }
    const playerSupports = found.group.gems.filter((g) => g.support && g.enabled).map((g) => g.name)
    const missingSupports = guideSupports.filter((s) => !playerSupports.some((p) => norm(p) === norm(s)))
    const extraSupports = playerSupports.filter((p) => !guideSupports.some((s) => norm(s) === norm(p)))
    const behind = found.gem.level < gem.level || found.gem.quality < gem.quality
    skills.push({
      skill: gem.name,
      status: missingSupports.length === 0 && !behind ? 'match' : 'partial',
      guideLevel: gem.level,
      playerLevel: found.gem.level,
      guideQuality: gem.quality,
      playerQuality: found.gem.quality,
      missingSupports,
      extraSupports
    })
  }
  const guideNames = new Set(activeGems(guide).map((g) => norm(g.gem.name)))
  const extraSkills = [...new Set(mine.filter((m) => !guideNames.has(norm(m.gem.name))).map((m) => m.gem.name))]
  return { skills, extraSkills }
}
