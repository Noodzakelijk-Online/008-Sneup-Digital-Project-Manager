const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('sneupDesktop', {
  platform: process.platform
});
