import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppStatus, TrackerApi } from '../shared/ipc'

const api: TrackerApi = {
  getStatus: () => ipcRenderer.invoke('status:get'),
  getRecentRuns: (limit) => ipcRenderer.invoke('runs:recent', limit),
  chooseClientLog: () => ipcRenderer.invoke('log:choose'),
  endCurrentRun: () => ipcRenderer.invoke('runs:end-current'),
  importBuild: (code) => ipcRenderer.invoke('pob:import', code),
  compareItem: (itemText) => ipcRenderer.invoke('pob:compare-item', itemText),
  getPrices: (league, type) => ipcRenderer.invoke('prices:get', league, type),
  onStatusChanged: (listener) => {
    const handler = (_e: IpcRendererEvent, status: AppStatus) => listener(status)
    ipcRenderer.on('status:changed', handler)
    return () => ipcRenderer.removeListener('status:changed', handler)
  }
}

contextBridge.exposeInMainWorld('tracker', api)
