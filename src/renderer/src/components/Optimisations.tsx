import { useEffect, useState } from 'react'
import type { ImpactLine, OptimisationsDTO } from '@shared/ipc'
import { Button, Card } from './Card'
import { useMoney, useT, useTracker } from '../store'
import type { Translator } from '@shared/i18n'

function Effects({ lines, max = 3 }: { lines: ImpactLine[]; max?: number }) {
  return (
    <>
      {lines.slice(0, max).map((l, i) => (
        <span key={l.text} className={l.good ? 'text-emerald-400' : 'text-red-400'}>
          {i > 0 ? ', ' : ''}
          {l.text}
        </span>
      ))}
    </>
  )
}

function kindLabel(t: Translator, kind: string): string {
  return ({ keystone: t('Keystone'), notable: t('Notable'), jewel: t('Jewel socket'), small: t('Small passive') } as Record<string, string>)[kind] ?? kind
}

/**
 * Passive tree and support gem suggestions, calculated by Path of Building on the player's
 * build. On demand (a few seconds), then cached for this build version.
 */
export function Optimisations() {
  const versionId = useTracker((s) => s.status?.build?.versionId ?? null)
  const language = useTracker((s) => s.status?.language)
  const money = useMoney()
  const t = useT()
  const [data, setData] = useState<OptimisationsDTO | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    setError(null)
  }, [versionId, language])

  async function run() {
    setBusy(true)
    setError(null)
    const r = await window.tracker.getOptimisations()
    setBusy(false)
    if (r.ok) setData(r.value)
    else setError(r.error)
  }

  if (!data) {
    return (
      <Card title={t('Optimisations: passive tree & supports')}>
        <div className="space-y-3 text-sm text-stone-400">
          <p>
            {t(
              'Path of Building tests every passive point within reach and every support gem that fits your main skill, on your build. You get the best next points, the points that bring the least, and better supports.'
            )}
          </p>
          <div className="flex items-center gap-3">
            <Button onClick={() => void run()} disabled={busy}>
              {busy ? t('Calculating…') : t('Find optimisations')}
            </Button>
            {error && <span className="text-sm text-red-400">{error}</span>}
          </div>
        </div>
      </Card>
    )
  }

  const { tree, supports } = data
  return (
    <Card title={t('Optimisations: passive tree & supports')}>
      <div className="space-y-5 text-sm">
        {tree.points.unspent !== null && (
          <p role="status" className="rounded-md border border-amber-700 bg-amber-950/30 px-3 py-2 text-amber-100">
            {t('You have {n} passive points not spent ({used} / {available}). Start with the best next points below.', {
              n: tree.points.unspent,
              used: tree.points.used,
              available: tree.points.available
            })}
          </p>
        )}
        <section aria-label={t('Best next passive points')}>
          <h4 className="mb-1 font-medium text-stone-200">{t('Best next points (gain per point spent)')}</h4>
          {tree.adds.length === 0 ? (
            <p className="text-stone-500">{t('Nothing within 5 points improves your numbers.')}</p>
          ) : (
            <ol className="space-y-1.5">
              {tree.adds.map((a) => (
                <li key={a.id}>
                  <span className="text-stone-100">{a.name}</span>{' '}
                  <span className="text-xs text-stone-500">
                    {kindLabel(t, a.kind)} · {a.cost > 1 ? t('{n} points', { n: a.cost }) : t('{n} point', { n: a.cost })}
                    {a.via.length ? ` (${t('via {nodes}', { nodes: [...new Set(a.via)].slice(-2).join(', ') })})` : ''}
                  </span>
                  <div className="text-xs">
                    <Effects lines={a.impact} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {tree.swaps.length > 0 && (
          <section aria-label={t('Respec ideas')}>
            <h4 className="mb-1 font-medium text-stone-200">{t('Respec ideas (calculated together)')}</h4>
            <ul className="space-y-1.5">
              {tree.swaps.map((s) => (
                <li key={`${s.remove}-${s.add}`}>
                  {t('Remove')} <span className="text-stone-100">{s.remove}</span> ({s.removePoints} pt) → {t('take')}{' '}
                  <span className="text-stone-100">{s.add}</span> ({s.addPoints} pt)
                  <div className="text-xs">
                    <Effects lines={s.impact} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tree.removes.length > 0 && (
          <section aria-label={t('Least useful passive points')}>
            <h4 className="mb-1 font-medium text-stone-200">{t('Points that bring the least')}</h4>
            <ul className="space-y-1">
              {tree.removes.slice(0, 3).map((r) => (
                <li key={r.id} className="text-stone-300">
                  {r.name}{' '}
                  <span className="text-xs text-stone-500">
                    {r.cost > 1 ? t('frees {n} points', { n: r.cost }) : t('frees {n} point', { n: r.cost })} ·{' '}
                    {r.impact.length ? <Effects lines={r.impact} max={2} /> : t('no loss in your numbers')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {supports && (
          <section aria-label={t('Support gems')}>
            <h4 className="mb-1 font-medium text-stone-200">
              {supports.skill ? t('Supports of {skill}', { skill: supports.skill }) : t('Supports of your main skill')}
            </h4>
            {supports.error ? (
              <p className="text-stone-500">{supports.error}</p>
            ) : (
              <>
                <ul className="space-y-1">
                  {supports.current.map((c) => (
                    <li key={c.name}>
                      <span className="text-stone-100">{c.name}</span>{' '}
                      <span className="text-xs">
                        {c.impact.length && c.score > 0 ? <Effects lines={c.impact} max={2} /> : null}
                      </span>
                      {c.note && <div className="text-xs text-amber-300">{c.note}</div>}
                    </li>
                  ))}
                </ul>
                {supports.swaps.length > 0 && (
                  <>
                    <p className="mt-3 text-xs uppercase tracking-wide text-stone-500">{t('Better replacements')}</p>
                    <ul className="space-y-1">
                      {supports.swaps.map((s) => (
                        <li key={s.add}>
                          {t('Replace')} <span className="text-stone-100">{s.remove}</span> {t('with')}{' '}
                          <span className="text-stone-100">{s.add}</span>:{' '}
                          <span className="text-xs">
                            <Effects lines={s.impact} max={2} />
                          </span>
                          {s.costs.length > 0 && <div className="text-xs text-amber-300">⚠ {s.costs.map((c) => c.text).join(' · ')}</div>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {supports.candidates.length > 0 && (
                  <>
                    <p className="mt-3 text-xs uppercase tracking-wide text-stone-500">{t("Strongest supports you don't use")}</p>
                    <ul className="space-y-1">
                      {supports.candidates.map((c) => (
                        <li key={c.id} className="flex items-baseline justify-between gap-3">
                          <span>
                            <span className="text-stone-100">{c.name}</span>
                            {c.lineage && <span className="ml-2 rounded bg-violet-900/60 px-1.5 text-[11px] text-violet-300">{t('Lineage')}</span>}{' '}
                            <span className="text-xs">
                              <Effects lines={c.impact} max={2} />
                            </span>
                            {c.replaces && (
                              <span className="block text-xs text-stone-500">{t('Same family as {support}: it would replace it.', { support: c.replaces })}</span>
                            )}
                            {c.costs.length > 0 && <span className="block text-xs text-amber-300">⚠ {c.costs.map((x) => x.text).join(' · ')}</span>}
                          </span>
                          {c.price !== null && <span className="shrink-0 text-xs tabular-nums text-stone-400">≈ {money(c.price)}</span>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="mt-2 text-xs text-stone-600">
                  {t(
                    'Path of Building measures single-target damage and effective HP. Each support gem can only be used once in PoE 2, so supports used by your other skills are left out. Support gems have no attribute requirement; their mana and Spirit costs are checked above.'
                  )}
                </p>
              </>
            )}
          </section>
        )}
      </div>
    </Card>
  )
}
