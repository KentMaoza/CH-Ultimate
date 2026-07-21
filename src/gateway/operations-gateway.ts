import { createInitialState, reduceOperation, skuNumberExists } from '../domain/operations';
import { cancelNota, completeNota, createDraftNota, reopenNota, restoreNota } from '../domain/nota';
import type { DemoState, LabelTemplate, Nota, NotaLine, Sku, WorkbookImportResult } from '../domain/types';

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
  getSnapshot(): DemoState;
  subscribe(listener: () => void): () => void;
  createSku(input: CreateSkuInput): Promise<Sku>;
  updateSku(id: string, patch: Partial<Sku>): Promise<void>;
  adjustStock(id: string, quantity: number): Promise<void>;
  setArchived(id: string, archived: boolean): Promise<void>;
  replaceFromWorkbook(result: WorkbookImportResult, sourceLabel: string): Promise<void>;
  reset(): Promise<void>;
  setLabelTemplate(template: LabelTemplate): Promise<void>;
  createNota(): Promise<Nota>;
  updateNota(id: string, patch: Partial<Nota>): Promise<void>;
  updateNotaLine(notaId: string, lineId: string, patch: Partial<NotaLine>): Promise<void>;
  completeNota(id: string): Promise<void>;
  reopenNota(id: string): Promise<void>;
  cancelNota(id: string): Promise<void>;
  restoreNota(id: string): Promise<void>;
}

let sequence = 100;

export class MockOperationsGateway implements OperationsGateway {
  private state = { ...createInitialState(), notas: [createDraftNota(1)] };
  private listeners = new Set<() => void>();

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
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
    this.publish(reduceOperation(this.state, { type: 'update-sku', id, patch }));
  }
  async adjustStock(id: string, quantity: number): Promise<void> { this.publish(reduceOperation(this.state, { type: 'adjust-stock', id, quantity })); }
  async setArchived(id: string, archived: boolean): Promise<void> { this.publish(reduceOperation(this.state, { type: 'archive-sku', id, archived })); }
  async replaceFromWorkbook(result: WorkbookImportResult, sourceLabel: string): Promise<void> {
    this.publish(reduceOperation(this.state, { type: 'replace-skus', skus: result.skus, sourceLabel, importSummary: { loaded: result.loaded, skipped: result.skipped, warnings: result.warnings } }));
  }
  async reset(): Promise<void> { this.publish({ ...createInitialState(), notas: [createDraftNota(1)] }); }
  async setLabelTemplate(template: LabelTemplate): Promise<void> { this.publish({ ...this.state, labelTemplate: template }); }
  async createNota(): Promise<Nota> {
    const nota = createDraftNota(this.state.notas.length + 1);
    this.publish({ ...this.state, notas: [nota, ...this.state.notas] });
    return nota;
  }
  async updateNota(id: string, patch: Partial<Nota>): Promise<void> { this.publish({ ...this.state, notas: this.state.notas.map((nota) => nota.id === id ? { ...nota, ...patch } : nota) }); }
  async updateNotaLine(notaId: string, lineId: string, patch: Partial<NotaLine>): Promise<void> {
    this.publish({ ...this.state, notas: this.state.notas.map((nota) => nota.id === notaId ? { ...nota, lines: nota.lines.map((line) => line.id === lineId ? { ...line, ...patch } : line) } : nota) });
  }
  async completeNota(id: string): Promise<void> { this.publish(completeNota(this.state, id)); }
  async reopenNota(id: string): Promise<void> { this.publish(reopenNota(this.state, id)); }
  async cancelNota(id: string): Promise<void> { this.publish(cancelNota(this.state, id)); }
  async restoreNota(id: string): Promise<void> { this.publish(restoreNota(this.state, id)); }
}
