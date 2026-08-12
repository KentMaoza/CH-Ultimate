import { describe, expect, it, vi } from 'vitest';

import {
  CH_CORE_IPC_CHANNELS,
  createChCoreBridge,
} from '../../src/electron/core-bridge-contract';
import { registerCoreIpcHandlers } from '../../src/electron/core-ipc';

describe('CH Core preload surface', () => {
  it('publishes the ten-method bridge without exposing raw Electron IPC', async () => {
    vi.resetModules();
    const exposeInMainWorld = vi.fn();
    const invoke = vi.fn().mockResolvedValue({ status: 'ok' });
    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: { invoke },
    }));

    await import('../../src/preload');

    expect(exposeInMainWorld).toHaveBeenCalledTimes(2);
    const [key, bridge] = exposeInMainWorld.mock.calls.find(
      ([surface]) => surface === 'chCore',
    )!;
    expect(key).toBe('chCore');
    expect(Object.keys(bridge).sort()).toEqual([
      'approveOwnerPairing',
      'claimPairing',
      'completePairing',
      'createOwnerPairing',
      'credentialStatus',
      'enrollOwner',
      'getOwnerPairing',
      'installationId',
      'request',
      'rotateToken',
    ]);
    expect(bridge).not.toHaveProperty('ipcRenderer');
    await bridge.credentialStatus();
    expect(invoke).toHaveBeenCalledWith(
      CH_CORE_IPC_CHANNELS.credentialStatus,
      undefined,
    );
    const [, outputBridge] = exposeInMainWorld.mock.calls.find(
      ([surface]) => surface === 'chOutput',
    )!;
    expect(Object.keys(outputBridge).sort()).toEqual([
      'printDocument',
      'saveCsv',
      'saveGeneratedPdf',
      'savePdf',
      'saveSpreadsheet',
    ]);

    vi.doUnmock('electron');
  });

  it('uses the locked E2E URL marker for a fake output bridge with no IPC calls', async () => {
    vi.resetModules();
    const exposeInMainWorld = vi.fn();
    const invoke = vi.fn();
    const originalUrl = globalThis.location.href;
    globalThis.history.replaceState({}, '', '?ch-ultimate-e2e-test-mock=1');
    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: { invoke },
    }));

    try {
      await import('../../src/preload');
      const [, outputBridge] = exposeInMainWorld.mock.calls.find(
        ([surface]) => surface === 'chOutput',
      )!;
      await expect(outputBridge.printDocument({ kind: 'nota', widthMm: 210, heightMm: 148 })).resolves.toEqual({ status: 'printed' });
      await expect(outputBridge.savePdf({ kind: 'nota', widthMm: 210, heightMm: 148, fileName: 'Nota.pdf' })).resolves.toEqual({ status: 'saved' });
      await expect(outputBridge.saveGeneratedPdf({
        fileName: 'CHU-Ekspor.pdf',
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
      })).resolves.toEqual({ status: 'saved' });
      await expect(outputBridge.saveSpreadsheet({
        fileName: 'CHU-Ekspor.xlsx',
        bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      })).resolves.toEqual({ status: 'saved' });
      await expect(outputBridge.saveCsv({
        fileName: 'CHU-Perubahan.csv',
        bytes: new TextEncoder().encode('SKU,Harga\r\nTEST,1000\r\n'),
      })).resolves.toEqual({ status: 'saved' });
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      globalThis.history.replaceState({}, '', originalUrl);
      vi.doUnmock('electron');
    }
  });

  it('exposes exactly ten narrow methods without raw IPC', async () => {
    const invoke = vi.fn().mockResolvedValue({ status: 'ok' });
    const bridge = createChCoreBridge(invoke);

    expect(Object.keys(bridge).sort()).toEqual([
      'approveOwnerPairing',
      'claimPairing',
      'completePairing',
      'createOwnerPairing',
      'credentialStatus',
      'enrollOwner',
      'getOwnerPairing',
      'installationId',
      'request',
      'rotateToken',
    ]);
    expect(bridge).not.toHaveProperty('invoke');
    expect(bridge).not.toHaveProperty('send');
    expect(bridge).not.toHaveProperty('ipcRenderer');

    await bridge.request({ method: 'GET', path: '/v1/bootstrap' });
    await bridge.installationId();
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
    await bridge.createOwnerPairing();
    await bridge.getOwnerPairing('33333333-3333-4333-8333-333333333333');
    await bridge.approveOwnerPairing(
      '33333333-3333-4333-8333-333333333333',
    );
    await bridge.rotateToken();

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      CH_CORE_IPC_CHANNELS.request,
      CH_CORE_IPC_CHANNELS.installationId,
      CH_CORE_IPC_CHANNELS.credentialStatus,
      CH_CORE_IPC_CHANNELS.enrollOwner,
      CH_CORE_IPC_CHANNELS.claimPairing,
      CH_CORE_IPC_CHANNELS.completePairing,
      CH_CORE_IPC_CHANNELS.createOwnerPairing,
      CH_CORE_IPC_CHANNELS.getOwnerPairing,
      CH_CORE_IPC_CHANNELS.approveOwnerPairing,
      CH_CORE_IPC_CHANNELS.rotateToken,
    ]);
  });
});

describe('CH Core main IPC registration', () => {
  const rendererUrl = 'file:///Applications/CH%20Ultimate/index.html';

  it('returns cleanup for the fixed handlers when the trusted window closes', () => {
    const removeHandler = vi.fn();
    const ipcMain = {
      handle: vi.fn(),
      removeHandler,
    };
    const service = {
      request: vi.fn(),
      installationId: vi.fn(),
      credentialStatus: vi.fn(),
      enrollOwner: vi.fn(),
      claimPairing: vi.fn(),
      completePairing: vi.fn(),
      createOwnerPairing: vi.fn(),
      getOwnerPairing: vi.fn(),
      approveOwnerPairing: vi.fn(),
      rotateToken: vi.fn(),
    };

    const unregister = registerCoreIpcHandlers(
      ipcMain,
      service,
      { mainFrame: { url: rendererUrl } },
      rendererUrl,
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
      installationId: vi.fn().mockResolvedValue(
        '10101010-1010-4010-8010-101010101010',
      ),
      credentialStatus: vi.fn().mockResolvedValue({
        production: true,
        configuration: 'ready',
        credential: 'paired',
      }),
      enrollOwner: vi.fn().mockResolvedValue({ status: 'paired' }),
      claimPairing: vi.fn().mockResolvedValue({ status: 'pending' }),
      completePairing: vi.fn().mockResolvedValue({ status: 'paired' }),
      createOwnerPairing: vi.fn().mockResolvedValue({ code: '12345678' }),
      getOwnerPairing: vi.fn().mockResolvedValue({ state: 'available' }),
      approveOwnerPairing: vi.fn().mockResolvedValue({ status: 'approved' }),
      rotateToken: vi.fn().mockResolvedValue({ status: 'rotated' }),
    };
    const mainFrame = { url: rendererUrl };
    const trustedSender = { mainFrame };

    registerCoreIpcHandlers(ipcMain, service, trustedSender, rendererUrl);

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
      installationId: vi.fn(),
      credentialStatus: vi.fn(),
      enrollOwner: vi.fn(),
      claimPairing: vi.fn(),
      completePairing: vi.fn(),
      createOwnerPairing: vi.fn(),
      getOwnerPairing: vi.fn(),
      approveOwnerPairing: vi.fn(),
      rotateToken: vi.fn(),
    };
    const trustedSender = { mainFrame: { url: rendererUrl } };
    registerCoreIpcHandlers(ipcMain, service, trustedSender, rendererUrl);

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

  it('rejects the trusted sender when its top frame URL is unexpected', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      },
    };
    const service = {
      request: vi.fn(),
      installationId: vi.fn(),
      credentialStatus: vi.fn(),
      enrollOwner: vi.fn(),
      claimPairing: vi.fn(),
      completePairing: vi.fn(),
      createOwnerPairing: vi.fn(),
      getOwnerPairing: vi.fn(),
      approveOwnerPairing: vi.fn(),
      rotateToken: vi.fn(),
    };
    const mainFrame = { url: 'https://penyerang.example/' };
    const trustedSender = { mainFrame };
    registerCoreIpcHandlers(ipcMain, service, trustedSender, rendererUrl);

    await expect(
      Promise.resolve().then(() =>
        handlers.get(CH_CORE_IPC_CHANNELS.credentialStatus)!({
          sender: trustedSender,
          senderFrame: mainFrame,
        }),
      ),
    ).rejects.toThrow('Akses CH Core tidak diizinkan.');
    expect(service.credentialStatus).not.toHaveBeenCalled();
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
      installationId: vi.fn(),
      credentialStatus: vi.fn(),
      enrollOwner: vi.fn(),
      claimPairing: vi.fn(),
      completePairing: vi.fn(),
      createOwnerPairing: vi.fn(),
      getOwnerPairing: vi.fn(),
      approveOwnerPairing: vi.fn(),
      rotateToken: vi.fn(),
    };
    const mainFrame = { url: rendererUrl };
    const trustedSender = { mainFrame };
    const event = { sender: trustedSender, senderFrame: mainFrame };
    registerCoreIpcHandlers(ipcMain, service, trustedSender, rendererUrl);

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
    for (const channel of [
      CH_CORE_IPC_CHANNELS.getOwnerPairing,
      CH_CORE_IPC_CHANNELS.approveOwnerPairing,
    ]) {
      for (const invalid of ['', 'not-a-uuid', { pairingId: 'private' }]) {
        await expect(
          Promise.resolve().then(() => handlers.get(channel)!(event, invalid)),
        ).rejects.toThrow('Permintaan CH Core tidak valid.');
      }
    }
    expect(service.enrollOwner).not.toHaveBeenCalled();
    expect(service.claimPairing).not.toHaveBeenCalled();
    expect(service.getOwnerPairing).not.toHaveBeenCalled();
    expect(service.approveOwnerPairing).not.toHaveBeenCalled();
  });
});
