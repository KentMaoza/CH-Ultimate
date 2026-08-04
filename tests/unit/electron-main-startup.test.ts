import { afterEach, describe, expect, it, vi } from 'vitest';
import { pathToFileURL } from 'node:url';

afterEach(() => {
  vi.doUnmock('electron');
  vi.doUnmock('electron-squirrel-startup');
  vi.doUnmock('../../src/electron/core-credential-store');
  vi.doUnmock('../../src/electron/core-desktop-service');
  vi.doUnmock('../../src/electron/core-ipc');
  vi.doUnmock('../../src/electron/core-packaged-deployment');
  vi.unstubAllGlobals();
  delete process.env.CH_ULTIMATE_E2E_TEST_MOCK;
  vi.resetModules();
});

describe('Electron CH Core startup', () => {
  it('waits for app readiness and binds IPC to the created window', async () => {
    process.env.CH_ULTIMATE_E2E_TEST_MOCK = '1';
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
    const ensurePackagedCoreDeployment = vi.fn(async () => {
      callOrder.push('deployment');
      return '/private/ch-ultimate-user-data/ch-core-config.json';
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
    vi.doMock('../../src/electron/core-packaged-deployment', () => ({
      ensurePackagedCoreDeployment,
    }));
    vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined);
    vi.stubGlobal('MAIN_WINDOW_VITE_NAME', 'main_window');

    await import('../../src/main');

    expect(createCoreCredentialStore).not.toHaveBeenCalled();
    resolveReady();
    await vi.waitFor(() =>
      expect(registerCoreIpcHandlers).toHaveBeenCalledTimes(1),
    );

    expect(callOrder).toEqual([
      'window',
      'store',
      'deployment',
      'service',
      'register',
    ]);
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
    expect(ensurePackagedCoreDeployment).toHaveBeenCalledWith({
      resourcesPath: process.resourcesPath,
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
    expect(rendererUrl).not.toContain('ch-ultimate-e2e-test-mock');
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

  it('adds the locked test marker only for an unpackaged explicit E2E launch', async () => {
    process.env.CH_ULTIMATE_E2E_TEST_MOCK = '1';
    const webContentsOn = vi.fn();
    const windowInstance = {
      webContents: {
        mainFrame: {},
        on: webContentsOn,
        setWindowOpenHandler: vi.fn(),
      },
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn(),
    };
    const BrowserWindow = vi.fn(() => windowInstance);
    Object.assign(BrowserWindow, {
      getAllWindows: vi.fn(() => [windowInstance]),
    });
    const app = {
      isPackaged: false,
      getPath: vi.fn(() => '/private/ch-ultimate-e2e'),
      quit: vi.fn(),
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
    };
    const registerCoreIpcHandlers = vi.fn(() => vi.fn());

    vi.doMock('electron', () => ({
      app,
      BrowserWindow,
      ipcMain: {},
      safeStorage: {},
    }));
    vi.doMock('electron-squirrel-startup', () => ({ default: false }));
    vi.doMock('../../src/electron/core-credential-store', () => ({
      createCoreCredentialStore: vi.fn(() => ({})),
    }));
    vi.doMock('../../src/electron/core-desktop-service', () => ({
      createCoreDesktopService: vi.fn(async () => ({})),
    }));
    vi.doMock('../../src/electron/core-ipc', () => ({
      registerCoreIpcHandlers,
    }));
    vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined);
    vi.stubGlobal('MAIN_WINDOW_VITE_NAME', 'main_window');

    await import('../../src/main');
    await vi.waitFor(() =>
      expect(registerCoreIpcHandlers).toHaveBeenCalledTimes(1),
    );

    const rendererUrl = (
      registerCoreIpcHandlers.mock.calls[0] as unknown[] | undefined
    )?.[3] as string;
    expect(rendererUrl).toMatch(
      /^file:.*\?ch-ultimate-e2e-test-mock=1$/,
    );
    expect(windowInstance.loadURL).toHaveBeenCalledWith(rendererUrl);
    expect(windowInstance.loadFile).not.toHaveBeenCalled();

    const willNavigate = webContentsOn.mock.calls.find(
      ([event]) => event === 'will-navigate',
    )?.[1];
    const deniedEvent = { preventDefault: vi.fn() };
    willNavigate(
      deniedEvent,
      rendererUrl.replace('?ch-ultimate-e2e-test-mock=1', ''),
    );
    expect(deniedEvent.preventDefault).toHaveBeenCalledTimes(1);
  });
});
