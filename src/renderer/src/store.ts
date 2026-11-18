import { create } from 'zustand'
import type { AppStatus, RunDTO } from '@shared/ipc'

interface TrackerStore {
  status: AppStatus | null
  runs: RunDTO[]
  refresh: () => Promise<void>
  setStatus: (s: AppStatus) => void
}

export const useTracker = create<TrackerStore>((set) => ({
  status: null,
  runs: [],
  refresh: async () => {
    const [status, runs] = await Promise.all([window.tracker.getStatus(), window.tracker.getRecentRuns(30)])
    set({ status, runs })
  },
  setStatus: (status) => {
    set({ status })
    void window.tracker.getRecentRuns(30).then((runs) => set({ runs }))
  }
}))
