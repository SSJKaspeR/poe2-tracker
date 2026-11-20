import { useEffect, useState } from 'react'
import type { LootFilterDTO } from '@shared/ipc'
import { Button, Card } from './Card'
import { useMoney, useTracker } from '../store'

const THRESHOLDS = [0.5, 1, 5, 20] as const

/**
 * Value the player never sees: items priced on poe.ninja that their loot filter hides
 * (evaluated with the filter's own rules, at the level of the last map played).
 */
export function LootFilterPanel() {
  const money = useMoney()
  const priceCount = useTracker((s) => s.status?.prices.count ?? 0)
  const [data, setData] = useState<LootFilterDTO | null>(null)
  const [min, setMin] = useState<number>(1)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    void window.tracker.getLootFilter(min).then(setData)
  }, [min, priceCount])

  const reload = (p: Promise<LootFilterDTO>) => void p.then(() => window.tracker.getLootFilter(min)).then(setData)
  const shown = showAll ? data?.hidden : data?.hidden.slice(0, 8)

  return (
    <Card
      title="Loot filter"
      actions={
        <div className="flex items-center gap-2">
          {data && data.candidates.length > 1 && (
            <select
              aria-label="Filter file"
              className="rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-sm"
              value={data.auto ? '' : (data.path ?? '')}
              onChange={(e) => reload(window.tracker.setLootFilter(e.target.value || null))}
            >
              <option value="">Automatic</option>
              {data.candidates.map((c) => (
                <option key={c.path} value={c.path}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="ghost" onClick={() => reload(window.tracker.browseLootFilter())}>
            Choose file…
          </Button>
        </div>
      }
    >
      {!data ? (
        <p className="text-sm text-stone-500">Reading your filter…</p>
      ) : (
        <div className="space-y-3 text-sm">
          {data.path && (
            <p className="text-stone-400">
              <span className="text-stone-200">
                {data.info?.title ?? data.path.split(/[\\/]/).pop()}
                {data.info?.type ? ` · ${data.info.type}` : ''}
                {data.info?.version ? ` · v${data.info.version}` : ''}
              </span>{' '}
              {data.auto ? '(detected automatically)' : '(chosen)'} · evaluated for area level {data.areaLevel}
            </p>
          )}
          {data.error && <p className="text-amber-400">{data.error}</p>}
          {data.path && !data.error && (
            <>
              <div className="flex items-center gap-2 text-stone-400">
                Hidden items worth at least
                {THRESHOLDS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={min === t}
                    className={`rounded px-2 py-0.5 ${min === t ? 'bg-stone-700 text-stone-100' : 'hover:text-stone-200'}`}
                    onClick={() => setMin(t)}
                  >
                    {t} ex
                  </button>
                ))}
              </div>
              {data.hidden.length === 0 ? (
                <p className="text-emerald-400">Your filter shows everything worth {min} ex or more.</p>
              ) : (
                <>
                  <p className="text-stone-300">
                    Your filter hides <strong>{data.hidden.length}</strong> item type{data.hidden.length > 1 ? 's' : ''} worth{' '}
                    {min} ex or more. Lower the strictness or show them in FilterBlade if you want to pick them up.
                  </p>
                  <ul className="divide-y divide-stone-800 rounded-md border border-stone-800" aria-label="Hidden valuable items">
                    {shown!.map((h) => (
                      <li key={h.name} className="flex items-center justify-between px-3 py-1.5">
                        <span>
                          {h.name}
                          {h.uncertain && (
                            <span className="ml-2 text-xs text-stone-500" title="Depends on details the app can't know (item level…)">
                              probably
                            </span>
                          )}
                        </span>
                        <span className="tabular-nums text-ember-400">{money(h.valueDivine)}</span>
                      </li>
                    ))}
                  </ul>
                  {data.hidden.length > 8 && (
                    <Button variant="ghost" onClick={() => setShowAll(!showAll)}>
                      {showAll ? 'Show less' : `Show all ${data.hidden.length}`}
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  )
}
