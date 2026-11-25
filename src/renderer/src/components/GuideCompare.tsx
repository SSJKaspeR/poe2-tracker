import { useEffect, useState } from 'react'
import type { GuideComparisonDTO, GuideNodeDTO, GuideSlotDTO } from '@shared/ipc'
import { formatStat, isImprovement, statLabel } from '../format'
import { useMoney, useT, useTracker } from '../store'
import type { Translator } from '@shared/i18n'
import { Button, Card } from './Card'

function slotStatus(t: Translator): Record<GuideSlotDTO['status'], { label: string; color: string }> {
  return {
    match: { label: t('Matches the guide'), color: 'text-emerald-400' },
    close: { label: t('Close to the guide'), color: 'text-sky-300' },
    different: { label: t('Far from the guide'), color: 'text-amber-400' },
    missing_unique: { label: t('Guide unique missing'), color: 'text-orange-300' },
    empty: { label: t('Empty slot'), color: 'text-red-400' },
    not_in_guide: { label: t('Not in the guide'), color: 'text-stone-500' }
  }
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
  const t = useT()
  const versionId = status?.build?.versionId ?? null
  const ready = Boolean(status?.pob.running)
  const [cmp, setCmp] = useState<GuideComparisonDTO | null>(null)
  const [editing, setEditing] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'gear' | 'tree' | 'gems'>('gear')

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
        {t(
          'Paste the Path of Building code of the build you follow (guide, streamer, pobb.in). Your gear is compared slot by slot, and PoB calculates what each guide item would give you.'
        )}
      </p>
      <textarea
        className="h-16 w-full resize-none rounded-md border border-stone-800 bg-stone-950 p-2 font-mono text-xs text-stone-300 outline-none focus:border-ember-500"
        placeholder={t('Guide PoB code or link (pobb.in, poe.ninja, Maxroll…)')}
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <input
          className="flex-1 rounded-md border border-stone-800 bg-stone-950 px-2 py-1 text-sm outline-none focus:border-ember-500"
          placeholder={t("Name (optional, e.g. Mathil's Cyclone guide)")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button onClick={() => void submit()} disabled={!ready || busy || code.trim().length < 20}>
          {busy ? t('Reading the guide…') : t('Compare')}
        </Button>
        {cmp && (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            {t('Cancel')}
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )

  if (!cmp || editing) return <Card title={t('Compare with a guide build')}>{form}</Card>

  const info = cmp.guideInfo
  const cls = info.ascendancy && info.ascendancy !== 'None' ? info.ascendancy : info.className
  const shown = cmp.slots.filter((s) => s.status !== 'not_in_guide')
  const done = shown.filter((s) => s.status === 'match').length

  return (
    <Card
      title={t('Compare with a guide build')}
      actions={
        <div className="flex gap-3 text-xs">
          <button type="button" className="text-stone-500 hover:text-stone-200" onClick={() => setEditing(true)}>
            {t('Change guide')}
          </button>
          <button
            type="button"
            className="text-stone-500 hover:text-red-400"
            onClick={() => void window.tracker.clearGuideBuild().then(() => setCmp(null))}
          >
            {t('Remove')}
          </button>
        </div>
      }
    >
      <div className="mb-3">
        <div className="text-stone-100">{cmp.guideName}</div>
        <div className="text-xs text-stone-500">
          {[cls, info.level ? t('level {level}', { level: info.level }) : null, info.mainSkill].filter(Boolean).join(' · ')} ·{' '}
          {shown.length ? t('{done} / {total} slots match', { done, total: shown.length }) : t('no gear in the guide')}
        </div>
      </div>

      <table className="mb-4 w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th className="pb-1 font-normal">{t('Stat')}</th>
            <th className="pb-1 text-right font-normal">{t('You')}</th>
            <th className="pb-1 text-right font-normal">{t('Guide')}</th>
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
                <td className="py-1 text-stone-400">{statLabel(s.key, t)}</td>
                <td className={`py-1 text-right tabular-nums ${ok ? 'text-stone-200' : 'text-amber-400'}`}>{formatStat(s.key, s.player)}</td>
                <td className="py-1 text-right tabular-nums text-stone-500">{formatStat(s.key, s.guide)}</td>
                <td className="py-1 pl-3">
                  {!isRes && s.guide > 0 && (
                    <div className="h-1.5 w-full rounded bg-stone-800" title={t('{pct}% of the guide', { pct: Math.round(ratio * 100) })}>
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

      <div className="mb-3 flex gap-1" role="tablist" aria-label={t('Guide comparison')}>
        {(
          [
            ['gear', t('Gear')],
            ['tree', t('Passive tree')],
            ['gems', t('Skill gems')]
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={`rounded-md px-3 py-1 text-sm ${view === id ? 'bg-stone-800 text-stone-100' : 'text-stone-400 hover:text-stone-200'}`}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'gear' && (
        <>
          <div className="mb-2 text-xs uppercase tracking-wide text-stone-500">{t('Slot by slot — biggest gains first')}</div>
          {shown.length === 0 && <p className="text-sm text-stone-500">{t('This guide has no gear in its PoB.')}</p>}
          <ul className="space-y-3">
            {shown.map((s) => (
              <SlotRow key={s.slot} slot={s} />
            ))}
          </ul>
          <p className="mt-3 text-xs text-stone-500">
            {t("Gains are calculated by PoB on your build, as if you equipped the guide's item in that slot.")}
          </p>
        </>
      )}
      {view === 'tree' && <TreeView cmp={cmp} />}
      {view === 'gems' && <GemsView cmp={cmp} />}
    </Card>
  )
}

function SlotRow({ slot: s }: { slot: GuideSlotDTO }) {
  const money = useMoney()
  const t = useT()
  const st = slotStatus(t)[s.status]
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
        {s.player ? s.player.name : t('nothing equipped')} → <span className="text-stone-300">{s.guide?.name}</span>
        {s.uniquePrice !== null && <span className="text-stone-400"> · {t('≈ {price} on poe.ninja', { price: money(s.uniquePrice) })}</span>}
      </div>
      {changes.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
          {changes.map((c) => (
            <span key={c.key} className={isImprovement(c.key, c.delta) ? 'text-emerald-400' : 'text-red-400'}>
              {statLabel(c.key, t)} {formatChange(c.key, c.before, c.delta)}
            </span>
          ))}
        </div>
      )}
      {(s.missing.length > 0 || s.lower.length > 0) && (
        <ul className="mt-0.5 space-y-0.5 text-xs text-stone-400">
          {s.missing.map((m) => (
            <li key={m.text}>
              <span className="text-amber-400">{t('missing')}</span> {m.text}
            </li>
          ))}
          {s.lower.map((m) => (
            <li key={m.text}>
              <span className="text-sky-300">{t('lower')}</span> {m.text} <span className="text-stone-500">({t('you: {value}', { value: m.have ?? '—' })})</span>
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

function TreeView({ cmp }: { cmp: GuideComparisonDTO }) {
  const t = useT()
  const tree = cmp.tree
  if (!tree)
    return <p className="text-sm text-stone-500">{t('This guide was saved before tree comparison existed — use “Change guide” to import it again.')}</p>
  const m = tree.missing
  const nothingMissing = m.keystones.length + m.notables.length + m.ascendancy.length + m.normal + m.jewels === 0
  return (
    <div className="space-y-3 text-sm">
      <div className="text-stone-400">
        {t("Points: {you} / {guide} in the guide · {pct}% of the guide's nodes allocated", {
          you: tree.playerPoints,
          guide: tree.guidePoints,
          pct: Math.round(tree.coverage * 100)
        })}
      </div>
      {!tree.sameAscendancy && (
        <p className="text-amber-400">
          {t('Different ascendancy: you {you}, guide {guide}.', {
            you: tree.playerAscendancy || t('none'),
            guide: tree.guideAscendancy || t('none')
          })}
        </p>
      )}
      {nothingMissing ? (
        <p className="text-emerald-400">✓ {t('You have every node of the guide.')}</p>
      ) : (
        <>
          <NodeList title={t('Keystones to take')} nodes={m.keystones} />
          <NodeList title={t('Notables to take — biggest gains first')} nodes={m.notables} />
          {m.ascendancy.length > 0 && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-stone-500">{t('Ascendancy')}</div>
              <p className="text-stone-300">{m.ascendancy.map((n) => n.name).join(', ')}</p>
            </div>
          )}
          {(m.normal > 0 || m.jewels > 0) && (
            <p className="text-stone-400">
              {m.jewels > 0
                ? t('Plus {n} small passives and {j} jewel sockets on the way.', { n: m.normal, j: m.jewels })
                : t('Plus {n} small passives on the way.', { n: m.normal })}
            </p>
          )}
        </>
      )}
      {(tree.extra.keystones.length > 0 || tree.extra.notables.length > 0) && (
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-stone-500">{t("You have, the guide doesn't")}</div>
          <p className="text-stone-400">{[...tree.extra.keystones, ...tree.extra.notables].map((n) => n.name).join(', ')}</p>
          <p className="text-xs text-stone-500">{t('Candidates to refund if you want to follow the guide.')}</p>
        </div>
      )}
      <p className="text-xs text-stone-500">{t('Gains are calculated by PoB on your build, as if the node was allocated (path not included).')}</p>
    </div>
  )
}

function NodeList({ title, nodes }: { title: string; nodes: GuideNodeDTO[] }) {
  const t = useT()
  if (nodes.length === 0) return null
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wide text-stone-500">{title}</div>
      <ul className="space-y-1">
        {nodes.map((n) => {
          const changes = n.impact
            ? IMPACT_SHOWN.filter((k) => n.impact![k] && Math.abs(n.impact![k]!.delta) > 1e-6).map((k) => ({ key: k, ...n.impact![k]! }))
            : []
          return (
            <li key={n.id}>
              <span className={n.kind === 'keystone' ? 'text-orange-300' : 'text-stone-200'}>{n.name}</span>
              {changes.length > 0 ? (
                <span className="ml-2 text-xs">
                  {changes.map((c) => (
                    <span key={c.key} className={`mr-2 ${isImprovement(c.key, c.delta) ? 'text-emerald-400' : 'text-red-400'}`}>
                      {statLabel(c.key, t)} {formatChange(c.key, c.before, c.delta)}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="ml-2 text-xs text-stone-500">{t('no change to key stats')}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function GemsView({ cmp }: { cmp: GuideComparisonDTO }) {
  const t = useT()
  const g = cmp.skills
  if (!g) return <p className="text-sm text-stone-500">{t('This guide was saved before gem comparison existed — use “Change guide” to import it again.')}</p>
  const STATUS_GEM = {
    match: { label: t('Matches'), color: 'text-emerald-400' },
    partial: { label: t('To finish'), color: 'text-sky-300' },
    missing: { label: t('Not used'), color: 'text-amber-400' }
  } as const
  return (
    <div className="space-y-3 text-sm">
      <ul className="space-y-3">
        {g.skills.map((s) => (
          <li key={s.skill} className="border-l-2 border-stone-700 pl-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-stone-200">{s.skill}</span>
              <span className={`text-xs ${STATUS_GEM[s.status].color}`}>{STATUS_GEM[s.status].label}</span>
            </div>
            <div className="text-xs text-stone-400">
              {s.playerLevel === null ? (
                <>
                  {s.guideQuality
                    ? t('Guide: level {level}, quality {quality}%', { level: s.guideLevel, quality: s.guideQuality })
                    : t('Guide: level {level}', { level: s.guideLevel })}
                </>
              ) : (
                <>
                  {t('Level')} <span className={s.playerLevel < s.guideLevel ? 'text-amber-400' : 'text-stone-200'}>{s.playerLevel}</span> / {s.guideLevel}
                  {' · '}
                  {t('quality')}{' '}
                  <span className={(s.playerQuality ?? 0) < s.guideQuality ? 'text-amber-400' : 'text-stone-200'}>{s.playerQuality}%</span> /{' '}
                  {s.guideQuality}%
                </>
              )}
            </div>
            {s.missingSupports.length > 0 && (
              <div className="text-xs">
                <span className="text-amber-400">{t('missing supports')}</span>{' '}
                <span className="text-stone-300">{s.missingSupports.join(', ')}</span>
              </div>
            )}
            {s.extraSupports.length > 0 && (
              <div className="text-xs text-stone-500">{t('not in the guide: {gems}', { gems: s.extraSupports.join(', ') })}</div>
            )}
          </li>
        ))}
      </ul>
      {g.extraSkills.length > 0 && (
        <p className="text-xs text-stone-500">{t("Skills you use that the guide doesn't: {skills}", { skills: g.extraSkills.join(', ') })}</p>
      )}
    </div>
  )
}
