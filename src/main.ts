import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
} from 'electron';
import started from 'electron-squirrel-startup';
import path from 'node:path';

import { createCoreCredentialStore } from './electron/core-credential-store';
import { createCoreDesktopService } from './electron/core-desktop-service';
import { registerCoreIpcHandlers } from './electron/core-ipc';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

if (started) app.quit();

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#f4f4f0',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const userDataPath = app.getPath('userData');
  const store = createCoreCredentialStore({
    safeStorage,
    userDataPath,
  });
  const service = await createCoreDesktopService({
    configPath: path.join(userDataPath, 'ch-core-config.json'),
    production: app.isPackaged,
    store,
    platform: process.platform,
  });
  const unregister = registerCoreIpcHandlers(
    ipcMain,
    service,
    window.webContents,
  );
  window.on('closed', unregister);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(
      path.join(
        __dirname,
        `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
      ),
    );
  }
}

void app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
