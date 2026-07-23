const http = require('http');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { acquireSingleInstanceLock } = require('./singleInstance');
const { createNavigationPolicy } = require('./navigationPolicy');
const {
  getDesktopSettingsPath,
  readDesktopSettings,
  resolveStartupMode,
  saveDesktopStartupMode
} = require('../src/services/desktopRuntimeSettings');

const DESKTOP_PORT = process.env.PORT || '3197';
const DESKTOP_HOST = '127.0.0.1';
const DESKTOP_URL = `http://${DESKTOP_HOST}:${DESKTOP_PORT}`;

process.env.SNEUP_DESKTOP = 'true';
process.env.HOST = DESKTOP_HOST;
process.env.PORT = DESKTOP_PORT;
process.env.SNEUP_PUBLIC_URL = process.env.SNEUP_PUBLIC_URL || DESKTOP_URL;

let mainWindow;

const getSettingsPath = () => getDesktopSettingsPath(app.getPath('userData'));

const configureRuntime = async () => {
  const settings = await readDesktopSettings(getSettingsPath());
  const startupMode = resolveStartupMode({ settings });
  process.env.SNEUP_DEMO_MODE = startupMode === 'demo' ? 'true' : 'false';
  return startupMode;
};

ipcMain.handle('sneup:save-startup-mode', async (_event, startupMode) => {
  const settings = await saveDesktopStartupMode(getSettingsPath(), startupMode);
  return { startupMode: settings.startupMode };
});

ipcMain.handle('sneup:restart', () => {
  app.relaunch();
  setImmediate(() => app.exit(0));
  return { restarting: true };
});

const waitForSneup = (attempts = 80) => new Promise((resolve, reject) => {
  let remaining = attempts;

  const check = () => {
    const request = http.get(`${DESKTOP_URL}/health`, response => {
      response.resume();
      if (response.statusCode && response.statusCode < 500) {
        resolve();
      } else {
        retry();
      }
    });

    request.on('error', retry);
    request.setTimeout(1000, () => {
      request.destroy();
      retry();
    });
  };

  const retry = () => {
    remaining -= 1;
    if (remaining <= 0) {
      reject(new Error('Sneup did not become ready in time.'));
      return;
    }
    setTimeout(check, 250);
  };

  check();
});

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0f172a',
    show: false,
    title: 'Sneup Digital Project Manager',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  const navigationPolicy = createNavigationPolicy({ shell, internalUrl: DESKTOP_URL });
  mainWindow.webContents.setWindowOpenHandler(navigationPolicy.handleWindowOpen);
  mainWindow.webContents.on('will-navigate', navigationPolicy.handleNavigation);
  mainWindow.webContents.on('will-redirect', navigationPolicy.handleNavigation);

  await mainWindow.loadURL(DESKTOP_URL);
};

const start = async () => {
  try {
    // Packaged applications are read-only inside app.asar, so logs live with user data.
    process.env.SNEUP_LOG_DIR = process.env.SNEUP_LOG_DIR || path.join(app.getPath('userData'), 'logs');
    await configureRuntime();
    const sneup = require('../src/index');
    await sneup.initApp();
    await waitForSneup();
    await createWindow();
  } catch (error) {
    dialog.showErrorBox('Sneup could not start', error.message);
    app.quit();
  }
};

if (acquireSingleInstanceLock({ app, getMainWindow: () => mainWindow })) {
  app.whenReady().then(start);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
