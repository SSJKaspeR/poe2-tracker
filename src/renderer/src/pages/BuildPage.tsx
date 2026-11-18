import { useEffect, useState } from 'react'
import type { BuildSnapshotDTO, BuildVersionDTO, GearCheckDTO, StatMap } from '@shared/ipc'
import { Card } from '../components/Card'
import { GuideCompare } from '../components/GuideCompare'
import { formatDuration, formatStat, isImprovement, statLabel } from '../format'
import { useMoney, useTracker } from '../store'

const GROUPS: { title: string; keys: string[] }[] = [
  {
    title: 'Offence',
    keys: ['CombinedDPS', 'TotalDPS', 'TotalDotDPS', 'AverageHit', 'Speed', 'CritChance', 'CritMultiplier', 'HitChance', 'AreaOfEffectRadiusMetres']
  },
  {
    title: 'Defence',
    keys: ['Life', 'LifeUnreserved', 'EnergyShield', 'Mana', 'ManaUnreserved', 'Spirit', 'SpiritUnreserved', 'Armour', 'Evasion', 'Ward', 'TotalEHP', 'EffectiveBlockChance', 'EffectiveSpellBlockChance']
  },
  {
    title: 'Resistances',
    keys: ['FireResist', 'ColdResist', 'LightningResist', 'ChaosResist', 'FireResistOverCap', 'ColdResistOverCap', 'LightningResistOverCap', 'ChaosResistOverCap']
  },
  {
    title: 'Biggest hit you can take',
    keys: ['PhysicalMaximumHitTaken', 'FireMaximumHitTaken', 'ColdMaximumHitTaken', 'LightningMaximumHitTaken', 'ChaosMaximumHitTaken']
  },
  {
    title: 'Sustain & utility',
    keys: ['LifeRegenRecovery', 'LifeLeechGainRate', 'EnergyShieldRegenRecovery', 'ManaRegenRecovery', 'EffectiveMovementSpeedMod', 'Str', 'Dex', 'Int']
  }
]

/** Stats shown in each version's "what changed" line, in order of importance. */
const CHANGE_KEYS = [
  'CombinedDPS', 'Life', 'EnergyShield', 'TotalEHP', 'Spirit', 'Armour', 'Evasion',
  'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist', 'EffectiveMovementSpeedMod'
]

const RES_CAP = 75

export function BuildPage() {
  const status = useTracker((s) => s.status)
  const build = status?.build ?? null
  const ready = Boolean(status?.pob.running)
  const [snapshot, setSnapshot] = useState<BuildSnapshotDTO | null>(null)
  const [versions, setVersions] = useState<BuildVersionDTO[]>([])
  const [gear, setGear] = useState<GearCheckDTO[] | null>(null)
  const versionId = build?.versionId ?? null
  const todayRuns = status?.today.runs

  useEffect(() => {
    if (!ready || versionId === null) return
    void window.tracker.getBuildSnapshot().then((r) => r.ok && setSnapshot(r.value))
    void window.tracker.getGearCheck().then((r) => setGear(r.ok ? r.value : null))
  }, [ready, versionId])

  useEffect(() => {
    void window.tracker.getBuildVersions().then(setVersions)
  }, [versionId, todayRuns])

  if (!build) {
    return (
      <Card title="Build">
        <p className="text-sm text-stone-500">Import your Path of Building code from the Dashboard to see your build here.</p>
      </Card>
    )
  }

  const info = snapshot?.info
  const cls = info?.ascendancy && info.ascendancy !== 'None' ? info.ascendancy : info?.className

  return (
    <div className="grid grid-cols-[1fr_420px] gap-4">
      <div className="space-y-4">
        <Card title="Character">
          <div className="text-lg font-semibold text-stone-100">{build.name}</div>
          <div className="text-sm text-stone-500">
            {[cls, info?.level ? `level ${info.level}` : null, info?.mainSkill, `version ${build.versionCount}`]
              .filter(Boolean)
              .join(' · ')}
          </div>
          {snapshot && <Warnings stats={snapshot.stats} />}
          {gear && <GearSummary gear={gear} />}
        </Card>

        <GuideCompare />

        {snapshot ? (
          <div className="grid grid-cols-2 gap-4">
            {GROUPS.map((g) => {
              const keys = g.keys.filter((k) => snapshot.stats[k] !== undefined)
              if (keys.length === 0) return null
              return (
                <Card key={g.title} title={g.title}>
                  <dl className="space-y-1 text-sm">
                    {keys.map((k) => (
                      <div key={k} className="flex justify-between">
                        <dt className="text-stone-500">{statLabel(k)}</dt>
                        <dd className={`tabular-nums ${resTone(k, snapshot.stats[k]!)}`}>{formatStat(k, snapshot.stats[k]!)}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>
              )
            })}
          </div>
        ) : (
          <Card title="Stats">
            <p className="text-sm text-stone-500">{ready ? 'Loading…' : 'Waiting for the calculation engine…'}</p>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <Card title="Equipment & gear check">
          {snapshot?.items?.length ? (
            <ul className="space-y-2 text-sm">
              {snapshot.items.map((it) => {
                const findings = gear?.find((g) => g.slot === it.slot)?.findings ?? []
                return (
                  <li key={it.slot}>
                    <div className="flex justify-between gap-3">
                      <span className="shrink-0 text-stone-500">{it.slot}</span>
                      <span className={`truncate text-right ${RARITY_COLOR[it.rarity] ?? 'text-stone-200'}`} title={it.name}>
                        {it.name}
                      </span>
                    </div>
                    {findings.length > 0 && (
                      <ul className="mt-0.5 space-y-0.5 text-xs">
                        {findings.map((f) => (
                          <li key={f.kind} className={FINDING_COLOR[f.level]}>
                            {FINDING_ICON[f.level]} {f.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-stone-500">No item in the imported build.</p>
          )}
        </Card>
        <VersionTimeline versions={versions} />
      </div>
    </div>
  )
}

/** Each version: what changed in the stats, and what happened in maps afterwards. */
function VersionTimeline({ versions }: { versions: BuildVersionDTO[] }) {
  const money = useMoney()
  return (
    <Card title="Changes & impact">
      {versions.length === 0 ? (
        <p className="text-sm text-stone-500">No version yet.</p>
      ) : (
        <ol className="space-y-3">
          {versions.map((v, i) => {
            const prev = versions[i + 1]
            const changes = prev?.stats && v.stats ? diffStats(prev.stats, v.stats) : []
            const p = v.performance
            const prevP = prev?.performance
            return (
              <li key={v.versionId} className="border-l-2 border-stone-700 pl-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-stone-100">
                    v{versions.length - i} · {v.label ?? 'Imported'}
                  </span>
                  <span className="text-xs text-stone-500">{new Date(v.createdAt).toLocaleDateString()}</span>
                </div>
                {changes.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                    {changes.map((c) => (
                      <span key={c.key} className={isImprovement(c.key, c.delta) ? 'text-emerald-400' : 'text-red-400'}>
                        {statLabel(c.key)} {formatDelta(c.key, c.delta)}
                      </span>
                    ))}
                  </div>
                )}
                {i === versions.length - 1 && changes.length === 0 && <div className="mt-1 text-xs text-stone-500">Starting point</div>}
                <div className="mt-1 text-xs text-stone-400">
                  {p.runs === 0 ? (
                    <span className="text-stone-500">No map played with this version yet.</span>
                  ) : (
                    <>
                      {p.runs} map{p.runs > 1 ? 's' : ''} · {formatDuration(p.activeMs / p.runs)} / map
                      {compare(p.activeMs / p.runs, prevP && prevP.runs ? prevP.activeMs / prevP.runs : null, true)} ·{' '}
                      {(p.deaths / p.runs).toFixed(2)} deaths / map
                      {compare(p.deaths / p.runs, prevP && prevP.runs ? prevP.deaths / prevP.runs : null, true)}
                      {p.profit.runsWithLoot > 0 && p.profit.profitPerHour !== null && (
                        <> · {money(p.profit.profitPerHour, { sign: true })} / h</>
                      )}
                      {p.runs < 5 && <span className="text-stone-500"> · too few maps to judge</span>}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}

/** Arrow showing whether a lower-is-better metric improved vs the previous version. */
function compare(current: number, previous: number | null, lowerIsBetter: boolean) {
  if (previous === null || previous === 0) return null
  const change = (current - previous) / previous
  if (Math.abs(change) < 0.05) return null
  const better = lowerIsBetter ? change < 0 : change > 0
  return (
    <span className={better ? 'text-emerald-400' : 'text-red-400'}>
      {' '}
      ({change > 0 ? '+' : ''}
      {Math.round(change * 100)}%)
    </span>
  )
}

const FINDING_COLOR = { easy: 'text-amber-400', upgrade: 'text-sky-300', info: 'text-stone-500' } as const
const FINDING_ICON = { easy: '▲', upgrade: '◆', info: '·' } as const

function GearSummary({ gear }: { gear: GearCheckDTO[] }) {
  const all = gear.flatMap((g) => g.findings)
  const easy = all.filter((f) => f.level === 'easy').length
  const upgrades = all.filter((f) => f.level === 'upgrade').length
  if (easy + upgrades === 0) return <p className="mt-2 text-sm text-emerald-400">✓ Nothing left to finish on your gear.</p>
  return (
    <p className="mt-2 text-sm text-stone-300">
      Gear check:{' '}
      {easy > 0 && (
        <span className="text-amber-400">
          {easy} easy win{easy > 1 ? 's' : ''}
        </span>
      )}
      {easy > 0 && upgrades > 0 && ' · '}
      {upgrades > 0 && (
        <span className="text-sky-300">
          {upgrades} item{upgrades > 1 ? 's' : ''} worth replacing
        </span>
      )}
      <span className="text-stone-500"> — details next to each item.</span>
    </p>
  )
}

function Warnings({ stats }: { stats: StatMap }) {
  const uncapped = ['FireResist', 'ColdResist', 'LightningResist'].filter((k) => (stats[k] ?? RES_CAP) < RES_CAP)
  const warnings: string[] = []
  if (uncapped.length) warnings.push(`${uncapped.map(statLabel).join(', ')} below ${RES_CAP}%`)
  if ((stats.SpiritUnreserved ?? 0) < 0) warnings.push('Not enough Spirit for your reservations')
  if (warnings.length === 0) return null
  return (
    <ul className="mt-2 space-y-0.5 text-sm text-amber-500">
      {warnings.map((w) => (
        <li key={w}>⚠ {w}</li>
      ))}
    </ul>
  )
}

function diffStats(before: StatMap, after: StatMap): { key: string; delta: number }[] {
  return CHANGE_KEYS.filter((k) => before[k] !== undefined && after[k] !== undefined)
    .map((k) => ({ key: k, delta: after[k]! - before[k]! }))
    .filter((c) => Math.abs(c.delta) > 1e-6)
}

function formatDelta(key: string, delta: number): string {
  const sign = delta > 0 ? '+' : ''
  if (key === 'EffectiveMovementSpeedMod') return `${sign}${Math.round(delta * 100)}%`
  if (key.endsWith('Resist')) return `${sign}${Math.round(delta)}%`
  return `${sign}${Math.abs(delta) >= 1000 ? Math.round(delta).toLocaleString() : Number.isInteger(delta) ? delta : delta.toFixed(1)}`
}

function resTone(key: string, value: number): string {
  if (['FireResist', 'ColdResist', 'LightningResist'].includes(key)) return value < RES_CAP ? 'text-amber-500' : 'text-stone-200'
  return 'text-stone-200'
}

const RARITY_COLOR: Record<string, string> = {
  UNIQUE: 'text-orange-300',
  RARE: 'text-yellow-200',
  MAGIC: 'text-sky-300',
  NORMAL: 'text-stone-200'
}
