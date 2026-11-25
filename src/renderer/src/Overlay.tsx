import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ItemComparisonDTO } from '@shared/ipc'
import { formatDuration } from './format'
import { useMoney, useT, useTracker } from './store'

/** How long an item comparison stays on the overlay. */
const COMPARISON_MS = 15_000
const MISS_MS = 5_000

const TONE: Record<string, string> = {
  better: 'text-emerald-300',
  worse: 'text-red-300',
  mixed: 'text-amber-300',
  same: 'text-stone-300'
}

/**
 * In-game overlay page (window loaded with #overlay). Shows the map being played, today's and
 * the session's results, and pops up the verdict of the item compared with the hotkey.
 * Reports its size to the main process: nothing to show = the window hides.
 */
export function Overlay() {
  const refresh = useTracker((s) => s.refresh)
  const setStatus = useTracker((s) => s.setStatus)
  const status = useTracker((s) => s.status)
  const t = useT()
  const money = useMoney()
  const [cmp, setCmp] = useState<ItemComparisonDTO | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void refresh()
    return window.tracker.onStatusChanged(setStatus)
  }, [refresh, setStatus])

  useEffect(
    () =>
      window.tracker.onItemCompared((res) => {
        if (res.ok) {
          setCmp(res.value)
          setNote(null)
        } else setNote(res.error)
      }),
    []
  )
  useEffect(
    () =>
      window.tracker.onHotkeyMiss((reason) =>
        setNote(
          reason === 'not-gear'
            ? t('Not equipment: nothing to compare.')
            : t('Nothing copied: Ctrl+C on the item in game, then the shortcut.')
        )
      ),
    [t]
  )

  const locked = status?.overlay.locked ?? true
  useEffect(() => {
    if (!cmp || !locked) return
    const id = setTimeout(() => setCmp(null), COMPARISON_MS)
    return () => clearTimeout(id)
  }, [cmp, locked])
  useEffect(() => {
    if (!note) return
    const id = setTimeout(() => setNote(null), MISS_MS)
    return () => clearTimeout(id)
  }, [note])

  const running = status?.trackerState === 'running' && Boolean(status.segmentStartedAt)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  const hud = Boolean(status?.overlay.visible) || !locked
  const empty = !status || (!hud && !cmp && !note)

  // The window takes the size of what is shown.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) {
      window.tracker.overlayResize(0, 0)
      return
    }
    const report = () => window.tracker.overlayResize(el.offsetWidth, el.offsetHeight)
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [empty])

  if (empty) return null
  const run = status.currentRun
  const live = running ? Math.max(0, now - new Date(status.segmentStartedAt!).getTime()) : 0
  const s = status.session
  const todayPerHour = status.todayProfit.profitPerHour

  return (
    <div
      ref={box}
      data-testid="overlay"
      className={`w-[300px] space-y-1.5 rounded-lg border bg-stone-950/85 p-2.5 text-xs text-stone-300 shadow-lg ${
        locked ? 'border-stone-800/80' : 'overlay-drag border-dashed border-ember-400'
      }`}
    >
      {!locked && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-ember-400">{t('Drag to move')}</span>
          <button
            type="button"
            className="overlay-no-drag rounded border border-stone-600 px-2 py-0.5 text-stone-100 hover:bg-stone-800"
            onClick={() => void window.tracker.setOverlay({ locked: true }).then(setStatus)}
          >
            {t('Lock')}
          </button>
        </div>
      )}

      {hud && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  status.trackerState === 'running' ? 'bg-emerald-400' : status.trackerState === 'pending_end' ? 'bg-amber-400' : 'bg-stone-600'
                }`}
              />
              <span className="truncate text-sm text-stone-100">
                {run ? (run.areaName ?? run.areaId) : t('Waiting for a map')}
              </span>
            </span>
            {run && <span className="text-sm font-semibold tabular-nums text-stone-100">{formatDuration(run.activeMs + live)}</span>}
          </div>
          <div className="flex justify-between gap-2 text-stone-400">
            <span>
              {run ? (run.deaths === 1 ? t('{n} death', { n: 1 }) : t('{n} deaths', { n: run.deaths })) : ''}
            </span>
            <span className="tabular-nums">
              {status.today.runs === 1 ? t('Today: {n} map', { n: 1 }) : t('Today: {n} maps', { n: status.today.runs })}
              {todayPerHour !== null && ` · ${money(todayPerHour)}/h`}
            </span>
          </div>
          {s && (
            <div className="flex justify-between gap-2 border-t border-stone-800 pt-1.5 text-stone-400">
              <span>
                {s.mode === 'boss'
                  ? t('Session: {kills} kills / {attempts}', { kills: s.kills, attempts: s.kills + s.fails })
                  : s.mode === 'hideout'
                    ? t('Session: hideout')
                    : s.targetCount
                      ? t('Session: {n} / {target} maps', { n: s.completedRuns, target: s.targetCount })
                      : t('Session: {n} maps', { n: s.completedRuns })}
                {s.objectiveReached && <span className="text-emerald-300"> ✓</span>}
              </span>
              {s.profitPerHour !== null && <span className="tabular-nums">{money(s.profitPerHour)}/h</span>}
            </div>
          )}
        </>
      )}

      {cmp && (
        <div className={`${hud ? 'border-t border-stone-800 pt-1.5' : ''} space-y-1`} data-testid="overlay-comparison">
          <div className="flex justify-between gap-2 text-stone-400">
            <span className="truncate text-stone-100">{cmp.item.name}</span>
            <span className="shrink-0">{cmp.slot}</span>
          </div>
          {cmp.verdict && <p className={`text-[13px] leading-snug ${TONE[cmp.verdict.tone] ?? ''}`}>{cmp.verdict.text}</p>}
          {cmp.impact && cmp.impact.length > 0 && (
            <ul className="space-y-0.5">
              {cmp.impact.slice(0, 3).map((l) => (
                <li key={l.text} className={l.good ? 'text-emerald-400' : 'text-red-400'}>
                  {l.good ? '▲' : '▼'} {l.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {note && <p className="text-amber-300">{note}</p>}
    </div>
  )
}
