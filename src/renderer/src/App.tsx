import { useEffect, useState } from 'react'
import { BuildPanel, ItemComparePanel } from './components/BuildPanel'
import { Button } from './components/Card'
import { CurrentRun, RecentRuns, RunEconomy, StatusBar } from './components/RunsPanel'
import { SessionBar } from './components/SessionBar'
import { UpdateNotice } from './components/UpdateNotice'
import { VerdictsPanel } from './components/VerdictsPanel'
import { StrategyPanel } from './components/StrategyPanel'
import { BuildPage } from './pages/BuildPage'
import { MapsPage } from './pages/MapsPage'
import { SessionsPage } from './pages/SessionsPage'
import { SettingsPanel } from './components/SettingsPanel'
import { useT, useTracker } from './store'
import type { Translator } from '@shared/i18n'

const TABS = [{ id: 'dashboard' }, { id: 'maps' }, { id: 'sessions' }, { id: 'build' }] as const

function tabLabel(t: Translator, id: Tab): string {
  return { dashboard: t('Dashboard'), maps: t('Maps'), sessions: t('Sessions'), build: t('Build') }[id]
}
type Tab = (typeof TABS)[number]['id']

export function App() {
  const refresh = useTracker((s) => s.refresh)
  const setStatus = useTracker((s) => s.setStatus)
  const status = useTracker((s) => s.status)
  const t = useT()
  const [tab, setTab] = useState<Tab>('dashboard')
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    void refresh()
    return window.tracker.onStatusChanged(setStatus)
  }, [refresh, setStatus])

  // An item copied in game is compared on the Dashboard. Price checkers (Exiled Exchange 2)
  // copy items too, so we never yank the user away from another tab: a notice offers to go there.
  const [pendingItem, setPendingItem] = useState<string | null>(null)
  useEffect(
    () =>
      window.tracker.onItemCompared((res) => {
        if (!res.ok) return
        setTab((current) => {
          if (current !== 'dashboard') setPendingItem(res.value.slot ?? 'item')
          return current
        })
      }),
    []
  )
  const openTab = (id: Tab) => {
    setTab(id)
    if (id === 'dashboard') setPendingItem(null)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-stone-800 px-6 py-3">
        <div className="flex items-center gap-8">
          <h1 className="text-base font-semibold tracking-wide text-ember-400">PoE2 Tracker</h1>
          <nav className="flex gap-1" role="tablist" aria-label={t('Sections')}>
            {TABS.map((x) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={tab === x.id}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  tab === x.id ? 'bg-stone-800 text-stone-100' : 'text-stone-400 hover:text-stone-200'
                }`}
                onClick={() => openTab(x.id)}
              >
                {tabLabel(t, x.id)}
                {x.id === 'dashboard' && pendingItem && (
                  <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-ember-400" aria-label={t('new item compared')} />
                )}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <HeaderStatus />
          <Button variant="ghost" onClick={() => setSettingsOpen(true)}>
            {t('Settings')}
          </Button>
        </div>
      </header>
      {pendingItem && tab !== 'dashboard' && (
        <div className="flex items-center justify-between border-b border-stone-800 bg-stone-900 px-6 py-2 text-sm text-stone-300">
          <span>{t('New item compared ({slot}).', { slot: pendingItem })}</span>
          <span className="flex gap-2">
            <Button onClick={() => openTab('dashboard')}>{t('View comparison')}</Button>
            <Button onClick={() => setPendingItem(null)}>{t('Dismiss')}</Button>
          </span>
        </div>
      )}
      {status && (
        // Tabs stay mounted (hidden) so live panels keep their state and listeners.
        <main className="flex-1 overflow-auto p-6">
          <div className={tab === 'dashboard' ? 'grid grid-cols-[1fr_400px] gap-4' : 'hidden'}>
            <div className="space-y-4">
              <SessionBar />
              <StatusBar />
              <CurrentRun />
              <RunEconomy />
              <VerdictsPanel onNavigate={openTab} />
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
      <footer className="flex items-center justify-between gap-4 border-t border-stone-800 px-6 py-2 text-[11px] text-stone-600">
        <span>
          {t(
            'Calculations by the Path of Building Community engine (MIT). Prices from poe.ninja. Not affiliated with or endorsed by Grinding Gear Games.'
          )}
        </span>
        <UpdateNotice />
      </footer>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

function HeaderStatus() {
  const status = useTracker((s) => s.status)
  const setStatus = useTracker((s) => s.setStatus)
  const t = useT()
  if (!status) return null
  return (
    <div className="flex items-center gap-4 text-xs">
      <span
        className={status.prices.count ? 'text-stone-400' : 'text-amber-500'}
        title={`${status.prices.error ? status.prices.error + ' — ' : ''}${t('{n} prices · poe.ninja requests: {hour} in the last hour, {day} in 24 h', {
          n: status.prices.count,
          hour: status.prices.requestsLastHour,
          day: status.prices.requestsLast24h
        })}`}
      >
        {status.league ?? '…'} ·{' '}
        {status.prices.count ? t('{n} prices', { n: status.prices.count }) : (status.prices.error ?? t('loading prices'))}
      </span>
      {status.logWatching ? (
        <span className="text-emerald-400" title={status.clientLogPath ?? ''}>
          ● {t('Reading Client.txt')}
        </span>
      ) : (
        <span className="text-red-400">● {t('Client.txt not found')}</span>
      )}
      <Button variant="ghost" onClick={() => void window.tracker.chooseClientLog().then(setStatus)}>
        {status.logWatching ? t('Change') : t('Locate Client.txt')}
      </Button>
    </div>
  )
}
