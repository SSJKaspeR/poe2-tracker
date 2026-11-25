import { useEffect, useState } from 'react'
import type { VerdictDTO } from '@shared/ipc'
import { Button, Card } from './Card'
import { useT, useTracker } from '../store'

const DOT: Record<VerdictDTO['severity'], string> = { warn: 'bg-red-500', tip: 'bg-amber-400', good: 'bg-emerald-500' }

/**
 * What to improve, from the player's own maps, bosses and build. Rules with minimum
 * samples: nothing is said before there is enough data.
 */
export function VerdictsPanel({ onNavigate }: { onNavigate: (tab: VerdictDTO['tab']) => void }) {
  const runsToday = useTracker((s) => s.status?.today.runs ?? 0)
  const versionId = useTracker((s) => s.status?.build?.versionId ?? null)
  const priceCount = useTracker((s) => s.status?.prices.count ?? 0)
  const language = useTracker((s) => s.status?.language)
  const t = useT()
  const severityLabel = { warn: t('To fix'), tip: t('Tip'), good: t('Good') }
  const tabLabel = { dashboard: t('Dashboard'), maps: t('Maps'), sessions: t('Sessions'), build: t('Build') }
  const [verdicts, setVerdicts] = useState<VerdictDTO[] | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let alive = true
    void window.tracker.getVerdicts().then((v) => alive && setVerdicts(v))
    return () => {
      alive = false
    }
  }, [runsToday, versionId, priceCount > 0, language])

  const shown = showAll ? verdicts : verdicts?.slice(0, 4)
  return (
    <Card title={t('Verdicts')}>
      {verdicts === null ? (
        <p className="text-sm text-stone-500">{t('Analysing your maps and build…')}</p>
      ) : verdicts.length === 0 ? (
        <p className="text-sm text-stone-500">
          {t(
            'Nothing to report yet. Verdicts appear after a few maps (8 for deaths and profit, 3 per map to compare them) and once a build is imported.'
          )}
        </p>
      ) : (
        <ul className="space-y-3" aria-label={t('Verdicts')}>
          {shown!.map((v) => (
            <li key={v.id} className="flex gap-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[v.severity]}`} aria-label={severityLabel[v.severity]} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-stone-100">{v.title}</p>
                <p className="text-sm text-stone-400">{v.detail}</p>
              </div>
              {v.tab !== 'dashboard' && (
                <Button variant="ghost" onClick={() => onNavigate(v.tab)}>
                  {tabLabel[v.tab]} →
                </Button>
              )}
            </li>
          ))}
          {verdicts.length > 4 && (
            <li>
              <Button variant="ghost" onClick={() => setShowAll(!showAll)}>
                {showAll ? t('Show less') : t('Show all {n}', { n: verdicts.length })}
              </Button>
            </li>
          )}
        </ul>
      )}
    </Card>
  )
}
