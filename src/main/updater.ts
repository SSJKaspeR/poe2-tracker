import { EventEmitter } from 'node:events'
import type { UpdateStateDTO } from '../shared/ipc'

/**
 * Automatic updates from GitHub Releases (electron-updater). The Path of Building engine
 * ships inside the app, so an app release also carries a newer engine.
 *
 * Network: one small request to GitHub at startup and every 6 hours (latest.yml), then the
 * download when a new version exists. Nothing is installed without the player: the update
 * is applied when they click "Restart" or the next time they quit the app.
 */

export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/** The part of electron-updater's autoUpdater we use (faked in tests). */
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
}

export class Updater extends EventEmitter {
  private state: UpdateStateDTO
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly updater: AutoUpdaterLike,
    currentVersion: string,
    private readonly opts: { enabled: boolean; log?: (msg: string) => void }
  ) {
    super()
    this.state = { status: opts.enabled ? 'idle' : 'disabled', current: currentVersion, available: null, progress: null, error: null }
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.on('checking-for-update', () => this.set({ status: 'checking', error: null }))
    updater.on('update-not-available', () => this.set({ status: 'up-to-date' }))
    updater.on('update-available', (info: { version: string }) =>
      this.set({ status: 'downloading', available: info.version, progress: 0 })
    )
    updater.on('download-progress', (p: { percent: number }) => this.set({ status: 'downloading', progress: Math.round(p.percent) }))
    updater.on('update-downloaded', (info: { version: string }) =>
      this.set({ status: 'ready', available: info.version, progress: 100 })
    )
    updater.on('error', (err: Error) => {
      opts.log?.(`[update] ${err?.message ?? err}`)
      // Offline or GitHub unreachable: not worth alarming the player, retry at the next check.
      this.set({ status: this.state.status === 'ready' ? 'ready' : 'error', error: err?.message ?? String(err) })
    })
  }

  get status(): UpdateStateDTO {
    return this.state
  }

  start(): void {
    if (!this.opts.enabled || this.timer) return
    void this.check()
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async check(): Promise<void> {
    if (!this.opts.enabled || this.state.status === 'ready' || this.state.status === 'downloading') return
    try {
      await this.updater.checkForUpdates()
    } catch {
      // reported through the 'error' event
    }
  }

  /** Restart now on the downloaded version. */
  installNow(): boolean {
    if (this.state.status !== 'ready') return false
    this.updater.quitAndInstall()
    return true
  }

  private set(patch: Partial<UpdateStateDTO>): void {
    this.state = { ...this.state, ...patch }
    this.emit('change', this.state)
  }
}
