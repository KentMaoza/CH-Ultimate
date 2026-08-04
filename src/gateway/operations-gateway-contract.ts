import type { DemoState, InvoiceTemplate, LabelTemplate, Nota, NotaCompletionDestination, NotaLine, NotaTransaction, Sku, WorkbookImportResult } from '../domain/types';

export type SyncPhase = 'demo' | 'unpaired' | 'connecting' | 'online' | 'offline' | 'syncing' | 'conflict' | 'revoked' | 'upgrade-required';

export interface ImagePrefetchSnapshot {
  phase: 'idle' | 'running' | 'paused' | 'complete';
  total: number;
  serverAvailable: number;
  cached: number;
  failed: number;
}

export interface SyncSnapshot {
  phase: SyncPhase;
  serverRevision: string;
  pendingCount: number;
  conflictCount: number;
  quarantinedCount?: number;
  lastSyncedAt?: string;
  message?: string;
  imagePrefetch?: ImagePrefetchSnapshot;
}

export interface SyncConflict {
  id: string;
  entityType: string;
  entityId: string;
  field?: string;
  base: unknown;
  mine: unknown;
  server: unknown;
}

export interface OperationsGatewayCapabilities {
  canResetDemoData: boolean;
  canImportInitialCatalogue: boolean;
  canStageInitialCatalogue: boolean;
  canManagePackageBarcodes: boolean;
}

export interface CataloguePriceMismatch {
  rowNumber: number;
  primarySku: string;
  modalPrice: number;
  salePrice: number;
  selectedPrice: number;
}

export interface CatalogueImportPreview {
  rowCount: number;
  imageJobCount: number;
  missingImageCount: number;
  priceMismatchCount: number;
  selectedPriceTotal: number;
  stockTotal: number;
  maximumCellTextLength: number;
  warnings: string[];
  priceMismatches: CataloguePriceMismatch[];
}

export interface CatalogueValidationResult {
  importId: string;
  workbookSha256: string;
  sourceFileName: string;
  status: 'staged' | 'committed';
  preview: CatalogueImportPreview;
  expiresAt: string;
  committedAt: string | null;
}

export interface CatalogueCommitReceipt {
  importId: string;
  workbookSha256: string;
  rowCount: number;
  imageJobCount: number;
  committedAt: string;
  replayed: boolean;
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

export interface OperationsGateway {
  readonly capabilities: OperationsGatewayCapabilities;
  getSnapshot(): DemoState;
  subscribe(listener: () => void): () => void;
  getSyncSnapshot(): SyncSnapshot;
  getConflicts(): SyncConflict[];
  subscribeSync(listener: () => void): () => void;
  isNotaLifecycleOnlineOnly(id: string): boolean;
  initialize(): Promise<void>;
  flushNota(id: string): Promise<void>;
  retryPending(): Promise<void>;
  resolveConflict(id: string, choice: 'mine' | 'server'): Promise<void>;
  createSku(input: CreateSkuInput): Promise<Sku>;
  updateSku(id: string, patch: Partial<Sku>): Promise<void>;
  adjustStock(id: string, quantity: number, reason?: string): Promise<void>;
  checkStock(id: string, countedQuantityPcs: number, note?: string): Promise<void>;
  registerPackageBarcode(id: string, identifierValue: string): Promise<void>;
  removePackageBarcode(identifierId: string): Promise<void>;
  reassignPackageBarcode(identifierId: string, skuId: string): Promise<void>;
  setArchived(id: string, archived: boolean): Promise<void>;
  validateInitialCatalogue(input: {
    fileName: string;
    workbookBase64: string;
  }): Promise<CatalogueValidationResult>;
  commitInitialCatalogue(
    importId: string,
  ): Promise<CatalogueCommitReceipt>;
  loadSkuImage(sku: Sku): Promise<string>;
  pauseImagePrefetch(): void;
  retryImagePrefetch(): void;
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
  reopenNotaTransaction(id: string): Promise<void>;
  cancelNotaTransaction(id: string): Promise<void>;
  restoreNotaTransaction(id: string): Promise<void>;
}
