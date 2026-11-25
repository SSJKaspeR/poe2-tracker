import { BrowserWindow, screen } from 'electron'
import type { OverlayStateDTO } from '../shared/ipc'

/**
 * In-game overlay: a small transparent window kept above the game.
 *
 * GGG rules: it only shows what the app already knows (Client.txt, the item compared on a
 * key press). It never reads the screen or the game memory and never sends input to the game.
 * Locked (default), mouse clicks go through it to the game and it never takes the focus.
 *
 * The window is shown only when its page has something to show: the page reports its size
 * (0 × 0 = nothing), e.g. the HUD is hidden but an item comparison still pops up.
 */
export class OverlayWindow {
  private win: BrowserWindow | null = null
  private state: OverlayStateDTO | null = null
  private size = { width: 0, height: 0 }

  constructor(
    private readonly opts: {
      preload: string
      load: (win: BrowserWindow) => void
      position: () => { x: number; y: number } | null
      savePosition: (pos: { x: number; y: number }) => void
      onReady?: (win: BrowserWindow) => void
    }
  ) {}

  /** Apply the overlay settings (from the app status). */
  apply(state: OverlayStateDTO): void {
    this.state = state
    if (!state.enabled) {
      this.win?.destroy()
      this.win = null
      this.size = { width: 0, height: 0 }
      return
    }
    const win = this.win ?? this.create()
    win.setIgnoreMouseEvents(state.locked)
    win.setFocusable(!state.locked)
    this.refresh()
  }

  /** Message to the overlay page (status, comparisons…). */
  send(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload)
  }

  /** Size of the page content, reported by the page. */
  resize(width: number, height: number): void {
    this.size = { width: Math.ceil(width), height: Math.ceil(height) }
    this.refresh()
  }

  get window(): BrowserWindow | null {
    return this.win
  }

  private refresh(): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    const { width, height } = this.size
    if (width < 1 || height < 1) {
      if (win.isVisible()) win.hide()
      return
    }
    const [w, h] = win.getContentSize()
    if (w !== width || h !== height) win.setContentSize(width, height)
    if (!win.isVisible()) {
      // Never take the focus away from the game.
      win.showInactive()
      win.setAlwaysOnTop(true, 'screen-saver')
    }
  }

  private create(): BrowserWindow {
    const saved = this.opts.position()
    const pos = saved && onScreen(saved) ? saved : defaultPosition()
    const win = new BrowserWindow({
      x: pos.x,
      y: pos.y,
      width: 320,
      height: 80,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      alwaysOnTop: true,
      title: 'PoE2 Tracker overlay',
      backgroundColor: '#00000000',
      // Never focused: without this, Chromium slows its timers down (map clock, pop-up expiry).
      webPreferences: { preload: this.opts.preload, sandbox: false, contextIsolation: true, backgroundThrottling: false }
    })
    // Keep its own title (the page would rename it), so it can be told apart from the main window.
    win.on('page-title-updated', (e) => e.preventDefault())
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.on('moved', () => {
      const [x, y] = win.getPosition()
      this.opts.savePosition({ x: x!, y: y! })
    })
    win.on('closed', () => {
      if (this.win === win) this.win = null
    })
    win.webContents.on('did-finish-load', () => this.opts.onReady?.(win))
    this.win = win
    this.opts.load(win)
    return win
  }
}

/** A saved place is reused only if it is still on a screen (monitor unplugged…). */
function onScreen(p: { x: number; y: number }): boolean {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return p.x >= a.x - 50 && p.x < a.x + a.width - 50 && p.y >= a.y - 10 && p.y < a.y + a.height - 40
  })
}

/** Left side of the main screen, under the buff bar. */
function defaultPosition(): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea
  return { x: area.x + 16, y: area.y + Math.round(area.height * 0.25) }
}

