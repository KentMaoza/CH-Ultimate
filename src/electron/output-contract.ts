export const CH_OUTPUT_IPC_CHANNELS = {
  print: 'ch-output:print',
  savePdf: 'ch-output:save-pdf',
  saveSpreadsheet: 'ch-output:save-spreadsheet',
} as const;

export type OutputDocumentKind =
  | 'nota'
  | 'invoice'
  | 'label'
  | 'barcode'
  | 'operational-data';

export interface PrintDocumentRequest {
  kind: OutputDocumentKind;
  widthMm: number;
  heightMm: number;
}

export interface SavePdfRequest extends PrintDocumentRequest {
  fileName: string;
}

export interface SaveSpreadsheetRequest {
  fileName: string;
  bytes: Uint8Array;
}

export type PrintDocumentResult = { status: 'printed' };
export type SavePdfResult = { status: 'saved' | 'cancelled' };
export type SaveSpreadsheetResult = { status: 'saved' | 'cancelled' };

export interface ChOutputBridge {
  printDocument(input: PrintDocumentRequest): Promise<PrintDocumentResult>;
  savePdf(input: SavePdfRequest): Promise<SavePdfResult>;
  saveSpreadsheet(input: SaveSpreadsheetRequest): Promise<SaveSpreadsheetResult>;
}

type BridgeInvoke = (channel: string, input: unknown) => Promise<unknown>;

export function createChOutputBridge(invoke: BridgeInvoke): ChOutputBridge {
  return {
    printDocument: (input) => invoke(
      CH_OUTPUT_IPC_CHANNELS.print,
      input,
    ) as Promise<PrintDocumentResult>,
    savePdf: (input) => invoke(
      CH_OUTPUT_IPC_CHANNELS.savePdf,
      input,
    ) as Promise<SavePdfResult>,
    saveSpreadsheet: (input) => invoke(
      CH_OUTPUT_IPC_CHANNELS.saveSpreadsheet,
      input,
    ) as Promise<SaveSpreadsheetResult>,
  };
}

export function createE2eChOutputBridge(): ChOutputBridge {
  return {
    printDocument: async () => ({ status: 'printed' }),
    savePdf: async () => ({ status: 'saved' }),
    saveSpreadsheet: async () => ({ status: 'saved' }),
  };
}
