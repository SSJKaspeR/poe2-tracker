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

/**
 * One plain sentence per stat, shown on hover: what it is and why it matters.
 * Numbers follow PoE 2 rules (resistance cap 75%).
 */
export const STAT_HELP: Record<string, string> = {
  CombinedDPS: 'Damage per second of your main skill, hits and damage over time together, as calculated by Path of Building.',
  TotalDPS: 'Damage per second from hits only.',
  TotalDotDPS: 'Damage per second from damage over time (ignite, poison, bleed…).',
  Life: 'When it reaches 0 you die. More life = more room for mistakes.',
  EnergyShield: 'A shield on top of your life: it takes damage first and recharges when you stop being hit.',
  Mana: 'Pays for your skills. Running out means you stop attacking or casting.',
  Spirit: 'Reserved by persistent skills (auras, buffs, minions). Unused Spirit is a free slot for another one.',
  Armour: 'Reduces physical hit damage, much better against many small hits than one big hit.',
  Evasion: 'Chance to avoid enemy attacks entirely (not spells).',
  TotalEHP:
    'Effective HP: how much raw damage you can take before dying, counting life, energy shield, resistances and mitigation. The best single number for "how tanky am I".',
  FireResist: 'Reduces fire damage. Capped at 75%: below that, fire hits get much more dangerous.',
  ColdResist: 'Reduces cold damage. Capped at 75%: below that, cold hits get much more dangerous.',
  LightningResist: 'Reduces lightning damage. Capped at 75%: below that, lightning hits get much more dangerous.',
  ChaosResist: 'Reduces chaos damage. Harder to raise; aim for at least 0% in endgame.',
  EffectiveMovementSpeedMod: 'How fast you move. Faster = shorter maps = more profit per hour.',
  PhysicalMaximumHitTaken: 'The biggest physical hit you can survive from full life.',
  FireMaximumHitTaken: 'The biggest fire hit you can survive from full life.',
  ColdMaximumHitTaken: 'The biggest cold hit you can survive from full life.',
  LightningMaximumHitTaken: 'The biggest lightning hit you can survive from full life.',
  ChaosMaximumHitTaken: 'The biggest chaos hit you can survive from full life. The lowest of these is what one-shots you.',
  CritChance: 'Chance for a hit to be a critical strike.',
  CritMultiplier: 'Extra damage dealt by critical strikes.',
  HitChance: 'Chance your attacks hit (accuracy against enemy evasion).',
  SpiritUnreserved: 'Spirit left after your persistent skills: room for one more buff or minion.'
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

/**
 * Stat name in the interface language. The English texts above are translation keys
 * (checked by tests/unit/i18n.test.ts like every t('…') text).
 */
export function statLabel(key: string, t: (text: string) => string = (x) => x): string {
  const en = STAT_LABELS[key] ?? EXTRA_STAT_LABELS[key]
  return en ? t(en) : key
}

/** Hover help in the interface language (undefined when there is none). */
export function statHelp(key: string, t: (text: string) => string = (x) => x): string | undefined {
  const en = STAT_HELP[key]
  return en ? t(en) : undefined
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
