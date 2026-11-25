import { useEffect, useState } from 'react'
import type { SessionLineDTO, SessionMode, SessionSummaryDTO } from '@shared/ipc'
import { formatDuration } from '../format'
import { useMoney, useT, useTracker } from '../store'
import type { Translator } from '@shared/i18n'
import { Button, Card } from './Card'
import { ItemPicker } from './ItemPicker'

/** Same threshold as the main process (SessionRepository.MIN_RATE_DURATION_MS). */
export const MIN_RATE_MS = 5 * 60 * 1000

export function sessionModes(t: Translator): { id: SessionMode; label: string; hint: string }[] {
  return [
    { id: 'maps', label: t('Rush maps'), hint: t('A set number of maps') },
    { id: 'boss', label: t('Pinnacle boss'), hint: t('Boss attempts') },
    { id: 'hideout', label: t('Hideout'), hint: t('Stash sorting or crafting') }
  ]
}

/** Pinnacle bosses offered as suggestions; any name can be typed. ⚠️ to update for 1.0. */
const BOSS_SUGGESTIONS = ['Arbiter of Ash', 'Xesht, We That Are One', 'The King in the Mists', 'Zarokh, the Temporal', 'Arbiter of Divinity']

export function modeLabel(s: Pick<SessionSummaryDTO, 'mode' | 'activity' | 'bossName'>, t: Translator): string {
  if (s.mode === 'boss') return s.bossName ? t('Boss — {name}', { name: s.bossName }) : t('Pinnacle boss')
  if (s.mode === 'hideout') return s.activity === 'craft' ? t('Hideout — crafting') : t('Hideout — stash')
  return t('Rush maps')
}

export function SessionBar() {
  const session = useTracker((s) => s.status?.session ?? null)
  return session ? <ActiveSession session={session} /> : <StartSession />
}

function StartSession() {
  const setStatus = useTracker((s) => s.setStatus)
  const [mode, setMode] = useState<SessionMode | null>(null)
  const [count, setCount] = useState('10')
  const [boss, setBoss] = useState('')
  const [activity, setActivity] = useState<'stash' | 'craft'>('stash')
  const t = useT()

  async function start() {
    if (!mode) return
    const n = Number(count)
    const status = await window.tracker.startSession({
      mode,
      targetCount: Number.isFinite(n) && n > 0 ? n : null,
      bossName: boss,
      activity
    })
    setStatus(status)
    setMode(null)
  }

  return (
    <Card title={t('Session')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 text-sm text-stone-400">{t('What are you doing now?')}</span>
        {sessionModes(t).map((m) => (
          <button
            key={m.id}
            type="button"
            title={m.hint}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              mode === m.id ? 'border-ember-500 text-ember-400' : 'border-stone-700 text-stone-300 hover:bg-stone-800'
            }`}
            onClick={() => setMode(mode === m.id ? null : m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          {mode === 'maps' && (
            <label className="flex items-center gap-2 text-stone-400">
              {t('Number of maps')}
              <input
                aria-label={t('Number of maps')}
                className="w-16 rounded-md border border-stone-800 bg-stone-950 px-2 py-1 text-right tabular-nums outline-none focus:border-ember-500"
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </label>
          )}
          {mode === 'boss' && (
            <>
              <input
                aria-label={t('Boss')}
                list="boss-suggestions"
                className="w-56 rounded-md border border-stone-800 bg-stone-950 px-2 py-1 outline-none focus:border-ember-500"
                placeholder={t('Boss (optional)')}
                value={boss}
                onChange={(e) => setBoss(e.target.value)}
              />
              <datalist id="boss-suggestions">
                {BOSS_SUGGESTIONS.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
              <label className="flex items-center gap-2 text-stone-400">
                {t('Attempts')}
                <input
                  aria-label={t('Number of attempts')}
                  className="w-16 rounded-md border border-stone-800 bg-stone-950 px-2 py-1 text-right tabular-nums outline-none focus:border-ember-500"
                  placeholder="—"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                />
              </label>
            </>
          )}
          {mode === 'hideout' && (
            <div className="flex gap-1" role="radiogroup" aria-label={t('Activity')}>
              {(['stash', 'craft'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={activity === a}
                  className={`rounded-md px-3 py-1 ${activity === a ? 'bg-stone-800 text-stone-100' : 'text-stone-400 hover:text-stone-200'}`}
                  onClick={() => setActivity(a)}
                >
                  {a === 'stash' ? t('Stash / sorting') : t('Crafting')}
                </button>
              ))}
            </div>
          )}
          <Button onClick={() => void start()}>{t('Start session')}</Button>
        </div>
      )}
    </Card>
  )
}

function ActiveSession({ session: s }: { session: SessionSummaryDTO }) {
  const setStatus = useTracker((st) => st.setStatus)
  const money = useMoney()
  const t = useT()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const elapsed = now - new Date(s.startedAt).getTime()
  const progress = s.mode === 'boss' ? s.kills + s.fails : s.completedRuns
  // Hourly rates are noise in the first minutes of a session.
  const rateReady = elapsed >= MIN_RATE_MS
  const profitPerHour = s.hasEconomy && rateReady ? (s.profit / elapsed) * 3_600_000 : null

  return (
    <Card
      title={`${t('Session')} · ${modeLabel(s, t)}`}
      actions={
        <Button variant="ghost" onClick={() => void window.tracker.endSession().then(setStatus)}>
          {t('End session')}
        </Button>
      }
    >
      {s.objectiveReached && (
        <div className="mb-3 rounded-md border border-emerald-700 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          {s.mode === 'boss'
            ? t('Objective reached — {n} attempts done.', { n: s.targetCount ?? 0 })
            : t('Objective reached — {n} maps done.', { n: s.targetCount ?? 0 })}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <Metric label={t('Session time')} value={formatDuration(elapsed)} />
        {s.mode !== 'hideout' && (
          <div className="min-w-48">
            <div className="text-xs text-stone-500">{s.mode === 'boss' ? t('Attempts') : t('Maps')}</div>
            <div className="text-xl font-semibold tabular-nums text-stone-100">
              {progress}
              {s.targetCount ? <span className="text-stone-500"> / {s.targetCount}</span> : null}
            </div>
            {s.targetCount ? (
              <div className="mt-1 h-1.5 w-full rounded bg-stone-800" role="progressbar" aria-valuenow={progress} aria-valuemax={s.targetCount}>
                <div className="h-1.5 rounded bg-ember-500" style={{ width: `${Math.min(100, (progress / s.targetCount) * 100)}%` }} />
              </div>
            ) : null}
          </div>
        )}
        {s.mode === 'maps' && (
          <>
            <Metric label={t('Maps / hour')} value={s.completedRuns && rateReady ? ((s.completedRuns / elapsed) * 3_600_000).toFixed(1) : '—'} />
            <Metric label={t('Deaths')} value={String(s.deaths)} />
          </>
        )}
        {s.mode === 'boss' && (
          <>
            <Metric label={t('Kills')} value={String(s.kills)} tone="good" />
            <Metric label={t('Fails')} value={String(s.fails)} tone={s.fails ? 'bad' : undefined} />
            <Metric label={t('Kill rate')} value={s.kills + s.fails ? `${Math.round((s.kills / (s.kills + s.fails)) * 100)}%` : '—'} />
          </>
        )}
        <Metric
          label={t('Profit')}
          value={s.hasEconomy ? money(s.profit, { sign: true }) : '—'}
          tone={s.hasEconomy ? (s.profit >= 0 ? 'good' : 'bad') : undefined}
        />
        <Metric
          label={t('Profit / hour (session)')}
          value={profitPerHour !== null ? money(profitPerHour, { sign: true }) : '—'}
          tone={profitPerHour !== null ? (profitPerHour >= 0 ? 'good' : 'bad') : undefined}
        />
      </div>
      {s.mode === 'hideout' && <SessionLines sessionId={s.id} />}
    </Card>
  )
}

/** Currency spent / gained outside maps: crafting, selling… */
function SessionLines({ sessionId }: { sessionId: number }) {
  const money = useMoney()
  const t = useT()
  const [lines, setLines] = useState<SessionLineDTO[]>([])
  useEffect(() => {
    void window.tracker.getSessionLines(sessionId).then(setLines)
  }, [sessionId])

  const block = (direction: 'spent' | 'gained', title: string) => (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wide text-stone-500">{title}</div>
      <ItemPicker onPick={(item) => void window.tracker.addSessionLine(sessionId, { direction, ...item }).then(setLines)} />
      <ul className="mt-2 space-y-0.5 text-sm">
        {lines
          .filter((l) => l.direction === direction)
          .map((l) => (
            <li key={l.id} className="flex justify-between">
              <span>
                {l.quantity} × {l.label}
              </span>
              <span className="flex gap-2 tabular-nums text-stone-400">
                {l.unitValue === null ? <span className="text-amber-500">{t('no price')}</span> : money(l.unitValue * l.quantity)}
                <button
                  type="button"
                  aria-label={t('Remove {item}', { item: l.label })}
                  className="text-stone-600 hover:text-red-400"
                  onClick={() => void window.tracker.removeSessionLine(sessionId, l.id).then(setLines)}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
      </ul>
    </div>
  )

  return (
    <div className="mt-4 grid grid-cols-2 gap-6">
      {block('spent', t('Spent (craft materials, purchases…)'))}
      {block('gained', t('Gained (sales, crafted items…)'))}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-red-400' : 'text-stone-100'
  return (
    <div>
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  )
}
