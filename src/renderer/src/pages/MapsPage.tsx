import { Fragment, useEffect, useMemo, useState } from 'react'
import type { RunDetailDTO, RunLinesDTO } from '@shared/ipc'
import { Card } from '../components/Card'
import { ItemPicker } from '../components/ItemPicker'
import { formatDuration } from '../format'
import { useMoney, useTracker } from '../store'

const PERIODS = [
  { label: 'Today', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: 'All', days: null }
] as const

type Period = (typeof PERIODS)[number]['days']

export function MapsPage() {
  const status = useTracker((s) => s.status)
  const money = useMoney()
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
      <div className="flex items-center gap-2" role="tablist" aria-label="Period">
        {PERIODS.map((p) => (
          <button
            key={p.label}
            type="button"
            role="tab"
            aria-selected={period === p.days}
            className={`rounded-md px-3 py-1 text-sm ${period === p.days ? 'bg-stone-800 text-stone-100' : 'text-stone-400 hover:text-stone-200'}`}
            onClick={() => setPeriod(p.days)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-3 xl:grid-cols-8">
        <Tile label="Maps" value={String(totals.count)} />
        <Tile label="Time in maps" value={formatDuration(totals.activeMs)} />
        <Tile label="Avg / map" value={totals.count ? formatDuration(totals.activeMs / totals.count) : '—'} />
        <Tile label="Deaths / map" value={totals.count ? (totals.deaths / totals.count).toFixed(2) : '—'} />
        <Tile label="Invested" value={money(totals.invested)} />
        <Tile label="Loot" value={totals.withLoot ? money(totals.looted) : '—'} />
        <Tile
          label="Profit"
          value={totals.withLoot ? money(totals.looted - totals.invested, { sign: true }) : '—'}
          tone={totals.withLoot ? (totals.looted >= totals.invested ? 'good' : 'bad') : undefined}
        />
        <Tile
          label="Profit / hour"
          value={totals.withLoot && totals.activeMs ? money(((totals.looted - totals.invested) / totals.activeMs) * 3_600_000, { sign: true }) : '—'}
        />
      </div>
      {totals.count > 0 && totals.withLoot < totals.count && (
        <p className="text-xs text-stone-500">
          Loot declared on {totals.withLoot} of {totals.count} maps — maps without loot count as zero in profit.
        </p>
      )}

      <Card title="Runs">
        {runs.length === 0 ? (
          <p className="text-sm text-stone-500">No completed map in this period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="pb-2 font-normal">When</th>
                <th className="pb-2 font-normal">Map</th>
                <th className="pb-2 text-right font-normal">Lvl</th>
                <th className="pb-2 text-right font-normal">Time</th>
                <th className="pb-2 text-right font-normal">Deaths</th>
                <th className="pb-2 pl-4 font-normal">Strategy</th>
                <th className="pb-2 text-right font-normal">Invested</th>
                <th className="pb-2 text-right font-normal">Loot</th>
                <th className="pb-2 text-right font-normal">Profit</th>
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
                      <td className="py-1.5 text-stone-200">{r.areaName ?? r.areaId}</td>
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
        <Card title="By map">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="pb-2 font-normal">Map</th>
                <th className="pb-2 text-right font-normal">Runs</th>
                <th className="pb-2 text-right font-normal">Avg time</th>
                <th className="pb-2 text-right font-normal">Deaths / map</th>
                <th className="pb-2 text-right font-normal">Avg profit</th>
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
    </div>
  )
}

function RunDetail({ run }: { run: RunDetailDTO }) {
  const money = useMoney()
  const [lines, setLines] = useState<RunLinesDTO | null>(null)
  useEffect(() => {
    void window.tracker.getRunLines(run.id).then(setLines)
  }, [run.id])

  return (
    <div className="grid grid-cols-3 gap-6 text-sm">
      <div className="space-y-1 text-stone-400">
        <div>
          Started <span className="text-stone-200">{new Date(run.startedAt).toLocaleString()}</span>
        </div>
        <div>
          In map <span className="text-stone-200">{formatDuration(run.activeMs)}</span>
          {run.endedAt && (
            <span className="text-stone-500">
              {' '}
              (wall clock {formatDuration(new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime())})
            </span>
          )}
        </div>
        <div>
          Portal re-entries <span className="text-stone-200">{run.reentries}</span>
        </div>
        <div>
          Build <span className="text-stone-200">{run.versionLabel ?? '—'}</span>
        </div>
        <div>
          Ended by <span className="text-stone-200">{END_REASON[run.endReason ?? ''] ?? run.endReason ?? '—'}</span>
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs uppercase tracking-wide text-stone-500">Invested</div>
        {lines?.investments.length ? (
          <ul className="space-y-0.5">
            {lines.investments.map((l) => (
              <li key={l.id} className="flex justify-between">
                <span>
                  {l.quantity} × {l.label}
                </span>
                <span className="tabular-nums text-stone-400">{l.unitValue === null ? 'no price' : money(l.unitValue * l.quantity)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-stone-500">Nothing declared.</p>
        )}
      </div>
      <div>
        <div className="mb-1 text-xs uppercase tracking-wide text-stone-500">Loot</div>
        {lines?.loot.length ? (
          <ul className="mb-2 space-y-0.5">
            {lines.loot.map((l) => (
              <li key={l.id} className="flex justify-between">
                <span>
                  {l.quantity} × {l.label}
                </span>
                <span className="flex gap-2 tabular-nums text-stone-400">
                  {l.unitValue === null ? 'no price' : money(l.unitValue * l.quantity)}
                  <button
                    type="button"
                    aria-label={`Remove ${l.label}`}
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
          <p className="mb-2 text-stone-500">Nothing declared.</p>
        )}
        <ItemPicker onPick={(item) => void window.tracker.addLoot(run.id, item).then(setLines)} />
      </div>
    </div>
  )
}

const END_REASON: Record<string, string> = {
  new_map: 'next map',
  timeout: 'time out of the map',
  game_restart: 'game restart',
  manual: 'manual'
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
    (t, r) => ({
      count: t.count + 1,
      activeMs: t.activeMs + r.activeMs,
      deaths: t.deaths + r.deaths,
      invested: t.invested + r.invested,
      looted: t.looted + r.looted,
      withLoot: t.withLoot + (r.hasLoot ? 1 : 0)
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
