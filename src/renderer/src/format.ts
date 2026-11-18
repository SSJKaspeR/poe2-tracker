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

/** Stats where a lower value is better. */
const LOWER_IS_BETTER = new Set<string>([])

export function isImprovement(key: string, delta: number): boolean {
  return LOWER_IS_BETTER.has(key) ? delta < 0 : delta > 0
}

export function formatStat(key: string, value: number): string {
  if (key === 'EffectiveMovementSpeedMod') return `${Math.round(value * 100)}%`
  if (key.endsWith('Resist')) return `${Math.round(value)}%`
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString()
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
