const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');

const isDev = !app.isPackaged;
const MIN_DOWNLOAD_SPACE = 700 * 1024 * 1024;
const MIN_INSTALL_SPACE = 350 * 1024 * 1024;
let mainWindow;
let updateStatus = { type: 'checking', message: 'Suche nach Updates …' };

function sendUpdateStatus(type, message = '') {
  updateStatus = { type, message };
  mainWindow?.webContents.send('update:status', updateStatus);
}

function getFreeDiskSpace() {
  try { const stats = fs.statfsSync(app.getPath('exe')); return Number(stats.bavail) * Number(stats.bsize); }
  catch (error) { console.warn('Could not read free disk space:', error.message); return Number.MAX_SAFE_INTEGER; }
}

function clearFinishedUpdateCache() {
  const cacheRoot = path.join(process.env.LOCALAPPDATA || app.getPath('temp'), 'ironfront-command-updater');
  for (const entry of ['pending', 'installer.exe']) {
    try { fs.rmSync(path.join(cacheRoot, entry), { recursive: true, force: true }); }
    catch (error) { console.warn(`Could not clear stale update cache ${entry}:`, error.message); }
  }
}

function configureAutoUpdater() {
  if (isDev) return;
  clearFinishedUpdateCache();
  sendUpdateStatus('checking', 'GitHub Releases werden geprüft …');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
  autoUpdater.on('update-available', (info) => {
    if (getFreeDiskSpace() < MIN_DOWNLOAD_SPACE) {
      sendUpdateStatus('error', `Update ${info.version} wartet: Bitte mindestens 700 MB Speicherplatz freigeben.`);
      return;
    }
    sendUpdateStatus('available', `Version ${info.version} wird heruntergeladen …`);
    autoUpdater.downloadUpdate().catch((error) => {
      console.warn('Update download failed:', error.message);
      sendUpdateStatus('error', 'Update konnte nicht heruntergeladen werden. Spiel wird gestartet.');
    });
  });
  autoUpdater.on('update-not-available', () => sendUpdateStatus('current'));
  autoUpdater.on('update-downloaded', (info) => {
    if (getFreeDiskSpace() < MIN_INSTALL_SPACE) {
      sendUpdateStatus('error', `Update ${info.version} wartet: Für die Installation werden noch 350 MB freier Speicher benötigt.`);
      return;
    }
    sendUpdateStatus('downloaded', `Version ${info.version} wird im Hintergrund installiert. Die App startet gleich neu.`);
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1200);
  });
  autoUpdater.on('error', (error) => { console.warn('Update check failed:', error.message); sendUpdateStatus('error', 'Updateprüfung fehlgeschlagen.'); });
  setTimeout(() => autoUpdater.checkForUpdates().catch((error) => { console.warn('Update check failed:', error.message); sendUpdateStatus('error', 'Updateprüfung nicht erreichbar. Spiel wird gestartet.'); }), 1200);
}

ipcMain.handle('update:install', () => autoUpdater.quitAndInstall(true, true));
ipcMain.handle('update:get-status', () => updateStatus);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Ironfront Command',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    backgroundColor: '#08110f',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') }
  });
  if (isDev) mainWindow.loadURL('http://127.0.0.1:5173');
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  mainWindow.once('ready-to-show', () => { if (isDev) sendUpdateStatus('current', 'Entwicklungsmodus'); else configureAutoUpdater(); });
}

app.whenReady().then(() => {
  require('electron').session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'media'));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
