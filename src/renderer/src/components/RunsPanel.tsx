import { useEffect, useState } from 'react'
import type { RunLinesDTO } from '@shared/ipc'
import { formatDuration, formatTime } from '../format'
import { useFocusRun, useMoney, useTracker } from '../store'
import { Button, Card } from './Card'
import { ItemPicker } from './ItemPicker'

const STATE_LABEL = {
  idle: 'Waiting for a map',
  running: 'In map',
  pending_end: 'In hideout — portal still open'
} as const

export function StatusBar() {
  const status = useTracker((s) => s.status)
  const money = useMoney()
  if (!status) return null
  const runsPerHour = status.today.activeMs > 0 ? (status.today.runs / status.today.activeMs) * 3_600_000 : 0
  const p = status.todayProfit
  return (
    <div className="grid grid-cols-5 gap-3">
      <Stat label="Maps today" value={String(status.today.runs)} />
      <Stat label="Maps / hour" value={runsPerHour ? runsPerHour.toFixed(1) : '—'} />
      <Stat label="Deaths today" value={String(status.today.deaths)} />
      <Stat
        label="Profit today"
        value={p.runsWithLoot ? money(p.profit, { sign: true }) : '—'}
        tone={p.runsWithLoot ? (p.profit >= 0 ? 'good' : 'bad') : undefined}
      />
      <Stat
        label="Profit / hour"
        value={p.runsWithLoot && p.profitPerHour !== null ? money(p.profitPerHour, { sign: true }) : '—'}
        tone={p.runsWithLoot && p.profitPerHour !== null ? (p.profitPerHour >= 0 ? 'good' : 'bad') : undefined}
      />
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-red-400' : 'text-stone-100'
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900/60 px-4 py-3">
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  )
}

export function CurrentRun() {
  const status = useTracker((s) => s.status)
  const setStatus = useTracker((s) => s.setStatus)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!status) return null
  const run = status.currentRun

  // activeMs only counts closed segments; add the one being played.
  const live = status.segmentStartedAt ? Math.max(0, now - new Date(status.segmentStartedAt).getTime()) : 0
  const elapsed = (run?.activeMs ?? 0) + live

  return (
    <Card
      title="Current run"
      actions={
        run ? (
          <Button variant="ghost" onClick={() => void window.tracker.endCurrentRun().then(setStatus)}>
            End run
          </Button>
        ) : null
      }
    >
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-lg font-semibold text-stone-100">{run ? (run.areaName ?? run.areaId) : STATE_LABEL.idle}</div>
          <div className="text-sm text-stone-500">
            {run ? `${STATE_LABEL[status.trackerState]} · area level ${run.areaLevel}` : 'Open a Waystone to start tracking'}
          </div>
        </div>
        {run && (
          <div className="text-right">
            <div className="text-3xl font-semibold tabular-nums text-ember-400">{formatDuration(elapsed)}</div>
            <div className="text-xs text-stone-500">
              {run.deaths} death{run.deaths === 1 ? '' : 's'}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

/** Investment + loot of the current run (or the last one), declared in a couple of clicks. */
export function RunEconomy() {
  const { run, isCurrent } = useFocusRun()
  const status = useTracker((s) => s.status)
  const presets = useTracker((s) => s.presets)
  const money = useMoney()
  const [lines, setLines] = useState<RunLinesDTO | null>(null)
  const runId = run?.id ?? null

  // Reload when the focused run changes or anything else updates (auto-applied preset…).
  useEffect(() => {
    if (!runId) {
      setLines(null)
      return
    }
    void window.tracker.getRunLines(runId).then(setLines)
  }, [runId, status])

  if (!run) return null
  const invested = sum(lines?.investments)
  const looted = sum(lines?.loot)
  const hasLoot = (lines?.loot.length ?? 0) > 0

  return (
    <Card title={isCurrent ? 'This map' : `Last map — ${run.areaName ?? run.areaId}`}>
      <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
        <Money label="Invested" value={money(invested)} />
        <Money label="Loot" value={hasLoot ? money(looted) : '—'} />
        <Money
          label="Profit"
          value={hasLoot ? money(looted - invested, { sign: true }) : '—'}
          tone={hasLoot ? (looted - invested >= 0 ? 'good' : 'bad') : undefined}
        />
      </div>

      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-stone-500">Strategy</span>
        <select
          aria-label="Strategy for this map"
          className="rounded-md border border-stone-800 bg-stone-950 px-2 py-1 text-sm outline-none focus:border-ember-500"
          value={lines?.strategyId ?? ''}
          onChange={(e) => {
            const id = Number(e.target.value)
            if (id) void window.tracker.applyPresetToRun(run.id, id).then(setLines)
          }}
        >
          <option value="">{presets.length ? '— choose —' : 'Create one in Strategies'}</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({money(p.costPerMap)})
            </option>
          ))}
        </select>
      </div>

      <div className="mb-2 text-xs uppercase tracking-wide text-stone-500">Loot</div>
      <ItemPicker onPick={(item) => void window.tracker.addLoot(run.id, item).then(setLines)} />
      {lines && lines.loot.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {lines.loot.map((l) => (
            <li key={l.id} className="flex items-center justify-between">
              <span>
                {l.quantity} × {l.label}
              </span>
              <span className="flex items-center gap-2 tabular-nums text-stone-400">
                {l.unitValue === null ? <span className="text-amber-500">no price</span> : money(l.unitValue * l.quantity)}
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
      )}
    </Card>
  )
}

function Money({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-red-400' : 'text-stone-100'
  return (
    <div>
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  )
}

function sum(lines: { quantity: number; unitValue: number | null }[] | undefined): number {
  return (lines ?? []).reduce((acc, l) => acc + l.quantity * (l.unitValue ?? 0), 0)
}

export function RecentRuns() {
  const runs = useTracker((s) => s.runs).filter((r) => r.endedAt)
  return (
    <Card title="Recent runs">
      {runs.length === 0 ? (
        <p className="text-sm text-stone-500">No completed run yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="pb-2 font-normal">Map</th>
              <th className="pb-2 font-normal">Level</th>
              <th className="pb-2 font-normal">Started</th>
              <th className="pb-2 text-right font-normal">Time</th>
              <th className="pb-2 text-right font-normal">Deaths</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-stone-800/70">
                <td className="py-1.5 text-stone-200">{r.areaName ?? r.areaId}</td>
                <td className="py-1.5 tabular-nums text-stone-400">{r.areaLevel}</td>
                <td className="py-1.5 tabular-nums text-stone-400">{formatTime(r.startedAt)}</td>
                <td className="py-1.5 text-right tabular-nums">{formatDuration(r.activeMs)}</td>
                <td className={`py-1.5 text-right tabular-nums ${r.deaths ? 'text-red-400' : 'text-stone-500'}`}>
                  {r.deaths}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
