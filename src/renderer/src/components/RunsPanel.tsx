import { useEffect, useState } from 'react'
import type { RunLinesDTO } from '@shared/ipc'
import { formatDuration, formatTime } from '../format'
import { useFocusRun, useMoney, useT, useTracker } from '../store'
import { Button, Card } from './Card'
import { ItemPicker } from './ItemPicker'


export function StatusBar() {
  const status = useTracker((s) => s.status)
  const money = useMoney()
  const t = useT()
  if (!status) return null
  const runsPerHour = status.today.activeMs > 0 ? (status.today.runs / status.today.activeMs) * 3_600_000 : 0
  const p = status.todayProfit
  return (
    <div className="grid grid-cols-5 gap-3">
      <Stat label={t('Maps today')} value={String(status.today.runs)} />
      <Stat label={t('Maps / hour')} value={runsPerHour ? runsPerHour.toFixed(1) : '—'} />
      <Stat label={t('Deaths today')} value={String(status.today.deaths)} />
      <Stat
        label={t('Profit today')}
        value={p.runsWithLoot ? money(p.profit, { sign: true }) : '—'}
        tone={p.runsWithLoot ? (p.profit >= 0 ? 'good' : 'bad') : undefined}
      />
      <Stat
        label={t('Profit / hour')}
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
  const t = useT()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const stateLabel = { idle: t('Waiting for a map'), running: t('In map'), pending_end: t('In hideout — portal still open') }
  if (!status) return null
  const run = status.currentRun

  // activeMs only counts closed segments; add the one being played.
  const live = status.segmentStartedAt ? Math.max(0, now - new Date(status.segmentStartedAt).getTime()) : 0
  const elapsed = (run?.activeMs ?? 0) + live

  return (
    <Card
      title={t('Current run')}
      actions={
        run ? (
          <Button variant="ghost" onClick={() => void window.tracker.endCurrentRun().then(setStatus)}>
            {t('End run')}
          </Button>
        ) : null
      }
    >
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-lg font-semibold text-stone-100">{run ? (run.areaName ?? run.areaId) : stateLabel.idle}</div>
          <div className="text-sm text-stone-500">
            {run
              ? `${stateLabel[status.trackerState]} · ${t('area level {level}', { level: run.areaLevel })}`
              : t('Open a Waystone to start tracking')}
          </div>
        </div>
        {run && (
          <div className="text-right">
            <div className="text-3xl font-semibold tabular-nums text-ember-400">{formatDuration(elapsed)}</div>
            <div className="text-xs text-stone-500">
              {run.deaths === 1 ? t('{n} death', { n: run.deaths }) : t('{n} deaths', { n: run.deaths })}
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
  const t = useT()
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

  const isBoss = lines?.kind === 'boss'
  const area = run.areaName ?? run.areaId
  const title = isCurrent
    ? isBoss
      ? t('This attempt')
      : t('This map')
    : isBoss
      ? t('Last attempt — {area}', { area })
      : t('Last map — {area}', { area })
  return (
    <Card title={title}>
      {isBoss && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="text-stone-500">{t('Boss')}</span>
          {(['kill', 'fail'] as const).map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={lines?.outcome === o}
              className={`rounded-md border px-3 py-1 ${
                lines?.outcome === o
                  ? o === 'kill'
                    ? 'border-emerald-600 bg-emerald-950/50 text-emerald-300'
                    : 'border-red-700 bg-red-950/40 text-red-300'
                  : 'border-stone-700 text-stone-300 hover:bg-stone-800'
              }`}
              onClick={() =>
                void window.tracker.setRunOutcome(run.id, lines?.outcome === o ? null : o).then(setLines)
              }
            >
              {o === 'kill' ? t('Killed') : t('Failed')}
            </button>
          ))}
        </div>
      )}
      <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
        <Money label={t('Invested')} value={money(invested)} />
        <Money label={t('Loot')} value={hasLoot ? money(looted) : '—'} />
        <Money
          label={t('Profit')}
          value={hasLoot ? money(looted - invested, { sign: true }) : '—'}
          tone={hasLoot ? (looted - invested >= 0 ? 'good' : 'bad') : undefined}
        />
      </div>

      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-stone-500">{t('Strategy')}</span>
        <select
          aria-label={t('Strategy for this map')}
          className="rounded-md border border-stone-800 bg-stone-950 px-2 py-1 text-sm outline-none focus:border-ember-500"
          value={lines?.strategyId ?? ''}
          onChange={(e) => {
            const id = Number(e.target.value)
            if (id) void window.tracker.applyPresetToRun(run.id, id).then(setLines)
          }}
        >
          <option value="">{presets.length ? t('— choose —') : t('Create one in Strategies')}</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({money(p.costPerMap)})
            </option>
          ))}
        </select>
      </div>

      <div className="mb-2 text-xs uppercase tracking-wide text-stone-500">{t('Loot')}</div>
      <ItemPicker onPick={(item) => void window.tracker.addLoot(run.id, item).then(setLines)} />
      {lines && lines.loot.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {lines.loot.map((l) => (
            <li key={l.id} className="flex items-center justify-between">
              <span>
                {l.quantity} × {l.label}
              </span>
              <span className="flex items-center gap-2 tabular-nums text-stone-400">
                {l.unitValue === null ? <span className="text-amber-500">{t('no price')}</span> : money(l.unitValue * l.quantity)}
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
  const t = useT()
  return (
    <Card title={t('Recent runs')}>
      {runs.length === 0 ? (
        <p className="text-sm text-stone-500">{t('No completed run yet.')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="pb-2 font-normal">{t('Map')}</th>
              <th className="pb-2 font-normal">{t('Level')}</th>
              <th className="pb-2 font-normal">{t('Started')}</th>
              <th className="pb-2 text-right font-normal">{t('Time')}</th>
              <th className="pb-2 text-right font-normal">{t('Deaths')}</th>
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
