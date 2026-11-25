import { useEffect, useState } from 'react'
import type { SessionSummaryDTO } from '@shared/ipc'
import { Card } from '../components/Card'
import { MIN_RATE_MS, modeLabel } from '../components/SessionBar'
import { formatDuration } from '../format'
import { useMoney, useT, useTracker } from '../store'
import type { Translator } from '@shared/i18n'

export function SessionsPage() {
  const status = useTracker((s) => s.status)
  const money = useMoney()
  const t = useT()
  const [sessions, setSessions] = useState<SessionSummaryDTO[]>([])
  const refreshKey = `${status?.session?.id}-${status?.session?.completedRuns}-${status?.session?.profit}-${status?.today.runs}`

  useEffect(() => {
    void window.tracker.getSessions().then(setSessions)
  }, [refreshKey])

  return (
    <Card title={t('Sessions')}>
      {sessions.length === 0 ? (
        <p className="text-sm text-stone-500">{t('No session yet. Start one from the Dashboard to see your real profit per hour.')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="pb-2 font-normal">{t('When')}</th>
              <th className="pb-2 font-normal">{t('Mode')}</th>
              <th className="pb-2 text-right font-normal">{t('Duration')}</th>
              <th className="pb-2 text-right font-normal">{t('Objective')}</th>
              <th className="pb-2 text-right font-normal">{t('Result')}</th>
              <th className="pb-2 text-right font-normal">{t('Profit')}</th>
              <th className="pb-2 text-right font-normal">{t('Profit / h')}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-t border-stone-800/70">
                <td className="py-1.5 tabular-nums text-stone-400">
                  {new Date(s.startedAt).toLocaleDateString([], { day: '2-digit', month: '2-digit' })}{' '}
                  {new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {!s.endedAt && <span className="ml-2 text-ember-400">● {t('live')}</span>}
                </td>
                <td className="py-1.5">{modeLabel(s, t)}</td>
                <td className="py-1.5 text-right tabular-nums">{formatDuration(s.durationMs)}</td>
                <td className="py-1.5 text-right tabular-nums text-stone-400">
                  {s.targetCount ? (
                    <span className={s.objectiveReached ? 'text-emerald-400' : ''}>
                      {s.mode === 'boss' ? s.kills + s.fails : s.completedRuns} / {s.targetCount}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums text-stone-400">{resultLine(s, t)}</td>
                <td className={`py-1.5 text-right tabular-nums ${!s.hasEconomy ? 'text-stone-600' : s.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {s.hasEconomy ? money(s.profit, { sign: true }) : '—'}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {s.profitPerHour !== null ? money(s.profitPerHour, { sign: true }) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-xs text-stone-500">
        {t('Session profit per hour counts the whole session (hideout, trading, loading screens), not only time in maps.')}
      </p>
    </Card>
  )
}

function resultLine(s: SessionSummaryDTO, t: Translator): string {
  if (s.mode === 'boss') {
    const attempts = s.kills + s.fails
    if (attempts) return `${s.kills === 1 ? t('{n} kill', { n: s.kills }) : t('{n} kills', { n: s.kills })} / ${attempts}`
    return s.runs === 1 ? t('{n} attempt', { n: s.runs }) : t('{n} attempts', { n: s.runs })
  }
  if (s.mode === 'maps') {
    const perHour = s.durationMs >= MIN_RATE_MS ? ` · ${((s.completedRuns / s.durationMs) * 3_600_000).toFixed(1)}/h` : ''
    const maps = s.completedRuns === 1 ? t('{n} map', { n: s.completedRuns }) : t('{n} maps', { n: s.completedRuns })
    const deaths = s.deaths === 1 ? t('{n} death', { n: s.deaths }) : t('{n} deaths', { n: s.deaths })
    return `${maps}${perHour} · ${deaths}`
  }
  return s.completedRuns ? t('{n} maps too', { n: s.completedRuns }) : '—'
}
