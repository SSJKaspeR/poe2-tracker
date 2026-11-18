import { useEffect, useState } from 'react'
import { useTracker } from '../store'
import { formatDuration, formatTime } from '../format'
import { Button, Card } from './Card'

const STATE_LABEL = {
  idle: 'Waiting for a map',
  running: 'In map',
  pending_end: 'In hideout — portal still open'
} as const

export function StatusBar() {
  const status = useTracker((s) => s.status)
  if (!status) return null
  const runsPerHour = status.today.activeMs > 0 ? (status.today.runs / status.today.activeMs) * 3_600_000 : 0
  return (
    <div className="grid grid-cols-4 gap-3">
      <Stat label="Maps today" value={String(status.today.runs)} />
      <Stat label="Time in maps" value={formatDuration(status.today.activeMs)} />
      <Stat label="Maps / hour" value={runsPerHour ? runsPerHour.toFixed(1) : '—'} />
      <Stat label="Deaths today" value={String(status.today.deaths)} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900/60 px-4 py-3">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-stone-100">{value}</div>
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
          <div className="text-lg font-semibold text-stone-100">
            {run ? (run.areaName ?? run.areaId) : STATE_LABEL.idle}
          </div>
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
