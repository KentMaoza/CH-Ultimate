import type { DemoState, InvoiceTemplate, LabelTemplate, Nota, NotaCompletionDestination, NotaLine, NotaTransaction, Sku, WorkbookImportResult } from '../domain/types';

export type SyncPhase = 'demo' | 'unpaired' | 'connecting' | 'online' | 'offline' | 'syncing' | 'conflict' | 'revoked' | 'upgrade-required';

export interface SyncSnapshot {
  phase: SyncPhase;
  serverRevision: string;
  pendingCount: number;
  conflictCount: number;
  lastSyncedAt?: string;
  message?: string;
}

export interface OperationsGatewayCapabilities {
  canResetDemoData: boolean;
  canImportInitialCatalogue: boolean;
}

export interface CreateSkuInput {
  skuNumber: string;
  name: string;
  referencePrice: number;
  openingStock: number;
  tracked: boolean;
  note?: string;
  imageUrl?: string;
}

export interface NotaDesktopTransferResult {
  sent: boolean;
  reason?: string;
}

export interface OperationsGateway {
  readonly capabilities: OperationsGatewayCapabilities;
  getSnapshot(): DemoState;
  subscribe(listener: () => void): () => void;
  getSyncSnapshot(): SyncSnapshot;
  subscribeSync(listener: () => void): () => void;
  initialize(): Promise<void>;
  flushNota(id: string): Promise<void>;
  retryPending(): Promise<void>;
  resolveConflict(id: string, choice: 'mine' | 'server'): Promise<void>;
  createSku(input: CreateSkuInput): Promise<Sku>;
  updateSku(id: string, patch: Partial<Sku>): Promise<void>;
  adjustStock(id: string, quantity: number): Promise<void>;
  setArchived(id: string, archived: boolean): Promise<void>;
  replaceFromWorkbook(result: WorkbookImportResult, sourceLabel: string): Promise<void>;
  reset(): Promise<void>;
  setLabelTemplate(template: LabelTemplate): Promise<void>;
  setInvoiceTemplate(template: InvoiceTemplate): Promise<void>;
  createNotaTransaction(): Promise<NotaTransaction>;
  addNotaPage(transactionId: string): Promise<Nota | undefined>;
  cancelNotaPage(transactionId: string, pageId: string): Promise<void>;
  restoreNotaPage(transactionId: string, pageId: string): Promise<void>;
  updateNotaTransaction(id: string, patch: Partial<Omit<NotaTransaction, 'id' | 'baseNumber' | 'status' | 'completionDestination' | 'completedAt' | 'nextNoteIndex' | 'pages' | 'postedLines' | 'postedStockEffects' | 'postedTrackedLineIds' | 'cancelledFromStatus'>>): Promise<void>;
  updateNotaLine(transactionId: string, pageId: string, lineId: string, patch: Partial<NotaLine>): Promise<void>;
  deleteNotaLine(transactionId: string, pageId: string, lineId: string): Promise<void>;
  completeNotaTransaction(id: string, destination?: NotaCompletionDestination): Promise<void>;
  transferNotaToDesktop(id: string): Promise<NotaDesktopTransferResult>;
  reopenNotaTransaction(id: string): Promise<void>;
  cancelNotaTransaction(id: string): Promise<void>;
  restoreNotaTransaction(id: string): Promise<void>;
}
