import { useEffect, useState } from 'react'
import type { VerdictDTO } from '@shared/ipc'
import { Button, Card } from './Card'
import { useTracker } from '../store'

const STYLE: Record<VerdictDTO['severity'], { dot: string; label: string }> = {
  warn: { dot: 'bg-red-500', label: 'To fix' },
  tip: { dot: 'bg-amber-400', label: 'Tip' },
  good: { dot: 'bg-emerald-500', label: 'Good' }
}

const TAB_LABEL: Record<VerdictDTO['tab'], string> = {
  dashboard: 'Dashboard',
  maps: 'Maps',
  sessions: 'Sessions',
  build: 'Build'
}

/**
 * What to improve, from the player's own maps, bosses and build. Rules with minimum
 * samples: nothing is said before there is enough data.
 */
export function VerdictsPanel({ onNavigate }: { onNavigate: (tab: VerdictDTO['tab']) => void }) {
  const runsToday = useTracker((s) => s.status?.today.runs ?? 0)
  const versionId = useTracker((s) => s.status?.build?.versionId ?? null)
  const priceCount = useTracker((s) => s.status?.prices.count ?? 0)
  const [verdicts, setVerdicts] = useState<VerdictDTO[] | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let alive = true
    void window.tracker.getVerdicts().then((v) => alive && setVerdicts(v))
    return () => {
      alive = false
    }
  }, [runsToday, versionId, priceCount > 0])

  const shown = showAll ? verdicts : verdicts?.slice(0, 4)
  return (
    <Card title="Verdicts">
      {verdicts === null ? (
        <p className="text-sm text-stone-500">Analysing your maps and build…</p>
      ) : verdicts.length === 0 ? (
        <p className="text-sm text-stone-500">
          Nothing to report yet. Verdicts appear after a few maps (8 for deaths and profit, 3 per map to compare
          them) and once a build is imported.
        </p>
      ) : (
        <ul className="space-y-3" aria-label="Verdicts">
          {shown!.map((v) => (
            <li key={v.id} className="flex gap-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STYLE[v.severity].dot}`} aria-label={STYLE[v.severity].label} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-stone-100">{v.title}</p>
                <p className="text-sm text-stone-400">{v.detail}</p>
              </div>
              {v.tab !== 'dashboard' && (
                <Button variant="ghost" onClick={() => onNavigate(v.tab)}>
                  {TAB_LABEL[v.tab]} →
                </Button>
              )}
            </li>
          ))}
          {verdicts.length > 4 && (
            <li>
              <Button variant="ghost" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show less' : `Show all ${verdicts.length}`}
              </Button>
            </li>
          )}
        </ul>
      )}
    </Card>
  )
}
