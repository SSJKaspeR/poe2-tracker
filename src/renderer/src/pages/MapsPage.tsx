import { Fragment, useEffect, useMemo, useState } from 'react'
import type { RunDetailDTO, RunLinesDTO } from '@shared/ipc'
import { Card } from '../components/Card'
import { ItemPicker } from '../components/ItemPicker'
import { LootFilterPanel } from '../components/LootFilterPanel'
import { formatDuration } from '../format'
import { useMoney, useT, useTracker } from '../store'

const PERIODS = [1, 7, 30, null] as const

type Period = (typeof PERIODS)[number]

export function MapsPage() {
  const status = useTracker((s) => s.status)
  const money = useMoney()
  const t = useT()
  const periodLabel = (d: Period) => (d === 1 ? t('Today') : d === 7 ? t('7 days') : d === 30 ? t('30 days') : t('All'))
  const [period, setPeriod] = useState<Period>(7)
  const [runs, setRuns] = useState<RunDetailDTO[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const refreshKey = `${status?.today.runs}-${status?.todayProfit.looted}-${status?.todayProfit.invested}`

  useEffect(() => {
    void window.tracker.getRunsDetailed(period).then(setRuns)
  }, [period, refreshKey])

  const totals = useMemo(() => summarise(runs), [runs])
  const byMap = useMemo(() => groupByMap(runs), [runs])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2" role="tablist" aria-label={t('Period')}>
        {PERIODS.map((p) => (
          <button
            key={String(p)}
            type="button"
            role="tab"
            aria-selected={period === p}
            className={`rounded-md px-3 py-1 text-sm ${period === p ? 'bg-stone-800 text-stone-100' : 'text-stone-400 hover:text-stone-200'}`}
            onClick={() => setPeriod(p)}
          >
            {periodLabel(p)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-3 xl:grid-cols-8">
        <Tile label={t('Maps')} value={String(totals.count)} />
        <Tile label={t('Time in maps')} value={formatDuration(totals.activeMs)} />
        <Tile label={t('Avg / map')} value={totals.count ? formatDuration(totals.activeMs / totals.count) : '—'} />
        <Tile label={t('Deaths / map')} value={totals.count ? (totals.deaths / totals.count).toFixed(2) : '—'} />
        <Tile label={t('Invested')} value={money(totals.invested)} />
        <Tile label={t('Loot')} value={totals.withLoot ? money(totals.looted) : '—'} />
        <Tile
          label={t('Profit')}
          value={totals.withLoot ? money(totals.looted - totals.invested, { sign: true }) : '—'}
          tone={totals.withLoot ? (totals.looted >= totals.invested ? 'good' : 'bad') : undefined}
        />
        <Tile
          label={t('Profit / hour')}
          value={totals.withLoot && totals.activeMs ? money(((totals.looted - totals.invested) / totals.activeMs) * 3_600_000, { sign: true }) : '—'}
        />
      </div>
      {totals.count > 0 && totals.withLoot < totals.count && (
        <p className="text-xs text-stone-500">
          {t('Loot declared on {n} of {total} maps — maps without loot count as zero in profit.', {
            n: totals.withLoot,
            total: totals.count
          })}
        </p>
      )}

      <Card title={t('Runs')}>
        {runs.length === 0 ? (
          <p className="text-sm text-stone-500">{t('No completed map in this period.')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="pb-2 font-normal">{t('When')}</th>
                <th className="pb-2 font-normal">{t('Map')}</th>
                <th className="pb-2 text-right font-normal">{t('Lvl')}</th>
                <th className="pb-2 text-right font-normal">{t('Time')}</th>
                <th className="pb-2 text-right font-normal">{t('Deaths')}</th>
                <th className="pb-2 pl-4 font-normal">{t('Strategy')}</th>
                <th className="pb-2 text-right font-normal">{t('Invested')}</th>
                <th className="pb-2 text-right font-normal">{t('Loot')}</th>
                <th className="pb-2 text-right font-normal">{t('Profit')}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const open = openId === r.id
                const profit = r.looted - r.invested
                return (
                  <Fragment key={r.id}>
                    <tr
                      className={`cursor-pointer border-t border-stone-800/70 hover:bg-stone-800/40 ${open ? 'bg-stone-800/40' : ''}`}
                      onClick={() => setOpenId(open ? null : r.id)}
                    >
                      <td className="py-1.5 tabular-nums text-stone-400">{formatWhen(r.startedAt)}</td>
                      <td className="py-1.5 text-stone-200">
                        {r.areaName ?? r.areaId}
                        {r.kind === 'boss' && (
                          <span
                            className={`ml-2 text-xs ${r.outcome === 'kill' ? 'text-emerald-400' : r.outcome === 'fail' ? 'text-red-400' : 'text-stone-500'}`}
                          >
                            {r.outcome === 'kill' ? t('boss killed') : r.outcome === 'fail' ? t('boss failed') : t('boss')}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-stone-400">{r.areaLevel}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatDuration(r.activeMs)}</td>
                      <td className={`py-1.5 text-right tabular-nums ${r.deaths ? 'text-red-400' : 'text-stone-500'}`}>{r.deaths}</td>
                      <td className="max-w-36 truncate py-1.5 pl-4 text-stone-400">{r.strategyName ?? '—'}</td>
                      <td className="py-1.5 text-right tabular-nums text-stone-400">{r.invested ? money(r.invested) : '—'}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.hasLoot ? money(r.looted) : '—'}</td>
                      <td className={`py-1.5 text-right tabular-nums ${!r.hasLoot ? 'text-stone-600' : profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {r.hasLoot ? money(profit, { sign: true }) : '—'}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={9} className="bg-stone-900 px-3 py-3">
                          <RunDetail run={r} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      {byMap.length > 1 && (
        <Card title={t('By map')}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="pb-2 font-normal">{t('Map')}</th>
                <th className="pb-2 text-right font-normal">{t('Runs')}</th>
                <th className="pb-2 text-right font-normal">{t('Avg time')}</th>
                <th className="pb-2 text-right font-normal">{t('Deaths / map')}</th>
                <th className="pb-2 text-right font-normal">{t('Avg profit')}</th>
              </tr>
            </thead>
            <tbody>
              {byMap.map((m) => (
                <tr key={m.name} className="border-t border-stone-800/70">
                  <td className="py-1.5">{m.name}</td>
                  <td className="py-1.5 text-right tabular-nums">{m.count}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatDuration(m.activeMs / m.count)}</td>
                  <td className="py-1.5 text-right tabular-nums">{(m.deaths / m.count).toFixed(2)}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {m.withLoot ? money((m.looted - m.invested) / m.withLoot, { sign: true }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <LootFilterPanel />
    </div>
  )
}

function RunDetail({ run }: { run: RunDetailDTO }) {
  const money = useMoney()
  const t = useT()
  const endReason: Record<string, string> = {
    new_map: t('next map'),
    timeout: t('time out of the map'),
    game_restart: t('game restart'),
    manual: t('manual')
  }
  const [lines, setLines] = useState<RunLinesDTO | null>(null)
  useEffect(() => {
    void window.tracker.getRunLines(run.id).then(setLines)
  }, [run.id])

  return (
    <div className="grid grid-cols-3 gap-6 text-sm">
      <div className="space-y-1 text-stone-400">
        <div>
          {t('Started')} <span className="text-stone-200">{new Date(run.startedAt).toLocaleString()}</span>
        </div>
        <div>
          {t('In map')} <span className="text-stone-200">{formatDuration(run.activeMs)}</span>
          {run.endedAt && (
            <span className="text-stone-500">
              {' '}
              ({t('wall clock {time}', { time: formatDuration(new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()) })})
            </span>
          )}
        </div>
        <div>
          {t('Portal re-entries')} <span className="text-stone-200">{run.reentries}</span>
        </div>
        <div>
          {t('Build')} <span className="text-stone-200">{run.versionLabel ?? '—'}</span>
        </div>
        <div>
          {t('Ended by')} <span className="text-stone-200">{endReason[run.endReason ?? ''] ?? run.endReason ?? '—'}</span>
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs uppercase tracking-wide text-stone-500">{t('Invested')}</div>
        {lines?.investments.length ? (
          <ul className="space-y-0.5">
            {lines.investments.map((l) => (
              <li key={l.id} className="flex justify-between">
                <span>
                  {l.quantity} × {l.label}
                </span>
                <span className="tabular-nums text-stone-400">{l.unitValue === null ? t('no price') : money(l.unitValue * l.quantity)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-stone-500">{t('Nothing declared.')}</p>
        )}
      </div>
      <div>
        <div className="mb-1 text-xs uppercase tracking-wide text-stone-500">{t('Loot')}</div>
        {lines?.loot.length ? (
          <ul className="mb-2 space-y-0.5">
            {lines.loot.map((l) => (
              <li key={l.id} className="flex justify-between">
                <span>
                  {l.quantity} × {l.label}
                </span>
                <span className="flex gap-2 tabular-nums text-stone-400">
                  {l.unitValue === null ? t('no price') : money(l.unitValue * l.quantity)}
                  <button
                    type="button"
                    aria-label={t('Remove {item}', { item: l.label })}
                    className="text-stone-600 hover:text-red-400"
                    onClick={() => void window.tracker.removeLine(run.id, 'loot', l.id).then(setLines)}
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-2 text-stone-500">{t('Nothing declared.')}</p>
        )}
        <ItemPicker onPick={(item) => void window.tracker.addLoot(run.id, item).then(setLines)} />
      </div>
    </div>
  )
}


function Tile({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-red-400' : 'text-stone-100'
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900/60 px-3 py-2">
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  )
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return sameDay ? time : `${d.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} ${time}`
}

interface Totals {
  count: number
  activeMs: number
  deaths: number
  invested: number
  looted: number
  withLoot: number
}

function summarise(runs: RunDetailDTO[]): Totals {
  return runs.reduce<Totals>(
    (acc, r) => ({
      count: acc.count + 1,
      activeMs: acc.activeMs + r.activeMs,
      deaths: acc.deaths + r.deaths,
      invested: acc.invested + r.invested,
      looted: acc.looted + r.looted,
      withLoot: acc.withLoot + (r.hasLoot ? 1 : 0)
    }),
    { count: 0, activeMs: 0, deaths: 0, invested: 0, looted: 0, withLoot: 0 }
  )
}

function groupByMap(runs: RunDetailDTO[]): (Totals & { name: string })[] {
  const groups = new Map<string, RunDetailDTO[]>()
  for (const r of runs) {
    const name = r.areaName ?? r.areaId
    groups.set(name, [...(groups.get(name) ?? []), r])
  }
  return [...groups.entries()]
    .map(([name, rs]) => {
      const t = summarise(rs)
      // Average profit only over maps where loot was declared.
      const withLoot = rs.filter((r) => r.hasLoot)
      return {
        name,
        ...t,
        invested: withLoot.reduce((a, r) => a + r.invested, 0),
        looted: withLoot.reduce((a, r) => a + r.looted, 0)
      }
    })
    .sort((a, b) => b.count - a.count)
}
