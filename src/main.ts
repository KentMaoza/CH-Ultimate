import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
} from 'electron';
import started from 'electron-squirrel-startup';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createCoreCredentialStore } from './electron/core-credential-store';
import { createCoreDesktopService } from './electron/core-desktop-service';
import { registerCoreIpcHandlers } from './electron/core-ipc';
import { ensurePackagedCoreDeployment } from './electron/core-packaged-deployment';

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
  const configPath = app.isPackaged
    ? await ensurePackagedCoreDeployment({
        resourcesPath: process.resourcesPath,
        userDataPath,
      })
    : path.join(userDataPath, 'ch-core-config.json');
  const service = await createCoreDesktopService({
    configPath,
    production: app.isPackaged,
    store,
    platform: process.platform,
  });
  const rendererPath = path.join(
    __dirname,
    `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
  );
  const rendererUrl = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).href
    : pathToFileURL(rendererPath).href);
  const allowE2eTestMock =
    !app.isPackaged &&
    process.env.CH_ULTIMATE_E2E_TEST_MOCK === '1';
  if (allowE2eTestMock) {
    rendererUrl.searchParams.set('ch-ultimate-e2e-test-mock', '1');
  }
  const lockedRendererUrl = rendererUrl.href;
  const unregister = registerCoreIpcHandlers(
    ipcMain,
    service,
    window.webContents,
    lockedRendererUrl,
  );
  window.on('closed', unregister);
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== lockedRendererUrl) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL || allowE2eTestMock) {
    void window.loadURL(lockedRendererUrl);
  } else {
    void window.loadFile(rendererPath);
  }
}

void app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
