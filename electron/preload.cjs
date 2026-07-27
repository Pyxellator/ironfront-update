const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ironfrontUpdater', {
  onStatus(callback) {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
  install() {
    return ipcRenderer.invoke('update:install');
  },
  getStatus() {
    return ipcRenderer.invoke('update:get-status');
  }
});
