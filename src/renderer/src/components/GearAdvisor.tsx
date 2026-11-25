import { useEffect, useState } from 'react'
import type { ItemSheetDTO, RuneAdviceDTO, UpgradePriorityDTO } from '@shared/ipc'
import { Button, Card } from './Card'
import { useMoney, useT, useTracker } from '../store'

/** "What to upgrade first": slots ranked by what a good, realistic rare would add. */
export function UpgradePriorities({ onTrade }: { onTrade: (slot: string) => void }) {
  const versionId = useTracker((s) => s.status?.build?.versionId ?? null)
  const language = useTracker((s) => s.status?.language)
  const t = useT()
  const [data, setData] = useState<UpgradePriorityDTO[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => window.tracker.onUpgradeProgress(setProgress), [])
  useEffect(() => {
    setData(null)
    setError(null)
  }, [versionId, language])

  async function analyse() {
    setBusy(true)
    setError(null)
    const r = await window.tracker.getUpgradePriorities()
    setBusy(false)
    setProgress(null)
    if (r.ok) setData(r.value)
    else setError(r.error)
  }

  return (
    <Card title={t('What to upgrade first')}>
      {!data ? (
        <div className="space-y-3 text-sm text-stone-400">
          <p>
            {t(
              'For each slot, Path of Building imagines a good, realistic rare: your current resistances and life, plus the stats that help your build most. The bigger the gain, the sooner that slot deserves your currency.'
            )}
          </p>
          <div className="flex items-center gap-3">
            <Button onClick={() => void analyse()} disabled={busy}>
              {busy ? t('Analysing…') : t('Analyse my gear')}
            </Button>
            {busy && progress && (
              <span className="text-xs text-stone-500">
                {t('{done} / {total} slots', { done: progress.done, total: progress.total })}
              </span>
            )}
            {error && <span className="text-sm text-red-400">{error}</span>}
          </div>
        </div>
      ) : data.length === 0 ? (
        <p className="text-sm text-stone-500">{t('No slot could be analysed (no rare-capable item equipped).')}</p>
      ) : (
        <ol className="space-y-3" aria-label={t('Upgrade priorities')}>
          {data.map((p, i) => (
            <li key={p.slot} className="rounded-md border border-stone-800 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <span className="mr-2 text-ember-400 tabular-nums">#{i + 1}</span>
                  <span className="font-medium text-stone-100">{p.slot}</span>
                  <span className="ml-2 truncate text-sm text-stone-500">{p.item}</span>
                </div>
                <Button variant="ghost" onClick={() => onTrade(p.slot)}>
                  {t('Find on trade →')}
                </Button>
              </div>
              <p className="mt-1 text-sm text-stone-300">
                {t('A good rare here would give')}{' '}
                {p.impact.length ? (
                  p.impact.slice(0, 3).map((l, k) => (
                    <span key={l.text} className={l.good ? 'text-emerald-400' : 'text-red-400'}>
                      {k > 0 ? ', ' : ''}
                      {l.text}
                    </span>
                  ))
                ) : (
                  <span className="text-stone-500">{t('little: this slot is already good')}</span>
                )}
                .
              </p>
              {p.lookFor.length > 0 && <p className="mt-1 text-xs text-stone-500">{t('Look for: {stats}', { stats: p.lookFor.join(' · ') })}</p>}
              {p.kept.length > 0 && <p className="mt-0.5 text-xs text-stone-600">{t('While keeping: {stats}', { stats: p.kept.join(' · ') })}</p>}
              {p.freeAffixes > 0 && (
                <p className="mt-1 text-xs text-amber-300">
                  {p.freeAffixes > 1
                    ? t('Your current item has {n} free affixes: an Exalted Orb adds a random one. Most useful here: {stats}.', {
                        n: p.freeAffixes,
                        stats: p.lookFor.slice(0, 3).join(', ')
                      })
                    : t('Your current item has {n} free affix: an Exalted Orb adds a random one. Most useful here: {stats}.', {
                        n: p.freeAffixes,
                        stats: p.lookFor.slice(0, 3).join(', ')
                      })}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

/** Best runes / soul cores for empty sockets, with what they bring and their price. */
export function RuneAdvice() {
  const versionId = useTracker((s) => s.status?.build?.versionId ?? null)
  const priceCount = useTracker((s) => s.status?.prices.count ?? 0)
  const language = useTracker((s) => s.status?.language)
  const money = useMoney()
  const t = useT()
  const [data, setData] = useState<RuneAdviceDTO[] | null>(null)

  useEffect(() => {
    if (versionId === null) return
    void window.tracker.getRuneAdvice().then((r) => setData(r.ok ? r.value : []))
  }, [versionId, priceCount > 0, language])

  if (!data || data.length === 0) return null
  return (
    <Card title={t('Runes & soul cores')}>
      <div className="space-y-4" aria-label={t('Rune advice')}>
        {data.map((s) => (
          <div key={s.slot}>
            <p className="text-sm text-stone-300">
              <span className="font-medium text-stone-100">{s.slot}</span>{' '}
              <span className="text-stone-500">
                ·{' '}
                {s.empty > 1
                  ? t('{n} empty sockets on {item}', { n: s.empty, item: s.item })
                  : t('{n} empty socket on {item}', { n: s.empty, item: s.item })}
              </span>
            </p>
            <ul className="mt-1 space-y-1">
              {s.options.slice(0, 3).map((o, i) => (
                <li key={o.name} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="text-stone-200">
                      {o.count > 1 ? `${o.count} × ` : ''}
                      {o.name}
                    </span>
                    {i === 0 && <span className="ml-2 rounded bg-emerald-900/60 px-1.5 text-[11px] text-emerald-300">{t('Best')}</span>}
                    {o.name === s.bestValue && (
                      <span className="ml-2 rounded bg-amber-900/50 px-1.5 text-[11px] text-amber-300">{t('Best value')}</span>
                    )}
                    <span className="block text-xs text-stone-500">{o.impact.map((l) => l.text).join(', ')}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-stone-400">{o.price !== null ? `≈ ${money(o.price)}` : t('no price')}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  )
}

/** Each equipped item line by line: what each line really brings to the build. */
export function ItemSheets() {
  const versionId = useTracker((s) => s.status?.build?.versionId ?? null)
  const language = useTracker((s) => s.status?.language)
  const t = useT()
  const [data, setData] = useState<ItemSheetDTO[] | null>(null)
  const [slot, setSlot] = useState<string | null>(null)

  useEffect(() => {
    if (versionId === null) return
    void window.tracker.getItemSheets().then((r) => setData(r.ok ? r.value : []))
  }, [versionId, language])

  if (!data || data.length === 0) return null
  const sheet = data.find((d) => d.slot === slot) ?? data[0]!
  return (
    <Card
      title={t('Your items, line by line')}
      actions={
        <select
          aria-label={t('Item to inspect')}
          className="rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-sm"
          value={sheet.slot}
          onChange={(e) => setSlot(e.target.value)}
        >
          {data.map((d) => (
            <option key={d.slot} value={d.slot}>
              {d.slot}
            </option>
          ))}
        </select>
      }
    >
      <p className="text-sm text-stone-300">{sheet.item}</p>
      <ul className="mt-2 divide-y divide-stone-800" aria-label={t('Item lines')}>
        {sheet.lines.map((l, i) => (
          <li key={`${l.kind}-${i}`} className={`py-1.5 text-sm ${i === sheet.weakest ? 'rounded bg-amber-950/30 px-2' : ''}`}>
            <div className="flex justify-between gap-3">
              <span className={l.kind === 'implicit' ? 'text-sky-300' : 'text-stone-200'}>{l.text}</span>
              {i === sheet.weakest && <span className="shrink-0 text-xs text-amber-300">{t('replace first')}</span>}
            </div>
            <div className="text-xs text-stone-500">
              {l.effects.length ? t('Gives you {effects}', { effects: l.effects.slice(0, 2).join(', ') }) : t('Does nothing for your build')}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-stone-600">
        {t('Each line is measured by removing it from the item in Path of Building. Resistances are never marked "replace first".')}
      </p>
    </Card>
  )
}

