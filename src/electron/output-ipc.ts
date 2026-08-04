import type {
  OutputDocumentKind,
  PrintDocumentRequest,
  SavePdfRequest,
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
      pageSize: { width: number; height: number };
    },
    callback: (success: boolean, failureReason?: string) => void,
  ): void;
  printToPDF(options: {
    printBackground: true;
    pageSize: { width: number; height: number };
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
}

const DOCUMENT_KINDS = new Set<OutputDocumentKind>([
  'nota',
  'invoice',
  'label',
  'barcode',
  'operational-data',
]);
const MIN_PAGE_MM = 15;
const MAX_PAGE_MM = 420;
const MAX_PDF_BYTES = 100 * 1024 * 1024;

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

function printPageSize(input: PrintDocumentRequest) {
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

export function registerOutputIpcHandlers({
  ipcMain,
  webContents,
  expectedRendererUrl,
  showSaveDialog,
  writeFile,
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
    await new Promise<void>((resolve, reject) => {
      webContents.print({
        silent: false,
        printBackground: true,
        pageSize: printPageSize(request),
      }, (success, reason) => {
        if (success) resolve();
        else reject(new Error(reason || 'Dokumen tidak dapat dicetak.'));
      });
    });
    return { status: 'printed' as const };
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
    }));
    await writeFile(result.filePath, bytes);
    return { status: 'saved' as const };
  }));

  return () => {
    for (const channel of Object.values(CH_OUTPUT_IPC_CHANNELS)) {
      ipcMain.removeHandler?.(channel);
    }
  };
}
