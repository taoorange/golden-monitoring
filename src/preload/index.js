import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const goldenAPI = {
  platform: process.platform,
  ping: () => 'pong',
  getLastQuote: () => ipcRenderer.invoke('golden:get-last-quote'),
  refreshQuote: () => ipcRenderer.invoke('golden:refresh-quote'),
  setPollInterval: (sec) => ipcRenderer.invoke('golden:set-poll-interval', sec),
  fetchSgeDaily: () => ipcRenderer.invoke('golden:fetch-sge-daily'),
  fetchSgeIntraday: () => ipcRenderer.invoke('golden:fetch-sge-intraday'),
  getRealtime: () => ipcRenderer.invoke('golden:realtime-get'),
  notify: (payload) => ipcRenderer.invoke('golden:notify', payload),
  loadLedger: () => ipcRenderer.invoke('golden:ledger-load'),
  saveLedger: (entries) => ipcRenderer.invoke('golden:ledger-save', entries),
  getLedgerPath: () => ipcRenderer.invoke('golden:ledger-path'),
  getAutoLaunch: () => ipcRenderer.invoke('golden:autostart-get'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('golden:autostart-set', enabled),
  loadSettings: () => ipcRenderer.invoke('golden:settings-load'),
  saveSettings: (partial) => ipcRenderer.invoke('golden:settings-save', partial),
  onQuote: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('golden:quote', listener)
    return () => ipcRenderer.removeListener('golden:quote', listener)
  },
  onAlert: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('golden:alert', listener)
    return () => ipcRenderer.removeListener('golden:alert', listener)
  },
  onRealtime: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('golden:realtime', listener)
    return () => ipcRenderer.removeListener('golden:realtime', listener)
  },
  onOpenSettings: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('golden:open-settings', listener)
    return () => ipcRenderer.removeListener('golden:open-settings', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('golden', goldenAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.golden = goldenAPI
}
