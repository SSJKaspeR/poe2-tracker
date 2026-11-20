import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppStatus, ItemComparisonDTO, Result, TrackerApi, UpdateStateDTO } from '../shared/ipc'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: TrackerApi = {
  getStatus: () => ipcRenderer.invoke('status:get'),
  getRecentRuns: (limit) => ipcRenderer.invoke('runs:recent', limit),
  chooseClientLog: () => ipcRenderer.invoke('log:choose'),
  endCurrentRun: () => ipcRenderer.invoke('runs:end-current'),

  getBuildSnapshot: () => ipcRenderer.invoke('pob:snapshot'),
  importBuild: (code, opts) => ipcRenderer.invoke('pob:import', code, opts),
  compareItem: (itemText) => ipcRenderer.invoke('pob:compare-item', itemText),
  equipItem: (itemText) => ipcRenderer.invoke('pob:equip-item', itemText),
  getVersionPerformance: () => ipcRenderer.invoke('build:performance'),
  getBuildVersions: () => ipcRenderer.invoke('build:versions'),
  getGearCheck: () => ipcRenderer.invoke('build:gear-check'),
  setGuideBuild: (code, name) => ipcRenderer.invoke('guide:set', code, name),
  clearGuideBuild: () => ipcRenderer.invoke('guide:clear'),
  getGuideComparison: () => ipcRenderer.invoke('guide:compare'),
  getTradeWeights: (slot) => ipcRenderer.invoke('trade:weights', slot),
  previewTradeItem: (slot, mods) => ipcRenderer.invoke('trade:preview', slot, mods),
  getRunsDetailed: (sinceDays) => ipcRenderer.invoke('runs:detailed', sinceDays),
  getUpdateState: () => ipcRenderer.invoke('update:get'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  setAutoUpdates: (on) => ipcRenderer.invoke('update:set-auto', on),
  onUpdateChanged: (listener) => subscribe<UpdateStateDTO>('update:changed', listener),
  getLootFilter: (minExalted) => ipcRenderer.invoke('filter:get', minExalted),
  setLootFilter: (path) => ipcRenderer.invoke('filter:set', path),
  browseLootFilter: () => ipcRenderer.invoke('filter:browse'),
  setClipboardWatch: (on) => ipcRenderer.invoke('clipboard:set-watch', on),
  onItemCompared: (listener) => subscribe<Result<ItemComparisonDTO>>('item:compared', listener),

  searchPrices: (q) => ipcRenderer.invoke('prices:search', q),
  getPresets: () => ipcRenderer.invoke('presets:list'),
  savePreset: (p) => ipcRenderer.invoke('presets:save', p),
  deletePreset: (id) => ipcRenderer.invoke('presets:delete', id),
  setActivePreset: (id, autoApply) => ipcRenderer.invoke('presets:set-active', id, autoApply),
  getRunLines: (runId) => ipcRenderer.invoke('runs:lines', runId),
  applyPresetToRun: (runId, presetId) => ipcRenderer.invoke('runs:apply-preset', runId, presetId),
  addLoot: (runId, item) => ipcRenderer.invoke('runs:add-loot', runId, item),
  removeLine: (runId, kind, lineId) => ipcRenderer.invoke('runs:remove-line', runId, kind, lineId),
  refreshPrices: () => ipcRenderer.invoke('prices:refresh'),

  startSession: (s) => ipcRenderer.invoke('session:start', s),
  endSession: () => ipcRenderer.invoke('session:end'),
  getSessions: () => ipcRenderer.invoke('session:list'),
  setRunOutcome: (runId, outcome) => ipcRenderer.invoke('runs:set-outcome', runId, outcome),
  getSessionLines: (id) => ipcRenderer.invoke('session:lines', id),
  addSessionLine: (id, line) => ipcRenderer.invoke('session:add-line', id, line),
  removeSessionLine: (id, lineId) => ipcRenderer.invoke('session:remove-line', id, lineId),

  onStatusChanged: (listener) => subscribe<AppStatus>('status:changed', listener)
}

contextBridge.exposeInMainWorld('tracker', api)
