import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { Updater } from '../../src/main/updater'

function fakeAutoUpdater() {
  const e = new EventEmitter()
  return Object.assign(e, {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(async () => {
      e.emit('checking-for-update')
    }),
    quitAndInstall: vi.fn()
  })
}

describe('app updates (GitHub Releases)', () => {
  it('downloads in the background and installs only when asked', async () => {
    const au = fakeAutoUpdater()
    const u = new Updater(au, '0.1.0', { enabled: true })
    const seen: string[] = []
    u.on('change', (s) => seen.push(s.status))
    expect(au.autoDownload).toBe(true)
    expect(au.autoInstallOnAppQuit).toBe(true)

    await u.check()
    expect(u.installNow()).toBe(false) // nothing downloaded yet
    au.emit('update-available', { version: '0.2.0' })
    au.emit('download-progress', { percent: 42.4 })
    expect(u.status).toMatchObject({ status: 'downloading', available: '0.2.0', progress: 42 })
    au.emit('update-downloaded', { version: '0.2.0' })
    expect(u.status).toMatchObject({ status: 'ready', current: '0.1.0', available: '0.2.0' })
    await u.check() // no new check once an update is ready
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(u.installNow()).toBe(true)
    expect(au.quitAndInstall).toHaveBeenCalledOnce()
    expect(seen).toEqual(['checking', 'downloading', 'downloading', 'ready'])
  })

  it('up to date, offline, and turned off', async () => {
    const au = fakeAutoUpdater()
    const u = new Updater(au, '0.1.0', { enabled: true })
    au.emit('update-not-available')
    expect(u.status.status).toBe('up-to-date')
    au.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(u.status).toMatchObject({ status: 'error', error: 'net::ERR_INTERNET_DISCONNECTED' })

    const off = fakeAutoUpdater()
    const disabled = new Updater(off, '0.1.0', { enabled: false })
    disabled.start()
    await disabled.check()
    expect(off.checkForUpdates).not.toHaveBeenCalled()
    expect(disabled.status.status).toBe('disabled')
  })

  it('checks at start then every 6 hours', () => {
    vi.useFakeTimers()
    const au = fakeAutoUpdater()
    const u = new Updater(au, '0.1.0', { enabled: true })
    u.start()
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(6 * 3600_000)
    expect(au.checkForUpdates).toHaveBeenCalledTimes(2)
    u.stop()
    vi.advanceTimersByTime(6 * 3600_000)
    expect(au.checkForUpdates).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
