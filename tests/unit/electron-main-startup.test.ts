import { afterEach, describe, expect, it, vi } from 'vitest';
import { pathToFileURL } from 'node:url';

afterEach(() => {
  vi.doUnmock('electron');
  vi.doUnmock('electron-squirrel-startup');
  vi.doUnmock('../../src/electron/core-credential-store');
  vi.doUnmock('../../src/electron/core-desktop-service');
  vi.doUnmock('../../src/electron/core-ipc');
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Electron CH Core startup', () => {
  it('waits for app readiness and binds IPC to the created window', async () => {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const callOrder: string[] = [];
    const webContentsOn = vi.fn();
    const setWindowOpenHandler = vi.fn();
    const trustedContents = {
      mainFrame: {},
      on: webContentsOn,
      setWindowOpenHandler,
    };
    const windowOn = vi.fn();
    const windowInstance = {
      webContents: trustedContents,
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: windowOn,
    };
    const BrowserWindow = vi.fn(function BrowserWindowMock(
      _options: unknown,
    ) {
      callOrder.push('window');
      return windowInstance;
    });
    Object.assign(BrowserWindow, {
      getAllWindows: vi.fn(() => [windowInstance]),
    });
    const app = {
      isPackaged: true,
      getPath: vi.fn(() => '/private/ch-ultimate-user-data'),
      quit: vi.fn(),
      whenReady: vi.fn(() => ready),
      on: vi.fn(),
    };
    const ipcMain = {};
    const safeStorage = {};
    const store = {};
    const service = {};
    const unregister = vi.fn();
    const createCoreCredentialStore = vi.fn(() => {
      callOrder.push('store');
      return store;
    });
    const createCoreDesktopService = vi.fn(async () => {
      callOrder.push('service');
      return service;
    });
    const registerCoreIpcHandlers = vi.fn(() => {
      callOrder.push('register');
      return unregister;
    });

    vi.doMock('electron', () => ({
      app,
      BrowserWindow,
      ipcMain,
      safeStorage,
    }));
    vi.doMock('electron-squirrel-startup', () => ({ default: false }));
    vi.doMock('../../src/electron/core-credential-store', () => ({
      createCoreCredentialStore,
    }));
    vi.doMock('../../src/electron/core-desktop-service', () => ({
      createCoreDesktopService,
    }));
    vi.doMock('../../src/electron/core-ipc', () => ({
      registerCoreIpcHandlers,
    }));
    vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined);
    vi.stubGlobal('MAIN_WINDOW_VITE_NAME', 'main_window');

    await import('../../src/main');

    expect(createCoreCredentialStore).not.toHaveBeenCalled();
    resolveReady();
    await vi.waitFor(() =>
      expect(registerCoreIpcHandlers).toHaveBeenCalledTimes(1),
    );

    expect(callOrder).toEqual(['window', 'store', 'service', 'register']);
    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          preload: expect.stringMatching(/[/\\]preload\.js$/),
        },
      }),
    );
    expect(createCoreCredentialStore).toHaveBeenCalledWith({
      safeStorage,
      userDataPath: '/private/ch-ultimate-user-data',
    });
    expect(createCoreDesktopService).toHaveBeenCalledWith({
      configPath:
        '/private/ch-ultimate-user-data/ch-core-config.json',
      production: true,
      store,
      platform: process.platform,
    });
    expect(registerCoreIpcHandlers).toHaveBeenCalledWith(
      ipcMain,
      service,
      trustedContents,
      expect.stringMatching(/^file:.*[/\\]renderer[/\\]main_window[/\\]index\.html$/),
    );
    const rendererPath = windowInstance.loadFile.mock.calls[0]?.[0];
    const rendererUrl = pathToFileURL(rendererPath).href;
    expect(registerCoreIpcHandlers).toHaveBeenCalledWith(
      ipcMain,
      service,
      trustedContents,
      rendererUrl,
    );

    const willNavigate = webContentsOn.mock.calls.find(
      ([event]) => event === 'will-navigate',
    )?.[1];
    expect(willNavigate).toEqual(expect.any(Function));
    const allowedEvent = { preventDefault: vi.fn() };
    willNavigate(allowedEvent, rendererUrl);
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled();
    const deniedEvent = { preventDefault: vi.fn() };
    willNavigate(deniedEvent, 'https://penyerang.example/');
    expect(deniedEvent.preventDefault).toHaveBeenCalledTimes(1);

    expect(setWindowOpenHandler).toHaveBeenCalledTimes(1);
    expect(setWindowOpenHandler.mock.calls[0]?.[0]()).toEqual({
      action: 'deny',
    });

    const closed = windowOn.mock.calls.find(
      ([event]) => event === 'closed',
    )?.[1];
    expect(closed).toEqual(expect.any(Function));
    closed();
    expect(unregister).toHaveBeenCalledTimes(1);
  });
});
