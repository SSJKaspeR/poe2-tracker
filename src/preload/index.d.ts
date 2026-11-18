import type { TrackerApi } from '../shared/ipc'

declare global {
  interface Window {
    tracker: TrackerApi
  }
}
