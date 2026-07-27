const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const isDev = !app.isPackaged;
let mainWindow;

function sendUpdateStatus(type, message = '') {
  mainWindow?.webContents.send('update:status', { type, message });
}

function configureAutoUpdater() {
  if (isDev) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
  autoUpdater.on('update-available', (info) => sendUpdateStatus('available', `Version ${info.version} wird heruntergeladen …`));
  autoUpdater.on('update-not-available', () => sendUpdateStatus('current'));
  autoUpdater.on('update-downloaded', (info) => sendUpdateStatus('downloaded', `Version ${info.version} ist bereit.`));
  autoUpdater.on('error', (error) => { console.warn('Update check failed:', error.message); sendUpdateStatus('error', 'Updateprüfung fehlgeschlagen.'); });
  setTimeout(() => autoUpdater.checkForUpdates().catch((error) => console.warn('Update check failed:', error.message)), 3500);
}

ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Ironfront Command',
    backgroundColor: '#08110f',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') }
  });
  if (isDev) mainWindow.loadURL('http://127.0.0.1:5173');
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  mainWindow.once('ready-to-show', configureAutoUpdater);
}

app.whenReady().then(() => {
  require('electron').session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'media'));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
