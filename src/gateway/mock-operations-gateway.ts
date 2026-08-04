import { createInitialState, reduceOperation, skuNumberExists } from '../domain/operations';
import {
  addNotaPage,
  cancelNotaPage,
  cancelNotaTransaction,
  completeNotaTransaction,
  createDraftNotaTransaction,
  deleteNotaLine,
  reopenNotaTransaction,
  restoreNotaPage,
  restoreNotaTransaction,
} from '../domain/nota';
import type { DemoState, InvoiceTemplate, LabelTemplate, Nota, NotaCompletionDestination, NotaLine, NotaTransaction, Sku, WorkbookImportResult } from '../domain/types';
import type { CreateSkuInput, OperationsGateway, OperationsGatewayCapabilities, SyncConflict, SyncSnapshot } from './operations-gateway-contract';

let sequence = 100;

export class MockOperationsGateway implements OperationsGateway {
  readonly capabilities: OperationsGatewayCapabilities = {
    canResetDemoData: true,
    canImportInitialCatalogue: true,
    canStageInitialCatalogue: false,
  };
  private readonly syncSnapshot: SyncSnapshot = {
    phase: 'demo',
    serverRevision: '0',
    pendingCount: 0,
    conflictCount: 0,
  };
  private state: DemoState;
  private listeners = new Set<() => void>();
  private syncListeners = new Set<() => void>();

  constructor(private readonly seedFactory: () => DemoState = () => this.seedState()) {
    this.state = this.seedFactory();
  }

  private seedState(): DemoState {
    const transaction = createDraftNotaTransaction(1);
    transaction.customerName = 'Amelia';
    transaction.customerPlace = 'Saibah';
    transaction.pages[0]!.lines[0] = {
      ...transaction.pages[0]!.lines[0]!, skuId: 'sku-1', description: 'Beras Hitam Premium 1 kg', kind: 'Pangan', quantity: 1, pcsPrice: 42_000,
    };
    transaction.pages[0]!.lines[1] = {
      ...transaction.pages[0]!.lines[1]!, description: 'Jasa bungkus', kind: 'Layanan', quantity: 1, pcsPrice: 5_000,
    };
    const second = addNotaPage({ ...createInitialState(), notaTransactions: [transaction] }, transaction.id).notaTransactions[0]!;
    return { ...createInitialState(), notaTransactions: [second] };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSyncSnapshot = () => this.syncSnapshot;
  getConflicts = (): SyncConflict[] => [];
  subscribeSync = (listener: () => void) => { this.syncListeners.add(listener); return () => this.syncListeners.delete(listener); };
  async initialize(): Promise<void> {}
  async flushNota(_id: string): Promise<void> {}
  async retryPending(): Promise<void> {}
  async resolveConflict(_id: string, _choice: 'mine' | 'server'): Promise<void> {}
  private publish(next: DemoState) { this.state = next; this.listeners.forEach((listener) => listener()); }

  async createSku(input: CreateSkuInput): Promise<Sku> {
    const skuNumber = input.skuNumber.trim();
    if (!skuNumber || !input.name.trim()) throw new Error('Nomor dan nama SKU wajib diisi.');
    if (skuNumberExists(this.state.skus, skuNumber)) throw new Error('Nomor SKU atau alias sudah digunakan.');
    if (!Number.isInteger(input.openingStock) || input.openingStock < 0) throw new Error('Stok awal harus bilangan bulat nol atau lebih.');
    const sku: Sku = {
      id: `sku-${Date.now()}-${sequence++}`,
      skuNumber,
      aliases: [],
      identifiers: [],
      name: input.name.trim(),
      referencePrice: Math.max(0, Math.round(input.referencePrice)),
      stock: input.openingStock,
      tracked: input.tracked,
      note: input.note?.trim() ?? '',
      imageUrl: input.imageUrl?.trim() ?? '',
      createdAt: new Date().toISOString(),
      archived: false,
    };
    this.publish(reduceOperation(this.state, { type: 'add-sku', sku }));
    return sku;
  }

  async updateSku(id: string, patch: Partial<Sku>): Promise<void> {
    if (patch.skuNumber && skuNumberExists(this.state.skus, patch.skuNumber, id)) throw new Error('Nomor SKU atau alias sudah digunakan.');
    if (patch.referencePrice !== undefined && (!Number.isFinite(patch.referencePrice) || patch.referencePrice < 0)) throw new Error('Harga referensi harus nol atau lebih.');
    const normalized = patch.referencePrice === undefined ? patch : { ...patch, referencePrice: Math.round(patch.referencePrice) };
    this.publish(reduceOperation(this.state, { type: 'update-sku', id, patch: normalized }));
  }
  async adjustStock(id: string, quantity: number): Promise<void> { this.publish(reduceOperation(this.state, { type: 'adjust-stock', id, quantity })); }
  async setArchived(id: string, archived: boolean): Promise<void> { this.publish(reduceOperation(this.state, { type: 'archive-sku', id, archived })); }
  async validateInitialCatalogue(): Promise<never> {
    throw new Error('Import bertahap hanya tersedia melalui CH Core.');
  }
  async commitInitialCatalogue(): Promise<never> {
    throw new Error('Import bertahap hanya tersedia melalui CH Core.');
  }
  async loadSkuImage(sku: Sku): Promise<string> { return sku.imageUrl; }
  async replaceFromWorkbook(result: WorkbookImportResult, sourceLabel: string): Promise<void> {
    this.publish(reduceOperation(this.state, { type: 'replace-skus', skus: result.skus, sourceLabel, importSummary: { loaded: result.loaded, skipped: result.skipped, warnings: result.warnings } }));
  }
  async reset(): Promise<void> { this.publish(this.seedFactory()); }
  async setLabelTemplate(template: LabelTemplate): Promise<void> { this.publish({ ...this.state, labelTemplate: template }); }
  async setInvoiceTemplate(template: InvoiceTemplate): Promise<void> { this.publish({ ...this.state, invoiceTemplate: template }); }
  async createNotaTransaction(): Promise<NotaTransaction> {
    const transaction = createDraftNotaTransaction(this.state.notaTransactions.length + 1);
    this.publish({ ...this.state, notaTransactions: [transaction, ...this.state.notaTransactions] });
    return transaction;
  }
  async addNotaPage(transactionId: string): Promise<Nota | undefined> {
    const before = this.state.notaTransactions.find((item) => item.id === transactionId)?.pages.length;
    this.publish(addNotaPage(this.state, transactionId));
    return this.state.notaTransactions.find((item) => item.id === transactionId)?.pages[before ?? -1];
  }
  async cancelNotaPage(transactionId: string, pageId: string): Promise<void> { this.publish(cancelNotaPage(this.state, transactionId, pageId)); }
  async restoreNotaPage(transactionId: string, pageId: string): Promise<void> { this.publish(restoreNotaPage(this.state, transactionId, pageId)); }
  async updateNotaTransaction(id: string, patch: Partial<Omit<NotaTransaction, 'id' | 'baseNumber' | 'status' | 'completionDestination' | 'completedAt' | 'nextNoteIndex' | 'pages' | 'postedLines' | 'postedStockEffects' | 'postedTrackedLineIds' | 'cancelledFromStatus'>>): Promise<void> {
    const transaction = this.state.notaTransactions.find((item) => item.id === id);
    if (!transaction || !['draft', 'reopened'].includes(transaction.status)) return;
    this.publish({ ...this.state, notaTransactions: this.state.notaTransactions.map((transaction) => transaction.id === id ? { ...transaction, ...patch } : transaction) });
  }
  async updateNotaLine(transactionId: string, pageId: string, lineId: string, patch: Partial<NotaLine>): Promise<void> {
    const transaction = this.state.notaTransactions.find((item) => item.id === transactionId);
    const page = transaction?.pages.find((item) => item.id === pageId);
    if (!transaction || !['draft', 'reopened'].includes(transaction.status) || page?.status !== 'active') return;
    this.publish({ ...this.state, notaTransactions: this.state.notaTransactions.map((transaction) => transaction.id === transactionId ? {
      ...transaction, pages: transaction.pages.map((page) => page.id === pageId ? { ...page, lines: page.lines.map((line) => line.id === lineId ? { ...line, ...patch } : line) } : page),
    } : transaction) });
  }
  async deleteNotaLine(transactionId: string, pageId: string, lineId: string): Promise<void> {
    this.publish(deleteNotaLine(this.state, transactionId, pageId, lineId));
  }
  async completeNotaTransaction(id: string, destination: NotaCompletionDestination = 'archive'): Promise<void> { this.publish(completeNotaTransaction(this.state, id, destination)); }
  async reopenNotaTransaction(id: string): Promise<void> { this.publish(reopenNotaTransaction(this.state, id)); }
  async cancelNotaTransaction(id: string): Promise<void> { this.publish(cancelNotaTransaction(this.state, id)); }
  async restoreNotaTransaction(id: string): Promise<void> { this.publish(restoreNotaTransaction(this.state, id)); }
}
