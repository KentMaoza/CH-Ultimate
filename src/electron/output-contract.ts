export const CH_OUTPUT_IPC_CHANNELS = {
  print: 'ch-output:print',
  savePdf: 'ch-output:save-pdf',
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

export type PrintDocumentResult = { status: 'printed' };
export type SavePdfResult = { status: 'saved' | 'cancelled' };

export interface ChOutputBridge {
  printDocument(input: PrintDocumentRequest): Promise<PrintDocumentResult>;
  savePdf(input: SavePdfRequest): Promise<SavePdfResult>;
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
  };
}

export function createE2eChOutputBridge(): ChOutputBridge {
  return {
    printDocument: async () => ({ status: 'printed' }),
    savePdf: async () => ({ status: 'saved' }),
  };
}
