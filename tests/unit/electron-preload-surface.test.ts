import { describe, expect, it, vi } from 'vitest';

import {
  CH_CORE_IPC_CHANNELS,
  createChCoreBridge,
} from '../../src/electron/core-bridge-contract';
import { registerCoreIpcHandlers } from '../../src/electron/core-ipc';

describe('CH Core preload surface', () => {
  it('publishes the six-method bridge without exposing raw Electron IPC', async () => {
    vi.resetModules();
    const exposeInMainWorld = vi.fn();
    const invoke = vi.fn().mockResolvedValue({ status: 'ok' });
    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: { invoke },
    }));

    await import('../../src/preload');

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    const [key, bridge] = exposeInMainWorld.mock.calls[0]!;
    expect(key).toBe('chCore');
    expect(Object.keys(bridge).sort()).toEqual([
      'claimPairing',
      'completePairing',
      'credentialStatus',
      'enrollOwner',
      'request',
      'rotateToken',
    ]);
    expect(bridge).not.toHaveProperty('ipcRenderer');
    await bridge.credentialStatus();
    expect(invoke).toHaveBeenCalledWith(
      CH_CORE_IPC_CHANNELS.credentialStatus,
      undefined,
    );

    vi.doUnmock('electron');
  });

  it('exposes exactly six narrow methods without raw IPC', async () => {
    const invoke = vi.fn().mockResolvedValue({ status: 'ok' });
    const bridge = createChCoreBridge(invoke);

    expect(Object.keys(bridge).sort()).toEqual([
      'claimPairing',
      'completePairing',
      'credentialStatus',
      'enrollOwner',
      'request',
      'rotateToken',
    ]);
    expect(bridge).not.toHaveProperty('invoke');
    expect(bridge).not.toHaveProperty('send');
    expect(bridge).not.toHaveProperty('ipcRenderer');

    await bridge.request({ method: 'GET', path: '/v1/bootstrap' });
    await bridge.credentialStatus();
    await bridge.enrollOwner({
      mode: 'bootstrap',
      displayName: 'Mac Gudang',
      bootstrapSecret: 'setup-only',
    });
    await bridge.claimPairing({
      code: '12345678',
      displayName: 'Mac Gudang',
    });
    await bridge.completePairing();
    await bridge.rotateToken();

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      CH_CORE_IPC_CHANNELS.request,
      CH_CORE_IPC_CHANNELS.credentialStatus,
      CH_CORE_IPC_CHANNELS.enrollOwner,
      CH_CORE_IPC_CHANNELS.claimPairing,
      CH_CORE_IPC_CHANNELS.completePairing,
      CH_CORE_IPC_CHANNELS.rotateToken,
    ]);
  });
});

describe('CH Core main IPC registration', () => {
  it('returns cleanup for the fixed handlers when the trusted window closes', () => {
    const removeHandler = vi.fn();
    const ipcMain = {
      handle: vi.fn(),
      removeHandler,
    };
    const service = {
      request: vi.fn(),
      credentialStatus: vi.fn(),
      enrollOwner: vi.fn(),
      claimPairing: vi.fn(),
      completePairing: vi.fn(),
      rotateToken: vi.fn(),
    };

    const unregister = registerCoreIpcHandlers(
      ipcMain,
      service,
      { mainFrame: {} },
    );
    unregister();

    expect(removeHandler.mock.calls.map(([channel]) => channel).sort()).toEqual(
      Object.values(CH_CORE_IPC_CHANNELS).sort(),
    );
  });

  it('registers only the fixed bridge channels', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, handler);
        },
      ),
    };
    const service = {
      request: vi.fn().mockResolvedValue({ status: 200, body: {} }),
      credentialStatus: vi.fn().mockResolvedValue({
        production: true,
        configuration: 'ready',
        credential: 'paired',
      }),
      enrollOwner: vi.fn().mockResolvedValue({ status: 'paired' }),
      claimPairing: vi.fn().mockResolvedValue({ status: 'pending' }),
      completePairing: vi.fn().mockResolvedValue({ status: 'paired' }),
      rotateToken: vi.fn().mockResolvedValue({ status: 'rotated' }),
    };
    const mainFrame = {};
    const trustedSender = { mainFrame };

    registerCoreIpcHandlers(ipcMain, service, trustedSender);

    expect([...handlers.keys()].sort()).toEqual(
      Object.values(CH_CORE_IPC_CHANNELS).sort(),
    );
    await handlers.get(CH_CORE_IPC_CHANNELS.request)?.(
      { sender: trustedSender, senderFrame: mainFrame },
      { method: 'GET', path: '/v1/bootstrap' },
    );
    expect(service.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/v1/bootstrap',
    });
  });

  it('rejects another sender before touching the service', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      },
    };
    const service = {
      request: vi.fn(),
      credentialStatus: vi.fn(),
      enrollOwner: vi.fn(),
      claimPairing: vi.fn(),
      completePairing: vi.fn(),
      rotateToken: vi.fn(),
    };
    const trustedSender = { mainFrame: {} };
    registerCoreIpcHandlers(ipcMain, service, trustedSender);

    await expect(
      Promise.resolve().then(() =>
        handlers.get(CH_CORE_IPC_CHANNELS.request)!(
          { sender: { mainFrame: {} }, senderFrame: {} },
          { method: 'GET', path: '/v1/bootstrap' },
        ),
      ),
    ).rejects.toThrow('Akses CH Core tidak diizinkan.');
    expect(service.request).not.toHaveBeenCalled();

    await expect(
      Promise.resolve().then(() =>
        handlers.get(CH_CORE_IPC_CHANNELS.credentialStatus)!({
          sender: trustedSender,
          senderFrame: {},
        }),
      ),
    ).rejects.toThrow('Akses CH Core tidak diizinkan.');
    expect(service.credentialStatus).not.toHaveBeenCalled();

    await expect(
      Promise.resolve().then(() =>
        handlers.get(CH_CORE_IPC_CHANNELS.credentialStatus)!({
          sender: trustedSender,
        }),
      ),
    ).rejects.toThrow('Akses CH Core tidak diizinkan.');
  });

  it('rejects malformed identity input before calling the credential service', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      },
    };
    const service = {
      request: vi.fn(),
      credentialStatus: vi.fn(),
      enrollOwner: vi.fn(),
      claimPairing: vi.fn(),
      completePairing: vi.fn(),
      rotateToken: vi.fn(),
    };
    const mainFrame = {};
    const trustedSender = { mainFrame };
    const event = { sender: trustedSender, senderFrame: mainFrame };
    registerCoreIpcHandlers(ipcMain, service, trustedSender);

    await expect(
      Promise.resolve().then(() =>
        handlers.get(CH_CORE_IPC_CHANNELS.enrollOwner)!(event, {
          mode: 'bootstrap',
          displayName: 17,
          bootstrapSecret: ['not-a-string'],
          deviceToken: 'renderer-secret',
        }),
      ),
    ).rejects.toThrow('Permintaan CH Core tidak valid.');
    await expect(
      Promise.resolve().then(() =>
        handlers.get(CH_CORE_IPC_CHANNELS.claimPairing)!(event, {
          code: '1234',
          displayName: 'Mac Gudang',
          claimSecret: 'renderer-secret',
        }),
      ),
    ).rejects.toThrow('Permintaan CH Core tidak valid.');
    expect(service.enrollOwner).not.toHaveBeenCalled();
    expect(service.claimPairing).not.toHaveBeenCalled();
  });
});
