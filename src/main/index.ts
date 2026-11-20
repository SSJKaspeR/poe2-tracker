import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { join, resolve } from 'node:path'
import { ClipboardWatcher } from '../core/clipboard/ClipboardWatcher'
import { poe2DocumentsDirs } from '../core/filter/findLootFilter'
import { resolvePobPaths } from '../core/pob/paths'
import { TrackerService } from './TrackerService'

let mainWindow: BrowserWindow | null = null
let service: TrackerService | null = null
let clipboardWatcher: ClipboardWatcher | null = null

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
  ipcMain.handle('filter:get', (_e, minExalted?: number) => svc.lootFilter(minExalted ?? 1))
  ipcMain.handle('filter:set', (_e, path: string | null) => {
    svc.setLootFilter(path)
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
  ipcMain.handle('clipboard:set-watch', (_e, on: boolean) => {
    svc.setClipboardWatch(on)
    syncClipboardWatcher(svc)
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

/** Ctrl+C on an item in game → automatic comparison. */
function syncClipboardWatcher(svc: TrackerService): void {
  if (!clipboardWatcher) {
    clipboardWatcher = new ClipboardWatcher(
      () => clipboard.readText(),
      (text) => void svc.onCopiedItem(text)
    )
  }
  if (svc.status().clipboardWatch) void clipboardWatcher.start()
  else clipboardWatcher.stop()
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
  registerIpc(service)
  createWindow()
  await service.start()
  syncClipboardWatcher(service)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting || !service) return
  event.preventDefault()
  quitting = true
  clipboardWatcher?.stop()
  void service.stop().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
