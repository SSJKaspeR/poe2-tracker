import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, shell } from 'electron'
import { join, resolve } from 'node:path'
import { poe2DocumentsDirs } from '../core/filter/findLootFilter'
import { Updater } from './updater'
import { resolvePobPaths } from '../core/pob/paths'
import { TrackerService } from './TrackerService'

let mainWindow: BrowserWindow | null = null
let service: TrackerService | null = null
let registeredHotkey: string | null = null
let updater: Updater | null = null

function pobOptions() {
  // Packaged: engine pack shipped in resources/engine. Dev: build/engine or .pob (npm run setup:pob).
  const paths = resolvePobPaths({
    root: resolve(app.getAppPath()),
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined
  })
  if (!paths) return null
  const bridgeScript = app.isPackaged
    ? join(process.resourcesPath, 'pob', 'bridge.lua')
    : join(app.getAppPath(), 'resources', 'pob', 'bridge.lua')
  return { ...paths, bridgeScript }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0c0a09',
    title: 'PoE2 Tracker',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

function registerIpc(svc: TrackerService): void {
  ipcMain.handle('status:get', () => svc.status())
  ipcMain.handle('runs:recent', (_e, limit?: number) => svc.recentRuns(limit))
  ipcMain.handle('runs:end-current', () => {
    svc.endCurrentRun()
    return svc.status()
  })
  ipcMain.handle('log:choose', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Path of Exile 2 Client.txt',
      properties: ['openFile'],
      filters: [{ name: 'Client.txt', extensions: ['txt'] }]
    })
    const path = result.filePaths[0]
    if (!result.canceled && path) await svc.watchLog(path)
    return svc.status()
  })
  ipcMain.handle('pob:snapshot', () => svc.buildSnapshot())
  ipcMain.handle('pob:import', (_e, code: string, opts: { newBuild: boolean; name?: string }) => svc.importBuild(code, opts))
  ipcMain.handle('pob:compare-item', (_e, text: string) => svc.compareItem(text))
  ipcMain.handle('pob:equip-item', (_e, text: string) => svc.equipItem(text))
  ipcMain.handle('build:performance', () => svc.versionPerformance())
  ipcMain.handle('build:versions', () => svc.buildVersions())
  ipcMain.handle('build:gear-check', () => svc.gearCheck())
  ipcMain.handle('guide:set', (_e, code: string, name?: string) => svc.setGuideBuild(code, name))
  ipcMain.handle('guide:clear', () => svc.clearGuideBuild())
  ipcMain.handle('guide:compare', () => svc.guideComparison())
  ipcMain.handle('trade:weights', (_e, slot: string) => svc.tradeWeights(slot))
  ipcMain.handle('trade:preview', (_e, slot: string, mods) => svc.tradePreview(slot, mods))
  ipcMain.handle('runs:detailed', (_e, sinceDays: number | null) => svc.runsDetailed(sinceDays))
  ipcMain.handle('verdicts:get', () => svc.verdicts())
  ipcMain.handle('gear:runes', () => svc.runeAdvice())
  ipcMain.handle('gear:sheets', () => svc.itemSheets())
  ipcMain.handle('build:optimisations', () => svc.optimisations())
  ipcMain.handle('gear:priorities', () =>
    svc.upgradePriorities((done, total) => mainWindow?.webContents.send('gear:progress', { done, total }))
  )
  ipcMain.handle('update:get', () => updater?.status ?? null)
  ipcMain.handle('update:install', () => updater?.installNow() ?? false)
  ipcMain.handle('update:check', async () => {
    await updater?.check()
    return updater?.status ?? null
  })
  ipcMain.handle('update:set-auto', (_e, on: boolean) => {
    svc.setUpdateChecks(on)
    return on
  })
  ipcMain.handle('filter:get', (_e, minExalted?: number) => svc.lootFilter(minExalted ?? 1))
  ipcMain.handle('filter:set', (_e, path: string | null) => {
    svc.setLootFilter(path)
    return svc.lootFilter()
  })
  ipcMain.handle('filter:disable', () => {
    svc.disableLootFilter()
    return svc.lootFilter()
  })
  ipcMain.handle('filter:browse', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Choose your PoE 2 loot filter',
      defaultPath: poe2DocumentsDirs(app.getPath('documents'), app.getPath('home'))[0],
      filters: [{ name: 'Loot filter', extensions: ['filter'] }, { name: 'All files', extensions: ['*'] }],
      properties: ['openFile']
    })
    if (!r.canceled && r.filePaths[0]) svc.setLootFilter(r.filePaths[0])
    return svc.lootFilter()
  })
  // Read once, because the player clicked "Paste & import" (GGG: one read per manual action).
  ipcMain.handle('clipboard:read-once', () => clipboard.readText())
  ipcMain.handle('hotkey:set', (_e, accelerator: string | null) => {
    svc.setCompareHotkey(accelerator)
    syncCompareHotkey(svc)
    return svc.status()
  })

  ipcMain.handle('prices:search', (_e, q: string) => svc.searchPrices(q))
  ipcMain.handle('prices:refresh', async () => {
    await svc.refreshPrices()
    return svc.status()
  })
  ipcMain.handle('presets:list', () => svc.presets())
  ipcMain.handle('presets:save', (_e, p) => svc.savePreset(p))
  ipcMain.handle('presets:delete', (_e, id: number) => svc.deletePreset(id))
  ipcMain.handle('presets:set-active', (_e, id: number | null, autoApply: boolean) => {
    svc.setActivePreset(id, autoApply)
    return svc.status()
  })
  ipcMain.handle('runs:lines', (_e, runId: string) => svc.runLines(runId))
  ipcMain.handle('runs:set-outcome', (_e, runId: string, outcome: 'kill' | 'fail' | null) => svc.setRunOutcome(runId, outcome))
  ipcMain.handle('session:start', (_e, s) => {
    svc.startSession(s)
    return svc.status()
  })
  ipcMain.handle('session:end', () => {
    svc.endSession()
    return svc.status()
  })
  ipcMain.handle('session:list', () => svc.sessionHistory())
  ipcMain.handle('session:lines', (_e, id: number) => svc.sessionLines(id))
  ipcMain.handle('session:add-line', (_e, id: number, line) => svc.addSessionLine(id, line))
  ipcMain.handle('session:remove-line', (_e, id: number, lineId: number) => svc.removeSessionLine(id, lineId))
  ipcMain.handle('runs:apply-preset', (_e, runId: string, presetId: number) => svc.applyPresetToRun(runId, presetId))
  ipcMain.handle('runs:add-loot', (_e, runId: string, item) => svc.addLoot(runId, item))
  ipcMain.handle('runs:remove-line', (_e, runId: string, kind: 'loot' | 'investment', lineId: number) =>
    svc.removeLine(runId, kind, lineId)
  )
}

/**
 * Compare hotkey. GGG overlay rules: the clipboard may only be read once per manual key
 * press. So the app never watches the clipboard: each press of the hotkey reads it once
 * (the item the player just copied with Ctrl+C in game). Nothing is sent to the game.
 */
async function compareFromClipboard(svc: TrackerService): Promise<void> {
  const text = await Promise.resolve(clipboard.readText())
  await svc.onCompareHotkey(text)
}

function syncCompareHotkey(svc: TrackerService): void {
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey)
  registeredHotkey = null
  svc.hotkeyError = null
  const accelerator = svc.getCompareHotkey()
  if (accelerator) {
    let ok = false
    try {
      ok = globalShortcut.register(accelerator, () => void compareFromClipboard(svc))
    } catch {
      ok = false
    }
    if (ok) registeredHotkey = accelerator
    else svc.hotkeyError = 'This shortcut is already used by another app: choose another one.'
  }
  mainWindow?.webContents.send('status:changed', svc.status())
}

// One instance only: a second window would double every poe.ninja request and share the database.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return
  service = new TrackerService({
    dbPath: join(app.getPath('userData'), 'poe2-tracker.db'),
    pob: pobOptions(),
    // POE2_FILTER_DIR: tests and unusual installs.
    filterDirs: process.env.POE2_FILTER_DIR
      ? [process.env.POE2_FILTER_DIR]
      : poe2DocumentsDirs(app.getPath('documents'), app.getPath('home')),
    userAgent: `PoE2Tracker/${app.getVersion()} (+https://github.com/SSJKaspeR/poe2-tracker)`,
    log: (msg) => {
      if (process.env.POE2_TRACKER_DEBUG) console.log(msg)
    }
  })
  service.on('status', (status) => mainWindow?.webContents.send('status:changed', status))
  service.on('item-compared', (result) => {
    mainWindow?.webContents.send('item:compared', result)
  })
  service.on('hotkey-miss', (reason) => mainWindow?.webContents.send('hotkey:miss', reason))
  // Same path as the hotkey, for the end-to-end test (a global shortcut can't be pressed there).
  const svcRef = service
  app.on('compare-hotkey' as never, () => void compareFromClipboard(svcRef))
  registerIpc(service)
  createWindow()
  await service.start()
  syncCompareHotkey(service)
  await startUpdater(service)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

/** Updates from GitHub Releases: only for the installed Windows app (not dev, not tests). */
async function startUpdater(svc: TrackerService): Promise<void> {
  const enabled =
    app.isPackaged && process.platform === 'win32' && !process.env.POE2_NO_UPDATES && svc.getUpdateChecks()
  const { autoUpdater } = await import('electron-updater')
  updater = new Updater(autoUpdater, app.getVersion(), {
    enabled,
    log: (msg) => {
      if (process.env.POE2_TRACKER_DEBUG) console.log(msg)
    }
  })
  updater.on('change', (state) => mainWindow?.webContents.send('update:changed', state))
  updater.start()
}

let quitting = false
app.on('before-quit', (event) => {
  if (quitting || !service) return
  event.preventDefault()
  quitting = true
  globalShortcut.unregisterAll()
  updater?.stop()
  void service.stop().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
