export type PaymentKind = 'unclassified' | 'cash' | 'transfer' | 'credit';
export type NotaTransactionStatus = 'draft' | 'completed' | 'reopened' | 'cancelled';
export type NotaCompletionDestination = 'archive' | 'finished';
export type NotaPageStatus = 'active' | 'cancelled';
export type Unit = 'pcs' | 'lsn';

export interface Sku {
  id: string;
  skuNumber: string;
  aliases: string[];
  name: string;
  referencePrice: number;
  stock: number;
  tracked: boolean;
  note: string;
  imageUrl: string;
  imageHash?: string;
  sourceImageUrl?: string | null;
  sourceCreatedAt?: string;
  createdAt: string;
  archived: boolean;
}

export interface SkuAlias { skuId: string; value: string; createdAt: string; }

export interface StockAdjustment {
  id: string;
  skuId: string;
  quantity: number;
  before: number;
  after: number;
  createdAt: string;
  source: 'manual' | 'nota' | 'reversal';
}

export interface SkuPriceChange {
  id: string;
  skuId: string;
  before: number;
  after: number;
  createdAt: string;
}

export interface NotaLine {
  id: string;
  skuId?: string;
  description: string;
  kind: string;
  quantity: number;
  unit: Unit;
  pcsPrice: number;
  lsnPrice: number;
}

export interface Nota {
  id: string;
  suffix: string;
  status: NotaPageStatus;
  lines: NotaLine[];
}

export interface NotaTransaction {
  id: string;
  baseNumber: string;
  customerName: string;
  customerPlace: string;
  transactionDate: string;
  payment: PaymentKind;
  status: NotaTransactionStatus;
  completionDestination?: NotaCompletionDestination;
  completedAt?: string;
  nextNoteIndex: number;
  pages: Nota[];
  postedLines: NotaLine[];
  postedStockEffects: Record<string, number>;
  postedTrackedLineIds: Record<string, string>;
  cancelledFromStatus?: 'draft' | 'completed' | 'reopened';
}

export interface LabelTemplate {
  medium: 'thermal' | 'a4';
  widthMm: number;
  heightMm: number;
  columns: number;
  marginMm: number;
  gapMm: number;
  fontSize: number;
  alignment: 'left' | 'center' | 'right';
  fields: Array<'qr' | 'name' | 'sku' | 'price' | 'chu'>;
}

export type InvoiceElementId = 'logo' | 'address' | 'phone' | 'bank';

export interface InvoiceTemplate {
  widthMm: number;
  heightMm: number;
  fontSize: number;
  logoUrl: string;
  bankAccount: string;
  address: string;
  phone: string;
  elements: Array<{ id: InvoiceElementId; visible: boolean }>;
}

export interface RevenueReport {
  today: number;
  month: number;
  year: number;
  bySku: Array<{ skuId: string; name: string; units: number; revenue: number }>;
  byDay: Array<{ date: string; revenue: number }>;
}

export interface EmptyStockItem { sku: Sku; selected: boolean; }

export interface WorkbookImportResult {
  skus: Sku[];
  loaded: number;
  skipped: number;
  warnings: string[];
}

export interface DemoState {
  skus: Sku[];
  adjustments: StockAdjustment[];
  priceChanges: SkuPriceChange[];
  notaTransactions: NotaTransaction[];
  labelTemplate: LabelTemplate;
  invoiceTemplate: InvoiceTemplate;
  sourceLabel: string;
  importSummary?: Omit<WorkbookImportResult, 'skus'>;
}
