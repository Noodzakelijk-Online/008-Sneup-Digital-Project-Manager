const http = require('http');
const path = require('path');
const { app, BrowserWindow, dialog, shell } = require('electron');

const DESKTOP_PORT = process.env.PORT || '3197';
const DESKTOP_HOST = '127.0.0.1';
const DESKTOP_URL = `http://${DESKTOP_HOST}:${DESKTOP_PORT}`;

process.env.SNEUP_DESKTOP = 'true';
process.env.SNEUP_DEMO_MODE = process.env.SNEUP_DEMO_MODE || 'true';
process.env.HOST = DESKTOP_HOST;
process.env.PORT = DESKTOP_PORT;
process.env.SNEUP_PUBLIC_URL = process.env.SNEUP_PUBLIC_URL || DESKTOP_URL;

let mainWindow;

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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(DESKTOP_URL);
};

const start = async () => {
  try {
    const sneup = require('../src/index');
    await sneup.initApp();
    await waitForSneup();
    await createWindow();
  } catch (error) {
    dialog.showErrorBox('Sneup could not start', error.message);
    app.quit();
  }
};

app.whenReady().then(start);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
