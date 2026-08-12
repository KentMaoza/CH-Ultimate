import type {
  OutputDocumentKind,
  PrintDocumentRequest,
  SaveCsvRequest,
  SaveGeneratedPdfRequest,
  SavePdfRequest,
  SaveSpreadsheetRequest,
} from './output-contract';
import { CH_OUTPUT_IPC_CHANNELS } from './output-contract';

interface IpcMainPort {
  handle(
    channel: string,
    listener: (event: unknown, input?: unknown) => unknown,
  ): void;
  removeHandler?(channel: string): void;
}

interface TrustedWebContents {
  mainFrame?: { url?: string };
  print(
    options: {
      silent: false;
      printBackground: true;
      pageSize: 'A4' | { width: number; height: number };
      margins: { marginType: 'none' };
    },
    callback: (success: boolean, failureReason?: string) => void,
  ): void;
  printToPDF(options: {
    printBackground: true;
    pageSize: { width: number; height: number };
    margins: { top: 0; bottom: 0; left: 0; right: 0 };
  }): Promise<Uint8Array>;
}

interface IpcInvokeEvent {
  sender?: unknown;
  senderFrame?: { url?: string };
}

interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

interface OutputIpcOptions {
  ipcMain: IpcMainPort;
  webContents: TrustedWebContents;
  expectedRendererUrl: string;
  showSaveDialog(options: {
    title: string;
    defaultPath: string;
    filters: Array<{ name: string; extensions: string[] }>;
    properties: ['createDirectory', 'showOverwriteConfirmation'];
  }): Promise<SaveDialogResult>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  waitForPrintSpool?: () => Promise<void>;
}

const DOCUMENT_KINDS = new Set<OutputDocumentKind>([
  'nota',
  'invoice',
  'label',
  'barcode',
  'operational-data',
  'restock-recommendation',
]);
const MIN_PAGE_MM = 15;
const MAX_PAGE_MM = 420;
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_SPREADSHEET_BYTES = 100 * 1024 * 1024;
const MAX_CSV_BYTES = 25 * 1024 * 1024;
const PRINT_SPOOL_GRACE_MS = 3_000;

function waitForWindowsPrintSpool(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, PRINT_SPOOL_GRACE_MS));
}

const invalidRequest = (): never => {
  throw new Error('Permintaan output tidak valid.');
};

function exactKeys(input: object, expected: string[]): boolean {
  return Object.keys(input).sort().join(',') === expected.sort().join(',');
}

function validDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) &&
    value >= MIN_PAGE_MM && value <= MAX_PAGE_MM &&
    Number.isSafeInteger(Math.round(value * 1_000));
}

function parsePrintRequest(input: unknown): PrintDocumentRequest {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    !exactKeys(input, ['kind', 'widthMm', 'heightMm'])
  ) return invalidRequest();
  const kind = Reflect.get(input, 'kind');
  const widthMm = Reflect.get(input, 'widthMm');
  const heightMm = Reflect.get(input, 'heightMm');
  if (
    typeof kind !== 'string' ||
    !DOCUMENT_KINDS.has(kind as OutputDocumentKind) ||
    !validDimension(widthMm) ||
    !validDimension(heightMm)
  ) return invalidRequest();
  return { kind: kind as OutputDocumentKind, widthMm, heightMm };
}

function validPdfFileName(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 4 && value.length <= 120 &&
    !value.startsWith('.') &&
    /^[^\u0000-\u001f\\/:]+\.pdf$/i.test(value);
}

function parseSavePdfRequest(input: unknown): SavePdfRequest {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    !exactKeys(input, ['kind', 'widthMm', 'heightMm', 'fileName'])
  ) return invalidRequest();
  const print = parsePrintRequest({
    kind: Reflect.get(input, 'kind'),
    widthMm: Reflect.get(input, 'widthMm'),
    heightMm: Reflect.get(input, 'heightMm'),
  });
  const fileName = Reflect.get(input, 'fileName');
  if (!validPdfFileName(fileName)) return invalidRequest();
  return { ...print, fileName };
}

function parseSaveGeneratedPdfRequest(input: unknown): SaveGeneratedPdfRequest {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    !exactKeys(input, ['fileName', 'bytes'])
  ) return invalidRequest();
  const fileName = Reflect.get(input, 'fileName');
  const bytes = Reflect.get(input, 'bytes');
  if (!validPdfFileName(fileName) || !(bytes instanceof Uint8Array)) {
    return invalidRequest();
  }
  return { fileName, bytes };
}

function validSpreadsheetFileName(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 5 && value.length <= 120 &&
    !value.startsWith('.') &&
    /^[^\u0000-\u001f\\/:]+\.xlsx$/i.test(value);
}

function parseSaveSpreadsheetRequest(input: unknown): SaveSpreadsheetRequest {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    !exactKeys(input, ['fileName', 'bytes'])
  ) return invalidRequest();
  const fileName = Reflect.get(input, 'fileName');
  const bytes = Reflect.get(input, 'bytes');
  if (!validSpreadsheetFileName(fileName) || !(bytes instanceof Uint8Array)) {
    return invalidRequest();
  }
  return { fileName, bytes };
}

function parseSaveCsvRequest(input: unknown): SaveCsvRequest {
  if (
    typeof input !== 'object' || input === null || Array.isArray(input) ||
    !exactKeys(input, ['fileName', 'bytes'])
  ) return invalidRequest();
  const fileName = Reflect.get(input, 'fileName');
  const bytes = Reflect.get(input, 'bytes');
  if (
    typeof fileName !== 'string' || fileName.length <= 4 || fileName.length > 120 ||
    fileName.startsWith('.') || !/^[^\u0000-\u001f\\/:]+\.csv$/i.test(fileName) ||
    !(bytes instanceof Uint8Array)
  ) return invalidRequest();
  return { fileName, bytes };
}

function printPageSize(input: PrintDocumentRequest) {
  if (input.widthMm === 210 && input.heightMm === 297) return 'A4' as const;
  return {
    width: Math.round(input.widthMm * 1_000),
    height: Math.round(input.heightMm * 1_000),
  };
}

function pdfPageSize(input: PrintDocumentRequest) {
  return {
    width: input.widthMm / 25.4,
    height: input.heightMm / 25.4,
  };
}

function requirePdfBytes(value: Uint8Array): Uint8Array {
  if (
    value.byteLength < 5 ||
    value.byteLength > MAX_PDF_BYTES ||
    String.fromCharCode(...value.slice(0, 5)) !== '%PDF-'
  ) throw new Error('PDF tidak valid.');
  return value;
}

function requireSpreadsheetBytes(value: Uint8Array): Uint8Array {
  if (
    value.byteLength < 4 ||
    value.byteLength > MAX_SPREADSHEET_BYTES ||
    value[0] !== 0x50 || value[1] !== 0x4b ||
    value[2] !== 0x03 || value[3] !== 0x04
  ) throw new Error('XLSX tidak valid.');
  return value;
}

function requireCsvBytes(value: Uint8Array): Uint8Array {
  if (value.byteLength < 1 || value.byteLength > MAX_CSV_BYTES || value.includes(0)) {
    throw new Error('CSV tidak valid.');
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    throw new Error('CSV tidak valid.');
  }
  return value;
}

export function registerOutputIpcHandlers({
  ipcMain,
  webContents,
  expectedRendererUrl,
  showSaveDialog,
  writeFile,
  waitForPrintSpool = waitForWindowsPrintSpool,
}: OutputIpcOptions): () => void {
  let outputActive = false;
  const authorized = <T>(handler: (input: unknown) => Promise<T>) =>
    async (event: unknown, input?: unknown): Promise<T> => {
      const invokeEvent = event as IpcInvokeEvent;
      const trustedFrame = webContents.mainFrame;
      if (
        invokeEvent.sender !== webContents ||
        trustedFrame === undefined ||
        invokeEvent.senderFrame !== trustedFrame ||
        invokeEvent.senderFrame.url !== expectedRendererUrl
      ) throw new Error('Akses output tidak diizinkan.');
      if (outputActive) throw new Error('Output lain masih diproses.');
      outputActive = true;
      try {
        return await handler(input);
      } finally {
        outputActive = false;
      }
    };

  ipcMain.handle(CH_OUTPUT_IPC_CHANNELS.print, authorized(async (input) => {
    const request = parsePrintRequest(input);
    const result = await new Promise<{ status: 'printed' | 'cancelled' }>((resolve, reject) => {
      webContents.print({
        silent: false,
        printBackground: true,
        pageSize: printPageSize(request),
        margins: { marginType: 'none' },
      }, (success, reason) => {
        if (success) resolve({ status: 'printed' });
        else if (reason === 'Print job canceled') resolve({ status: 'cancelled' });
        else reject(new Error(reason || 'Dokumen tidak dapat dicetak.'));
      });
    });
    if (result.status === 'cancelled') return result;
    // Electron can report success before Windows has consumed the rendered
    // document. Keep the operation and its renderer host alive briefly.
    await waitForPrintSpool();
    return result;
  }));

  ipcMain.handle(CH_OUTPUT_IPC_CHANNELS.savePdf, authorized(async (input) => {
    const request = parseSavePdfRequest(input);
    const result = await showSaveDialog({
      title: 'Simpan PDF',
      defaultPath: request.fileName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { status: 'cancelled' as const };
    const bytes = requirePdfBytes(await webContents.printToPDF({
      printBackground: true,
      pageSize: pdfPageSize(request),
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    }));
    await writeFile(result.filePath, bytes);
    return { status: 'saved' as const };
  }));

  ipcMain.handle(CH_OUTPUT_IPC_CHANNELS.saveGeneratedPdf, authorized(async (input) => {
    const request = parseSaveGeneratedPdfRequest(input);
    const bytes = requirePdfBytes(request.bytes);
    const result = await showSaveDialog({
      title: 'Simpan PDF',
      defaultPath: request.fileName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { status: 'cancelled' as const };
    await writeFile(result.filePath, bytes);
    return { status: 'saved' as const };
  }));

  ipcMain.handle(CH_OUTPUT_IPC_CHANNELS.saveSpreadsheet, authorized(async (input) => {
    const request = parseSaveSpreadsheetRequest(input);
    const result = await showSaveDialog({
      title: 'Simpan XLSX',
      defaultPath: request.fileName,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { status: 'cancelled' as const };
    await writeFile(result.filePath, requireSpreadsheetBytes(request.bytes));
    return { status: 'saved' as const };
  }));

  ipcMain.handle(CH_OUTPUT_IPC_CHANNELS.saveCsv, authorized(async (input) => {
    const request = parseSaveCsvRequest(input);
    const bytes = requireCsvBytes(request.bytes);
    const result = await showSaveDialog({
      title: 'Simpan CSV',
      defaultPath: request.fileName,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { status: 'cancelled' as const };
    await writeFile(result.filePath, bytes);
    return { status: 'saved' as const };
  }));

  return () => {
    for (const channel of Object.values(CH_OUTPUT_IPC_CHANNELS)) {
      ipcMain.removeHandler?.(channel);
    }
  };
}
