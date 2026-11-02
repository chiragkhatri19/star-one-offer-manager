const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('om', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  loadOffer: () => ipcRenderer.invoke('offer:load'),
  publish: (offer) => ipcRenderer.invoke('offer:publish', offer),
  history: () => ipcRenderer.invoke('history:list'),
  openUrl: (url) => ipcRenderer.invoke('open:url', url),
});
