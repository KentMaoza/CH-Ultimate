import { describe, expect, it, vi } from 'vitest';

import {
  CH_OUTPUT_IPC_CHANNELS,
  createChOutputBridge,
} from '../../src/electron/output-contract';
import { registerOutputIpcHandlers } from '../../src/electron/output-ipc';

function harness(options: { waitForPrintSpool?: () => Promise<void> } = {}) {
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
  const waitForPrintSpool = options.waitForPrintSpool ?? vi.fn().mockResolvedValue(undefined);
  const unregister = registerOutputIpcHandlers({
    ipcMain,
    webContents,
    expectedRendererUrl: mainFrame.url,
    showSaveDialog,
    writeFile,
    waitForPrintSpool,
  });
  const event = { sender: webContents, senderFrame: mainFrame };
  return {
    event,
    handlers,
    ipcMain,
    print,
    printToPDF,
    showSaveDialog,
    unregister,
    waitForPrintSpool,
    webContents,
    writeFile,
  };
}

describe('CH output preload contract', () => {
  it('exposes only typed print and native-save methods', async () => {
    const invoke = vi.fn().mockResolvedValue({ status: 'printed' });
    const bridge = createChOutputBridge(invoke);

    expect(Object.keys(bridge).sort()).toEqual([
      'printDocument', 'saveGeneratedPdf', 'savePdf', 'saveSpreadsheet',
    ]);
    expect(bridge).not.toHaveProperty('invoke');
    expect(bridge).not.toHaveProperty('print');
    expect(bridge).not.toHaveProperty('ipcRenderer');

    await bridge.printDocument({ kind: 'nota', widthMm: 210, heightMm: 148 });
    await bridge.savePdf({ kind: 'label', widthMm: 50, heightMm: 30, fileName: 'Label-BRS-108.pdf' });
    await bridge.saveGeneratedPdf!({
      fileName: 'CHU-Ekspor.pdf',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    });
    await bridge.saveSpreadsheet({
      fileName: 'CHU-Ekspor.xlsx',
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    });

    expect(invoke.mock.calls).toEqual([
      [CH_OUTPUT_IPC_CHANNELS.print, { kind: 'nota', widthMm: 210, heightMm: 148 }],
      [CH_OUTPUT_IPC_CHANNELS.savePdf, { kind: 'label', widthMm: 50, heightMm: 30, fileName: 'Label-BRS-108.pdf' }],
      [CH_OUTPUT_IPC_CHANNELS.saveGeneratedPdf, {
        fileName: 'CHU-Ekspor.pdf',
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
      }],
      [CH_OUTPUT_IPC_CHANNELS.saveSpreadsheet, {
        fileName: 'CHU-Ekspor.xlsx',
        bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      }],
    ]);
  });
});

describe('CH output main boundary', () => {
  it('prints the trusted current contents through the visible system dialog', async () => {
    const { event, handlers, print, waitForPrintSpool } = harness();

    await expect(handlers.get(CH_OUTPUT_IPC_CHANNELS.print)!(event, {
      kind: 'invoice', widthMm: 190, heightMm: 120,
    })).resolves.toEqual({ status: 'printed' });

    expect(print).toHaveBeenCalledWith({
      silent: false,
      printBackground: true,
      pageSize: { width: 190_000, height: 120_000 },
      margins: { marginType: 'none' },
    }, expect.any(Function));
    expect(waitForPrintSpool).toHaveBeenCalledTimes(1);
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

  it('keeps native output locked while Windows consumes a successful print job', async () => {
    let releaseSpool!: () => void;
    const waitForPrintSpool = vi.fn(() => new Promise<void>((resolve) => {
      releaseSpool = resolve;
    }));
    const { event, handlers } = harness({ waitForPrintSpool });
    const printHandler = handlers.get(CH_OUTPUT_IPC_CHANNELS.print)!;
    const first = printHandler(event, { kind: 'nota', widthMm: 210, heightMm: 148 });

    await vi.waitFor(() => expect(waitForPrintSpool).toHaveBeenCalledTimes(1));
    await expect(printHandler(event, {
      kind: 'barcode', widthMm: 50, heightMm: 30,
    })).rejects.toThrow('Output lain masih diproses.');

    releaseSpool();
    await expect(first).resolves.toEqual({ status: 'printed' });
  });

  it('does not wait for the spooler when native printing fails', async () => {
    const { event, handlers, print, waitForPrintSpool } = harness();
    print.mockImplementation((_options, callback) => callback(false, 'Printer tidak tersedia'));

    await expect(handlers.get(CH_OUTPUT_IPC_CHANNELS.print)!(event, {
      kind: 'nota', widthMm: 210, heightMm: 148,
    })).rejects.toThrow('Printer tidak tersedia');
    expect(waitForPrintSpool).not.toHaveBeenCalled();
  });

  it('writes validated Electron PDF bytes only to the native dialog choice', async () => {
    const { event, handlers, printToPDF, showSaveDialog, writeFile } = harness();

    await expect(handlers.get(CH_OUTPUT_IPC_CHANNELS.savePdf)!(event, {
      kind: 'operational-data', widthMm: 210, heightMm: 297, fileName: 'CHU-SKU-Stok-2026-08-04.pdf',
    })).resolves.toEqual({ status: 'saved' });

    expect(printToPDF).toHaveBeenCalledWith({
      printBackground: true,
      pageSize: { width: 210 / 25.4, height: 297 / 25.4 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: 'CHU-SKU-Stok-2026-08-04.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    }));
    expect(writeFile).toHaveBeenCalledWith('/chosen/Nota-A.pdf', Buffer.from('%PDF-1.7\ntrusted'));
  });

  it('writes validated XLSX bytes only to the native dialog choice', async () => {
    const { event, handlers, showSaveDialog, writeFile } = harness();
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/chosen/CHU-Ekspor-Data.xlsx',
    });

    await expect(handlers.get(CH_OUTPUT_IPC_CHANNELS.saveSpreadsheet)!(event, {
      fileName: 'CHU-Ekspor-Data.xlsx',
      bytes,
    })).resolves.toEqual({ status: 'saved' });

    expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Simpan XLSX',
      defaultPath: 'CHU-Ekspor-Data.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    }));
    expect(writeFile).toHaveBeenCalledWith('/chosen/CHU-Ekspor-Data.xlsx', bytes);
  });

  it('writes validated generated PDF bytes only to the native dialog choice', async () => {
    const { event, handlers, showSaveDialog, writeFile } = harness();
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/chosen/CHU-Ekspor.pdf',
    });

    await expect(handlers.get(CH_OUTPUT_IPC_CHANNELS.saveGeneratedPdf)!(event, {
      fileName: 'CHU-Ekspor.pdf',
      bytes,
    })).resolves.toEqual({ status: 'saved' });

    expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Simpan PDF',
      defaultPath: 'CHU-Ekspor.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    }));
    expect(writeFile).toHaveBeenCalledWith('/chosen/CHU-Ekspor.pdf', bytes);
  });

  it('rejects unsafe generated PDF names and invalid generated PDF bytes', async () => {
    const unsafe = harness();
    const handler = unsafe.handlers.get(CH_OUTPUT_IPC_CHANNELS.saveGeneratedPdf)!;

    await expect(handler(unsafe.event, {
      fileName: '../CHU-Ekspor.pdf',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    })).rejects.toThrow('Permintaan output tidak valid.');
    await expect(handler(unsafe.event, {
      fileName: 'CHU-Ekspor.pdf',
      bytes: new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]),
    })).rejects.toThrow('PDF tidak valid.');

    expect(unsafe.showSaveDialog).not.toHaveBeenCalled();
    expect(unsafe.writeFile).not.toHaveBeenCalled();
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

  it('does not write cancelled, unsafe, or non-XLSX spreadsheet output', async () => {
    const cancel = harness();
    cancel.showSaveDialog.mockResolvedValue({ canceled: true });
    await expect(cancel.handlers.get(CH_OUTPUT_IPC_CHANNELS.saveSpreadsheet)!(cancel.event, {
      fileName: 'CHU-Ekspor.xlsx',
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    })).resolves.toEqual({ status: 'cancelled' });
    expect(cancel.writeFile).not.toHaveBeenCalled();

    const unsafe = harness();
    await expect(unsafe.handlers.get(CH_OUTPUT_IPC_CHANNELS.saveSpreadsheet)!(unsafe.event, {
      fileName: '../CHU-Ekspor.xlsx',
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    })).rejects.toThrow('Permintaan output tidak valid.');
    await expect(unsafe.handlers.get(CH_OUTPUT_IPC_CHANNELS.saveSpreadsheet)!(unsafe.event, {
      fileName: 'CHU-Ekspor.xlsx',
      bytes: new Uint8Array([0x00, 0x01, 0x02, 0x03]),
    })).rejects.toThrow('XLSX tidak valid.');
    expect(unsafe.writeFile).not.toHaveBeenCalled();
  });

  it('removes only its four fixed handlers on close', () => {
    const { ipcMain, unregister } = harness();
    unregister();
    expect(ipcMain.removeHandler.mock.calls.map(([channel]) => channel).sort()).toEqual(
      Object.values(CH_OUTPUT_IPC_CHANNELS).sort(),
    );
  });
});
