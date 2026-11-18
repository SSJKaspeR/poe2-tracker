import { useEffect, useState } from 'react'
import { BuildPanel, ItemComparePanel } from './components/BuildPanel'
import { Button } from './components/Card'
import { CurrentRun, RecentRuns, RunEconomy, StatusBar } from './components/RunsPanel'
import { SessionBar } from './components/SessionBar'
import { StrategyPanel } from './components/StrategyPanel'
import { BuildPage } from './pages/BuildPage'
import { MapsPage } from './pages/MapsPage'
import { SessionsPage } from './pages/SessionsPage'
import { useTracker } from './store'

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'maps', label: 'Maps' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'build', label: 'Build' }
] as const
type Tab = (typeof TABS)[number]['id']

export function App() {
  const refresh = useTracker((s) => s.refresh)
  const setStatus = useTracker((s) => s.setStatus)
  const status = useTracker((s) => s.status)
  const [tab, setTab] = useState<Tab>('dashboard')

  useEffect(() => {
    void refresh()
    return window.tracker.onStatusChanged(setStatus)
  }, [refresh, setStatus])

  // An item copied in game is shown on the Dashboard, whatever tab is open.
  useEffect(() => window.tracker.onItemCompared(() => setTab('dashboard')), [])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-stone-800 px-6 py-3">
        <div className="flex items-center gap-8">
          <h1 className="text-base font-semibold tracking-wide text-ember-400">PoE2 Tracker</h1>
          <nav className="flex gap-1" role="tablist" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  tab === t.id ? 'bg-stone-800 text-stone-100' : 'text-stone-400 hover:text-stone-200'
                }`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        <HeaderStatus />
      </header>
      {status && (
        // Tabs stay mounted (hidden) so live panels keep their state and listeners.
        <main className="flex-1 overflow-auto p-6">
          <div className={tab === 'dashboard' ? 'grid grid-cols-[1fr_400px] gap-4' : 'hidden'}>
            <div className="space-y-4">
              <SessionBar />
              <StatusBar />
              <CurrentRun />
              <RunEconomy />
              <RecentRuns />
            </div>
            <div className="space-y-4">
              <BuildPanel />
              <ItemComparePanel />
              <StrategyPanel />
            </div>
          </div>
          <div className={tab === 'maps' ? '' : 'hidden'}>
            <MapsPage />
          </div>
          <div className={tab === 'sessions' ? '' : 'hidden'}>
            <SessionsPage />
          </div>
          <div className={tab === 'build' ? '' : 'hidden'}>
            <BuildPage />
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
