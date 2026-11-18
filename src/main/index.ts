import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, resolve } from 'node:path'
import { resolveDevPobPaths } from '../core/pob/paths'
import { TrackerService } from './TrackerService'

let mainWindow: BrowserWindow | null = null
let service: TrackerService | null = null

function pobOptions() {
  // Dev: engine installed by `npm run setup:pob` under <repo>/.pob.
  // Packaged builds will ship the engine in resources/ (see docs/pob-engine.md).
  const root = app.isPackaged ? process.resourcesPath : resolve(app.getAppPath())
  const paths = resolveDevPobPaths(root)
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
  ipcMain.handle('pob:import', (_e, code: string) => svc.importBuild(code))
  ipcMain.handle('pob:compare-item', (_e, text: string) => svc.compareItem(text))
  ipcMain.handle('prices:get', (_e, league: string, type: string) => svc.prices(league, type))
}

app.whenReady().then(async () => {
  service = new TrackerService({
    dbPath: join(app.getPath('userData'), 'poe2-tracker.db'),
    pob: pobOptions(),
    log: (msg) => {
      if (process.env.POE2_TRACKER_DEBUG) console.log(msg)
    }
  })
  service.on('status', (status) => mainWindow?.webContents.send('status:changed', status))
  registerIpc(service)
  createWindow()
  await service.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting || !service) return
  event.preventDefault()
  quitting = true
  void service.stop().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
