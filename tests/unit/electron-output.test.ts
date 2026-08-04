import { describe, expect, it, vi } from 'vitest';

import {
  CH_OUTPUT_IPC_CHANNELS,
  createChOutputBridge,
} from '../../src/electron/output-contract';
import { registerOutputIpcHandlers } from '../../src/electron/output-ipc';

function harness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
    removeHandler: vi.fn(),
  };
  const mainFrame = { url: 'file:///Applications/CH%20Ultimate/index.html' };
  const print = vi.fn((_options, callback: (ok: boolean, reason?: string) => void) => callback(true));
  const printToPDF = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.7\ntrusted'));
  const webContents = { mainFrame, print, printToPDF };
  const showSaveDialog = vi.fn().mockResolvedValue({ canceled: false, filePath: '/chosen/Nota-A.pdf' });
  const writeFile = vi.fn().mockResolvedValue(undefined);
  const unregister = registerOutputIpcHandlers({
    ipcMain,
    webContents,
    expectedRendererUrl: mainFrame.url,
    showSaveDialog,
    writeFile,
  });
  const event = { sender: webContents, senderFrame: mainFrame };
  return { event, handlers, ipcMain, print, printToPDF, showSaveDialog, unregister, webContents, writeFile };
}

describe('CH output preload contract', () => {
  it('exposes only typed print and save-PDF methods', async () => {
    const invoke = vi.fn().mockResolvedValue({ status: 'printed' });
    const bridge = createChOutputBridge(invoke);

    expect(Object.keys(bridge).sort()).toEqual(['printDocument', 'savePdf']);
    expect(bridge).not.toHaveProperty('invoke');
    expect(bridge).not.toHaveProperty('print');
    expect(bridge).not.toHaveProperty('ipcRenderer');

    await bridge.printDocument({ kind: 'nota', widthMm: 210, heightMm: 148 });
    await bridge.savePdf({ kind: 'label', widthMm: 50, heightMm: 30, fileName: 'Label-BRS-108.pdf' });

    expect(invoke.mock.calls).toEqual([
      [CH_OUTPUT_IPC_CHANNELS.print, { kind: 'nota', widthMm: 210, heightMm: 148 }],
      [CH_OUTPUT_IPC_CHANNELS.savePdf, { kind: 'label', widthMm: 50, heightMm: 30, fileName: 'Label-BRS-108.pdf' }],
    ]);
  });
});

describe('CH output main boundary', () => {
  it('prints the trusted current contents through the visible system dialog', async () => {
    const { event, handlers, print } = harness();

    await expect(handlers.get(CH_OUTPUT_IPC_CHANNELS.print)!(event, {
      kind: 'invoice', widthMm: 190, heightMm: 120,
    })).resolves.toEqual({ status: 'printed' });

    expect(print).toHaveBeenCalledWith({
      silent: false,
      printBackground: true,
      pageSize: { width: 190_000, height: 120_000 },
    }, expect.any(Function));
  });

  it('rejects another frame and every renderer-controlled output escape hatch', async () => {
    const { event, handlers, print, webContents } = harness();
    const printHandler = handlers.get(CH_OUTPUT_IPC_CHANNELS.print)!;
    const saveHandler = handlers.get(CH_OUTPUT_IPC_CHANNELS.savePdf)!;

    await expect(printHandler({ sender: webContents, senderFrame: { url: event.senderFrame.url } }, {
      kind: 'nota', widthMm: 210, heightMm: 148,
    })).rejects.toThrow('Akses output tidak diizinkan.');

    for (const input of [
      { kind: 'nota', widthMm: 210, heightMm: 148, html: '<h1>raw</h1>' },
      { kind: 'nota', widthMm: 210, heightMm: 148, silent: true },
      { kind: 'nota', widthMm: 210, heightMm: 148, printerName: 'arbitrary' },
      { kind: 'nota', widthMm: 0, heightMm: 148 },
      { kind: 'unknown', widthMm: 210, heightMm: 148 },
    ]) {
      await expect(printHandler(event, input)).rejects.toThrow('Permintaan output tidak valid.');
    }
    await expect(saveHandler(event, {
      kind: 'nota', widthMm: 210, heightMm: 148, fileName: 'Nota.pdf', path: '/tmp/escape.pdf',
    })).rejects.toThrow('Permintaan output tidak valid.');
    expect(print).not.toHaveBeenCalled();
  });

  it('allows only one active native output operation', async () => {
    let finish!: (ok: boolean) => void;
    const { event, handlers, print } = harness();
    print.mockImplementation((_options, callback) => { finish = callback; });
    const printHandler = handlers.get(CH_OUTPUT_IPC_CHANNELS.print)!;
    const first = printHandler(event, { kind: 'nota', widthMm: 210, heightMm: 148 });

    await expect(printHandler(event, {
      kind: 'barcode', widthMm: 50, heightMm: 30,
    })).rejects.toThrow('Output lain masih diproses.');
    finish(true);
    await expect(first).resolves.toEqual({ status: 'printed' });
  });

  it('writes validated Electron PDF bytes only to the native dialog choice', async () => {
    const { event, handlers, printToPDF, showSaveDialog, writeFile } = harness();

    await expect(handlers.get(CH_OUTPUT_IPC_CHANNELS.savePdf)!(event, {
      kind: 'operational-data', widthMm: 210, heightMm: 297, fileName: 'CHU-SKU-Stok-2026-08-04.pdf',
    })).resolves.toEqual({ status: 'saved' });

    expect(printToPDF).toHaveBeenCalledWith({
      printBackground: true,
      pageSize: { width: 210 / 25.4, height: 297 / 25.4 },
    });
    expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: 'CHU-SKU-Stok-2026-08-04.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    }));
    expect(writeFile).toHaveBeenCalledWith('/chosen/Nota-A.pdf', Buffer.from('%PDF-1.7\ntrusted'));
  });

  it('does not write on cancel and rejects unsafe names or non-PDF output', async () => {
    const cancel = harness();
    cancel.showSaveDialog.mockResolvedValue({ canceled: true });
    await expect(cancel.handlers.get(CH_OUTPUT_IPC_CHANNELS.savePdf)!(cancel.event, {
      kind: 'nota', widthMm: 210, heightMm: 148, fileName: 'Nota-A.pdf',
    })).resolves.toEqual({ status: 'cancelled' });
    expect(cancel.writeFile).not.toHaveBeenCalled();

    const unsafe = harness();
    await expect(unsafe.handlers.get(CH_OUTPUT_IPC_CHANNELS.savePdf)!(unsafe.event, {
      kind: 'nota', widthMm: 210, heightMm: 148, fileName: '../Nota-A.pdf',
    })).rejects.toThrow('Permintaan output tidak valid.');
    unsafe.printToPDF.mockResolvedValue(Buffer.from('not a PDF'));
    await expect(unsafe.handlers.get(CH_OUTPUT_IPC_CHANNELS.savePdf)!(unsafe.event, {
      kind: 'nota', widthMm: 210, heightMm: 148, fileName: 'Nota-A.pdf',
    })).rejects.toThrow('PDF tidak valid.');
    expect(unsafe.writeFile).not.toHaveBeenCalled();
  });

  it('removes only its two fixed handlers on close', () => {
    const { ipcMain, unregister } = harness();
    unregister();
    expect(ipcMain.removeHandler.mock.calls.map(([channel]) => channel).sort()).toEqual(
      Object.values(CH_OUTPUT_IPC_CHANNELS).sort(),
    );
  });
});
