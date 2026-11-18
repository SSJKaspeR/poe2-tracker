import { create } from 'zustand'
import type { AppStatus, PresetDTO, RunDTO } from '@shared/ipc'

interface TrackerStore {
  status: AppStatus | null
  runs: RunDTO[]
  presets: PresetDTO[]
  refresh: () => Promise<void>
  setStatus: (s: AppStatus) => void
  setPresets: (p: PresetDTO[]) => void
}

export const useTracker = create<TrackerStore>((set) => ({
  status: null,
  runs: [],
  presets: [],
  refresh: async () => {
    const [status, runs, presets] = await Promise.all([
      window.tracker.getStatus(),
      window.tracker.getRecentRuns(30),
      window.tracker.getPresets()
    ])
    set({ status, runs, presets })
  },
  setStatus: (status) => {
    set({ status })
    void window.tracker.getRecentRuns(30).then((runs) => set({ runs }))
  },
  setPresets: (presets) => set({ presets })
}))

/** Run the economy panel works on: the current run, or the last completed one. */
export function useFocusRun(): { run: RunDTO | null; isCurrent: boolean } {
  const status = useTracker((s) => s.status)
  const runs = useTracker((s) => s.runs)
  if (status?.currentRun) return { run: status.currentRun, isCurrent: true }
  return { run: runs.find((r) => r.endedAt) ?? null, isCurrent: false }
}

export function useMoney(): (divine: number, opts?: { sign?: boolean }) => string {
  const rate = useTracker((s) => s.status?.prices.exaltedPerDivine ?? null)
  return (divine, opts) => formatCurrencyImpl(divine, rate, opts)
}

import { formatCurrency as formatCurrencyImpl } from './format'
