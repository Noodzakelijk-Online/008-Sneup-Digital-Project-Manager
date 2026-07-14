const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sneupDesktop', {
  platform: process.platform,
  saveStartupMode: (startupMode) => ipcRenderer.invoke('sneup:save-startup-mode', startupMode),
  restart: () => ipcRenderer.invoke('sneup:restart')
});
