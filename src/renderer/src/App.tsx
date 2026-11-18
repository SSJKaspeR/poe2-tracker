import { useEffect } from 'react'
import { BuildPanel, ItemComparePanel, VersionHistory } from './components/BuildPanel'
import { Button } from './components/Card'
import { CurrentRun, RecentRuns, RunEconomy, StatusBar } from './components/RunsPanel'
import { StrategyPanel } from './components/StrategyPanel'
import { useTracker } from './store'

export function App() {
  const refresh = useTracker((s) => s.refresh)
  const setStatus = useTracker((s) => s.setStatus)
  const status = useTracker((s) => s.status)

  useEffect(() => {
    void refresh()
    return window.tracker.onStatusChanged(setStatus)
  }, [refresh, setStatus])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-stone-800 px-6 py-3">
        <h1 className="text-base font-semibold tracking-wide text-ember-400">PoE2 Tracker</h1>
        <HeaderStatus />
      </header>
      {status && (
        <main className="grid flex-1 grid-cols-[1fr_400px] gap-4 overflow-auto p-6">
          <div className="space-y-4">
            <StatusBar />
            <CurrentRun />
            <RunEconomy />
            <RecentRuns />
          </div>
          <div className="space-y-4">
            <BuildPanel />
            <ItemComparePanel />
            <VersionHistory />
            <StrategyPanel />
          </div>
        </main>
      )}
      <footer className="border-t border-stone-800 px-6 py-2 text-[11px] text-stone-600">
        Calculations by the Path of Building Community engine (MIT). Prices from poe.ninja. Not affiliated with or
        endorsed by Grinding Gear Games.
      </footer>
    </div>
  )
}

function HeaderStatus() {
  const status = useTracker((s) => s.status)
  const setStatus = useTracker((s) => s.setStatus)
  if (!status) return null
  return (
    <div className="flex items-center gap-4 text-xs">
      <span
        className={status.prices.count ? 'text-stone-400' : 'text-amber-500'}
        title={status.prices.error ?? `${status.prices.count} prices`}
      >
        {status.league ?? '…'} · {status.prices.count ? `${status.prices.count} prices` : status.prices.error ?? 'loading prices'}
      </span>
      {status.logWatching ? (
        <span className="text-emerald-400" title={status.clientLogPath ?? ''}>
          ● Reading Client.txt
        </span>
      ) : (
        <span className="text-red-400">● Client.txt not found</span>
      )}
      <Button variant="ghost" onClick={() => void window.tracker.chooseClientLog().then(setStatus)}>
        {status.logWatching ? 'Change' : 'Locate Client.txt'}
      </Button>
    </div>
  )
}
