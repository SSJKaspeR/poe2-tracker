import { useEffect, useMemo, useRef, useState } from 'react'
import type { TradePreviewDTO, TradeWeightsDTO } from '@shared/ipc'
import { defaultChoices, previewMods, tradeSearchUrl, type StatChoice, type StatMode } from '@shared/trade'
import { isImprovement, statLabel } from '../format'
import { useT, useTracker } from '../store'
import type { Translator } from '@shared/i18n'
import { Button, Card } from './Card'

function statModes(t: Translator): { id: StatMode; label: string; title: string }[] {
  return [
    { id: 'weighted', label: t('Use'), title: t('Counts in the score: better rolls rank first') },
    { id: 'required', label: t('Must have'), title: t('The item must have this stat (with a minimum)') },
    { id: 'excluded', label: t('Exclude'), title: t('Never show items with this stat') },
    { id: 'off', label: t('Ignore'), title: t('Ignored') }
  ]
}

const PREVIEW_STATS = ['CombinedDPS', 'Life', 'EnergyShield', 'TotalEHP', 'Spirit', 'Armour', 'Evasion', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist', 'EffectiveMovementSpeedMod']

const VISIBLE = 12
const RES_CAP = 75
const RES_KEYS = ['FireResist', 'ColdResist', 'LightningResist', 'ChaosResist']

/** "# to maximum Life" + 111 → "+111 to maximum Life" (display only). */
function withValue(text: string, value: number): string {
  const t = text.replace(/\s*\(Local\)/, '')
  if (t.includes('+#')) return t.replace('+#', `${value >= 0 ? '+' : ''}${value}`)
  if (/^#%? to /.test(t) && value >= 0) return t.replace('#', `+${value}`)
  return t.replace('#', String(value))
}

/**
 * Find an upgrade for a slot on the official trade site. PoB ranks which stats
 * help this build the most; the player adjusts; the app opens a pre-filled search.
 */
export function TradeUpgrade({ slot, slots, onSlot }: { slot: string | null; slots: string[]; onSlot: (s: string) => void }) {
  const status = useTracker((s) => s.status)
  const t = useT()
  const MODES = statModes(t)
  const league = status?.league ?? 'Standard'
  const versionId = status?.build?.versionId
  const [data, setData] = useState<TradeWeightsDTO | null>(null)
  const [choices, setChoices] = useState<StatChoice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [onlyUpgrades, setOnlyUpgrades] = useState(true)
  const [maxPrice, setMaxPrice] = useState('')
  const [currency, setCurrency] = useState<'divine' | 'exalted'>('divine')
  const [instant, setInstant] = useState(false)
  const [preview, setPreview] = useState<TradePreviewDTO | null>(null)
  const [showAll, setShowAll] = useState(false)
  // Each click is a search on the trade site with the player's account: no accidental double clicks.
  const [cooldown, setCooldown] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!slot) return
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    setPreview(null)
    setShowAll(false)
    void window.tracker.getTradeWeights(slot).then((r) => {
      if (cancelled) return
      setLoading(false)
      if (r.ok) {
        setData(r.value)
        setChoices(defaultChoices(r.value.weights))
      } else setError(r.error)
    })
    return () => {
      cancelled = true
    }
  }, [slot, versionId])

  // Recalculate what an item with the chosen stats would give (debounced).
  const mods = useMemo(() => previewMods(choices), [choices])
  useEffect(() => {
    if (!slot || mods.length === 0) {
      setPreview(null)
      return
    }
    const timer = setTimeout(() => {
      void window.tracker.previewTradeItem(slot, mods).then((r) => setPreview(r.ok ? r.value : null))
    }, 300)
    return () => clearTimeout(timer)
  }, [slot, mods])

  const best = Math.max(1, ...choices.map((c) => c.score))
  const price = Number(maxPrice.replace(',', '.'))
  const url = data
    ? tradeSearchUrl(choices, {
        league,
        category: data.category,
        minWeight: onlyUpgrades ? data.minWeight : null,
        maxPrice: price > 0 ? { amount: price, currency } : null,
        instantBuyout: instant
      })
    : null
  const active = choices.filter((c) => c.mode === 'weighted' || c.mode === 'required').length

  function update(i: number, patch: Partial<StatChoice>) {
    setChoices((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  }

  // Offence / defence trade-off: a resistance this item would lose and leave under the cap.
  const losses = preview
    ? RES_KEYS.filter((k) => preview.diff[k] && preview.diff[k]!.delta < 0 && preview.diff[k]!.after < RES_CAP).map((k) => ({
        key: k,
        ...preview.diff[k]!
      }))
    : []

  const changes = preview
    ? PREVIEW_STATS.filter((k) => preview.diff[k] && Math.abs(preview.diff[k]!.delta) > 1e-6).map((k) => ({ key: k, ...preview.diff[k]! }))
    : []

  return (
    <div ref={cardRef}>
      <Card title={t('Find an upgrade on trade')}>
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="text-stone-500">{t('Slot')}</span>
          <select
            aria-label={t('Slot to upgrade')}
            className="rounded-md border border-stone-800 bg-stone-950 px-2 py-1 outline-none focus:border-ember-500"
            value={slot ?? ''}
            onChange={(e) => e.target.value && onSlot(e.target.value)}
          >
            <option value="">{t('— choose —')}</option>
            {slots.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="text-xs text-stone-500">{t('League: {league}', { league })}</span>
        </div>

        {!slot && (
          <p className="text-sm text-stone-500">
            {t(
              'Pick a slot: PoB tests every stat that can roll there on your build, then you open a ready-made search on the official trade site.'
            )}
          </p>
        )}
        {loading && <p className="text-sm text-stone-400">{t('PoB is testing every stat for this slot…')}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}

        {data && (
          <>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="pb-1 font-normal">{t('Stat (tested value)')}</th>
                  <th className="w-28 pb-1 font-normal">{t('Impact')}</th>
                  <th className="pb-1 font-normal" />
                </tr>
              </thead>
              <tbody>
                {choices.map((c, i) =>
                  !showAll && i >= VISIBLE && c.mode === 'off' ? null : (
                  <tr key={c.tradeId} className={`border-t border-stone-800/60 ${c.mode === 'off' ? 'opacity-50' : ''}`}>
                    <td className="py-1 pr-2">
                      {withValue(c.text, c.mode === 'required' && c.min !== undefined ? c.min : c.typical)}
                      {c.tradeId.startsWith('implicit.') && <span className="ml-1 text-xs text-stone-500">{t('(implicit)')}</span>}
                    </td>
                    <td className="py-1 pr-2">
                      <div className="h-1.5 w-full rounded bg-stone-800" title={t('PoB score {score}', { score: Math.round(c.score) })}>
                        <div className="h-1.5 rounded bg-ember-500" style={{ width: `${Math.max(3, (c.score / best) * 100)}%` }} />
                      </div>
                    </td>
                    <td className="py-1">
                      <div className="flex items-center justify-end gap-1">
                        {c.mode === 'required' && (
                          <input
                            aria-label={t('Minimum for {stat}', { stat: c.text })}
                            className="w-14 rounded border border-stone-700 bg-stone-950 px-1 text-right text-xs tabular-nums outline-none"
                            value={c.min ?? ''}
                            onChange={(e) => {
                              const v = Number(e.target.value)
                              update(i, { min: e.target.value === '' || Number.isNaN(v) ? undefined : v })
                            }}
                          />
                        )}
                        <div className="flex rounded-md border border-stone-800" role="radiogroup" aria-label={c.text}>
                          {MODES.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              role="radio"
                              aria-checked={c.mode === m.id}
                              title={m.title}
                              className={`px-1.5 py-0.5 text-xs ${
                                c.mode === m.id
                                  ? m.id === 'excluded'
                                    ? 'bg-red-950 text-red-300'
                                    : m.id === 'required'
                                      ? 'bg-sky-950 text-sky-200'
                                      : 'bg-stone-700 text-stone-100'
                                  : 'text-stone-500 hover:text-stone-200'
                              }`}
                              onClick={() => update(i, { mode: m.id, ...(m.id === 'required' && c.min === undefined ? { min: c.typical } : {}) })}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                  )
                )}
              </tbody>
            </table>
            {choices.length > VISIBLE && (
              <button type="button" className="mt-1 text-xs text-stone-400 hover:text-stone-200" onClick={() => setShowAll(!showAll)}>
                {showAll ? t('Show fewer stats') : t('Show all {n} stats', { n: choices.length })}
              </button>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-stone-400">
              <label className="flex items-center gap-1.5" title={t("PoB's minimum score, close to your current item")}>
                <input type="checkbox" className="accent-amber-500" checked={onlyUpgrades} onChange={(e) => setOnlyUpgrades(e.target.checked)} />
                {t('Only upgrades over my item')}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" className="accent-amber-500" checked={instant} onChange={(e) => setInstant(e.target.checked)} />
                {t('Instant buyout only')}
              </label>
              <span className="flex items-center gap-1.5">
                {t('Max price')}
                <input
                  aria-label={t('Max price')}
                  className="w-14 rounded border border-stone-700 bg-stone-950 px-1 text-right tabular-nums outline-none"
                  placeholder="—"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                />
                <select
                  aria-label={t('Price currency')}
                  className="rounded border border-stone-700 bg-stone-950 px-1 outline-none"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as 'divine' | 'exalted')}
                >
                  <option value="divine">div</option>
                  <option value="exalted">ex</option>
                </select>
              </span>
            </div>

            {preview && (
              <div className="mt-3 rounded-md border border-stone-800 bg-stone-950/60 p-2 text-sm">
                <div className="text-xs text-stone-500">{t('An item with {stats} would give you (PoB):', { stats: preview.lines.join(', ') })}</div>
                {losses.map((l) => (
                  <div key={l.key} className="mt-1 text-amber-400">
                    ⚠{' '}
                    {t('{stat} would drop to {value}% — your current item gives it. Set that stat to “Must have” to keep it.', {
                      stat: statLabel(l.key, t),
                      value: Math.round(l.after)
                    })}
                  </div>
                ))}
                <div className="mt-1 flex flex-wrap gap-x-3">
                  {changes.length === 0 ? (
                    <span className="text-stone-500">{t('no change to key stats')}</span>
                  ) : (
                    changes.map((c) => (
                      <span key={c.key} className={isImprovement(c.key, c.delta) ? 'text-emerald-400' : 'text-red-400'}>
                        {statLabel(c.key, t)} {formatDelta(c.key, c.before, c.delta)}
                      </span>
                    ))
                  )}
                </div>
              </div>
            )}

            <div className="mt-3 flex items-center gap-3">
              <Button
                disabled={!url || active === 0 || cooldown}
                onClick={() => {
                  if (!url) return
                  window.open(url, '_blank')
                  setCooldown(true)
                  setTimeout(() => setCooldown(false), 3000)
                }}
              >
                {cooldown ? t('Opened in your browser') : t('Open trade search')}
              </Button>
              <span className="text-xs text-stone-500">
                {active === 1 ? t('{n} stat', { n: active }) : t('{n} stats', { n: active })} ·{' '}
                {t('opens pathofexile.com in your browser')}
              </span>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

function formatDelta(key: string, before: number, delta: number): string {
  const sign = delta > 0 ? '+' : ''
  if (key.endsWith('Resist')) return `${sign}${Math.round(delta)}%`
  if (key === 'EffectiveMovementSpeedMod') return `${sign}${Math.round(delta * 100)}%`
  if (before > 0 && (key === 'CombinedDPS' || key === 'TotalEHP')) return `${sign}${Math.round((delta / before) * 100)}%`
  return `${sign}${Math.round(delta)}`
}
