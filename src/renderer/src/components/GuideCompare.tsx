import { useEffect, useState } from 'react'
import type { GuideComparisonDTO, GuideSlotDTO } from '@shared/ipc'
import { STAT_LABELS, formatStat, isImprovement, statLabel } from '../format'
import { useMoney, useTracker } from '../store'
import { Button, Card } from './Card'

const STATUS: Record<GuideSlotDTO['status'], { label: string; color: string }> = {
  match: { label: 'Matches the guide', color: 'text-emerald-400' },
  close: { label: 'Close', color: 'text-sky-300' },
  different: { label: 'Far from the guide', color: 'text-amber-400' },
  missing_unique: { label: 'Guide unique missing', color: 'text-orange-300' },
  empty: { label: 'Empty slot', color: 'text-red-400' },
  not_in_guide: { label: 'Not in the guide', color: 'text-stone-500' }
}

/** Stats shown in "what the guide item would change", in order. */
const IMPACT_SHOWN = ['CombinedDPS', 'Life', 'EnergyShield', 'TotalEHP', 'Spirit', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist', 'EffectiveMovementSpeedMod']

/**
 * Compare the player's gear with a guide build (PoB code from a build guide):
 * overall stats, then slot by slot, sorted by what the guide's item would bring
 * on the player's own build (calculated by PoB).
 */
export function GuideCompare() {
  const status = useTracker((s) => s.status)
  const versionId = status?.build?.versionId ?? null
  const ready = Boolean(status?.pob.running)
  const [cmp, setCmp] = useState<GuideComparisonDTO | null>(null)
  const [editing, setEditing] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready || versionId === null) return
    void window.tracker.getGuideComparison().then((r) => {
      if (r.ok) setCmp(r.value)
    })
  }, [ready, versionId])

  async function submit() {
    setBusy(true)
    setError(null)
    const r = await window.tracker.setGuideBuild(code, name)
    setBusy(false)
    if (r.ok) {
      setCmp(r.value)
      setEditing(false)
      setCode('')
      setName('')
    } else setError(r.error)
  }

  if (!status?.build) return null

  const form = (
    <div className="space-y-2">
      <p className="text-sm text-stone-500">
        Paste the Path of Building code of the build you follow (guide, streamer, pobb.in). Your gear is compared slot by
        slot, and PoB calculates what each guide item would give you.
      </p>
      <textarea
        className="h-16 w-full resize-none rounded-md border border-stone-800 bg-stone-950 p-2 font-mono text-xs text-stone-300 outline-none focus:border-ember-500"
        placeholder="Guide PoB code (eNrt…)"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <input
          className="flex-1 rounded-md border border-stone-800 bg-stone-950 px-2 py-1 text-sm outline-none focus:border-ember-500"
          placeholder="Name (optional, e.g. Mathil's Cyclone guide)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button onClick={() => void submit()} disabled={!ready || busy || code.trim().length < 20}>
          {busy ? 'Reading the guide…' : 'Compare'}
        </Button>
        {cmp && (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )

  if (!cmp || editing) return <Card title="Compare with a guide build">{form}</Card>

  const info = cmp.guideInfo
  const cls = info.ascendancy && info.ascendancy !== 'None' ? info.ascendancy : info.className
  const shown = cmp.slots.filter((s) => s.status !== 'not_in_guide')
  const done = shown.filter((s) => s.status === 'match').length

  return (
    <Card
      title="Compare with a guide build"
      actions={
        <div className="flex gap-3 text-xs">
          <button type="button" className="text-stone-500 hover:text-stone-200" onClick={() => setEditing(true)}>
            Change guide
          </button>
          <button
            type="button"
            className="text-stone-500 hover:text-red-400"
            onClick={() => void window.tracker.clearGuideBuild().then(() => setCmp(null))}
          >
            Remove
          </button>
        </div>
      }
    >
      <div className="mb-3">
        <div className="text-stone-100">{cmp.guideName}</div>
        <div className="text-xs text-stone-500">
          {[cls, info.level ? `level ${info.level}` : null, info.mainSkill].filter(Boolean).join(' · ')} ·{' '}
          {done} / {shown.length} slots match
        </div>
      </div>

      <table className="mb-4 w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th className="pb-1 font-normal">Stat</th>
            <th className="pb-1 text-right font-normal">You</th>
            <th className="pb-1 text-right font-normal">Guide</th>
            <th className="w-32 pb-1 pl-3 font-normal" />
          </tr>
        </thead>
        <tbody>
          {cmp.stats.map((s) => {
            const ratio = s.guide > 0 ? s.player / s.guide : s.player >= s.guide ? 1 : 0
            const isRes = s.key.endsWith('Resist')
            const ok = isRes ? s.player >= s.guide : ratio >= 0.9
            return (
              <tr key={s.key} className="border-t border-stone-800/60">
                <td className="py-1 text-stone-400">{statLabel(s.key)}</td>
                <td className={`py-1 text-right tabular-nums ${ok ? 'text-stone-200' : 'text-amber-400'}`}>{formatStat(s.key, s.player)}</td>
                <td className="py-1 text-right tabular-nums text-stone-500">{formatStat(s.key, s.guide)}</td>
                <td className="py-1 pl-3">
                  {!isRes && s.guide > 0 && (
                    <div className="h-1.5 w-full rounded bg-stone-800" title={`${Math.round(ratio * 100)}% of the guide`}>
                      <div
                        className={`h-1.5 rounded ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`}
                        style={{ width: `${Math.min(100, ratio * 100)}%` }}
                      />
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="mb-2 text-xs uppercase tracking-wide text-stone-500">Slot by slot — biggest gains first</div>
      <ul className="space-y-3">
        {shown.map((s) => (
          <SlotRow key={s.slot} slot={s} />
        ))}
      </ul>
      <p className="mt-3 text-xs text-stone-500">
        Gains are calculated by PoB on your build, as if you equipped the guide's item in that slot.
      </p>
    </Card>
  )
}

function SlotRow({ slot: s }: { slot: GuideSlotDTO }) {
  const money = useMoney()
  const st = STATUS[s.status]
  const changes = s.impact
    ? IMPACT_SHOWN.filter((k) => s.impact![k] && Math.abs(s.impact![k]!.delta) > 1e-6).map((k) => ({ key: k, ...s.impact![k]! }))
    : []

  return (
    <li className="border-l-2 border-stone-700 pl-3 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-stone-200">{s.slot}</span>
        <span className={`text-xs ${st.color}`}>{st.label}</span>
      </div>
      <div className="text-xs text-stone-500">
        {s.player ? s.player.name : 'nothing equipped'} → <span className="text-stone-300">{s.guide?.name}</span>
        {s.uniquePrice !== null && <span className="text-stone-400"> · ≈ {money(s.uniquePrice)} on poe.ninja</span>}
      </div>
      {changes.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
          {changes.map((c) => (
            <span key={c.key} className={isImprovement(c.key, c.delta) ? 'text-emerald-400' : 'text-red-400'}>
              {STAT_LABELS[c.key] ?? c.key} {formatChange(c.key, c.before, c.delta)}
            </span>
          ))}
        </div>
      )}
      {(s.missing.length > 0 || s.lower.length > 0) && (
        <ul className="mt-0.5 space-y-0.5 text-xs text-stone-400">
          {s.missing.map((m) => (
            <li key={m.text}>
              <span className="text-amber-400">missing</span> {m.text}
            </li>
          ))}
          {s.lower.map((m) => (
            <li key={m.text}>
              <span className="text-sky-300">lower</span> {m.text} <span className="text-stone-500">(you: {m.have})</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function formatChange(key: string, before: number, delta: number): string {
  const sign = delta > 0 ? '+' : ''
  if (key.endsWith('Resist')) return `${sign}${Math.round(delta)}%`
  if (key === 'EffectiveMovementSpeedMod') return `${sign}${Math.round(delta * 100)}%`
  if (before > 0 && (key === 'CombinedDPS' || key === 'TotalEHP')) return `${sign}${Math.round((delta / before) * 100)}%`
  return `${sign}${Math.abs(delta) >= 1000 ? Math.round(delta).toLocaleString() : Math.round(delta)}`
}
