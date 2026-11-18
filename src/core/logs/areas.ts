/**
 * Area classification from the internal area id logged in
 * `Generating level N area "<id>" with seed S`.
 *
 * ⚠️ to verify on 1.0: PoE 2 waystone areas use ids prefixed with "Map"
 * (same convention as PoE 1); towns/hideouts are listed below.
 */

export type AreaKind = 'map' | 'hideout' | 'town' | 'other'

const TOWN_IDS = new Set<string>([
  // Act towns and endgame hubs (PoE 2). Extend as new ids show up in logs.
  'G1_town',
  'G2_town',
  'G3_town',
  'G4_town',
  'G5_town',
  'G6_town',
  'C_G1_town',
  'C_G2_town',
  'C_G3_town',
  'Abyss_Hub',
  'MapHideout' // safety: never treat any hideout-like id as a map
])

const NON_MAP_PREFIXES = ['Hideout', 'MapHideout']

export function classifyArea(areaId: string): AreaKind {
  if (NON_MAP_PREFIXES.some((p) => areaId.startsWith(p))) return 'hideout'
  if (TOWN_IDS.has(areaId) || /_town$/i.test(areaId)) return 'town'
  if (areaId.startsWith('Map')) return 'map'
  return 'other'
}

export function isSafeZone(kind: AreaKind): boolean {
  return kind === 'hideout' || kind === 'town'
}
