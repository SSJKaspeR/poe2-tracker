export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Human labels for PoB stat keys. Keys not listed are shown as-is. */
export const STAT_LABELS: Record<string, string> = {
  CombinedDPS: 'Total DPS',
  TotalDPS: 'Hit DPS',
  TotalDotDPS: 'DoT DPS',
  Life: 'Life',
  EnergyShield: 'Energy Shield',
  Mana: 'Mana',
  Spirit: 'Spirit',
  Armour: 'Armour',
  Evasion: 'Evasion',
  TotalEHP: 'Effective HP',
  FireResist: 'Fire res',
  ColdResist: 'Cold res',
  LightningResist: 'Lightning res',
  ChaosResist: 'Chaos res',
  EffectiveMovementSpeedMod: 'Movement speed',
  PhysicalMaximumHitTaken: 'Max phys hit',
  FireMaximumHitTaken: 'Max fire hit',
  ColdMaximumHitTaken: 'Max cold hit',
  LightningMaximumHitTaken: 'Max lightning hit',
  ChaosMaximumHitTaken: 'Max chaos hit'
}

/** Extra labels used only on the Build tab (full stat sheet). */
export const EXTRA_STAT_LABELS: Record<string, string> = {
  AverageHit: 'Average hit',
  Speed: 'Attacks / casts per second',
  CritChance: 'Crit chance',
  CritMultiplier: 'Crit multiplier',
  HitChance: 'Hit chance',
  AreaOfEffectRadiusMetres: 'AoE radius (m)',
  LifeUnreserved: 'Life (unreserved)',
  ManaUnreserved: 'Mana (unreserved)',
  SpiritUnreserved: 'Spirit (unreserved)',
  Ward: 'Ward',
  FireResistOverCap: 'Fire overcap',
  ColdResistOverCap: 'Cold overcap',
  LightningResistOverCap: 'Lightning overcap',
  ChaosResistOverCap: 'Chaos overcap',
  EffectiveBlockChance: 'Block chance',
  EffectiveSpellBlockChance: 'Spell block chance',
  LifeRegenRecovery: 'Life regen / s',
  LifeLeechGainRate: 'Life leech / s',
  EnergyShieldRegenRecovery: 'ES regen / s',
  ManaRegenRecovery: 'Mana regen / s',
  Str: 'Strength',
  Dex: 'Dexterity',
  Int: 'Intelligence'
}

export function statLabel(key: string): string {
  return STAT_LABELS[key] ?? EXTRA_STAT_LABELS[key] ?? key
}

/** Stats where a lower value is better. */
const LOWER_IS_BETTER = new Set<string>([])

export function isImprovement(key: string, delta: number): boolean {
  return LOWER_IS_BETTER.has(key) ? delta < 0 : delta > 0
}

export function formatStat(key: string, value: number): string {
  if (key === 'EffectiveMovementSpeedMod') return `${Math.round(value * 100)}%`
  if (key.endsWith('Chance')) return `${value.toFixed(value < 10 ? 1 : 0)}%`
  if (key.endsWith('Resist') || key.endsWith('OverCap')) return `${Math.round(value)}%`
  if (key === 'CritMultiplier') return `${Math.round(value * 100)}%`
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString()
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/**
 * Currency value (stored in Divine) shown the way players think:
 * ≥ 1 div in Divine, below that in Exalted when the rate is known.
 */
export function formatCurrency(divine: number, exaltedPerDivine: number | null, opts: { sign?: boolean } = {}): string {
  const sign = opts.sign && divine > 0 ? '+' : ''
  if (Math.abs(divine) >= 1 || !exaltedPerDivine) {
    return `${sign}${divine.toFixed(Math.abs(divine) >= 10 ? 0 : 2)} div`
  }
  const ex = divine * exaltedPerDivine
  return `${sign}${ex.toFixed(Math.abs(ex) >= 10 ? 0 : 1)} ex`
}
