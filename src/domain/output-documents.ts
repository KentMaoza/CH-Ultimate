import { lineTotal } from './nota';
import type { OperationalPdfPlan } from './operational-exports';
import type {
  InvoiceTemplate,
  LabelTemplate,
  NotaLine,
  NotaTransaction,
  Sku,
} from './types';

export type NotaDocumentKind = 'nota' | 'invoice';
export type NotaPageScope = 'current' | 'all';

export interface NotaDocumentRow {
  code: string;
  line: NotaLine;
  total: number;
}

export interface NotaDocumentPage {
  id: string;
  suffix: string;
  documentNumber: string;
  rows: NotaDocumentRow[];
  total: number;
  tax: number;
  subtotalBeforeTax: number;
}

export interface NotaDocumentPlan {
  kind: NotaDocumentKind;
  widthMm: number;
  heightMm: number;
  fontSize: number;
  fileName: string;
  marker: 'DRAF' | null;
  customerName: string;
  customerPlace: string;
  transactionDate: string;
  payment: NotaTransaction['payment'];
  baseNumber: string;
  identity: Pick<InvoiceTemplate, 'logoUrl' | 'bankAccount' | 'address' | 'phone' | 'elements'>;
  pages: NotaDocumentPage[];
}

export interface ProductLabelItem {
  qrValue: string;
  productCode: string;
  name: string;
  referencePrice: number;
}

export interface LabelDocumentPlan {
  kind: 'label';
  widthMm: number;
  heightMm: number;
  cardWidthMm: number;
  cardHeightMm: number;
  columns: number;
  marginMm: number;
  gapMm: number;
  fontSize: number;
  alignment: LabelTemplate['alignment'];
  fields: LabelTemplate['fields'];
  fileName: string;
  items: ProductLabelItem[];
}

export interface BarcodeDocumentPlan {
  kind: 'barcode';
  widthMm: number;
  heightMm: number;
  cardWidthMm: number;
  cardHeightMm: number;
  columns: number;
  marginMm: number;
  gapMm: number;
  fontSize: number;
  fileName: string;
  items: Array<{ qrValue: string; productCode: string }>;
}

export type OutputDocumentPlan =
  | NotaDocumentPlan
  | LabelDocumentPlan
  | BarcodeDocumentPlan
  | OperationalPdfPlan;

function safeFilePart(value: string): string {
  return value
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'Dokumen';
}

function populated(line: NotaLine): boolean {
  return Boolean(
    line.skuId || line.description.trim() || line.kind.trim() ||
    line.quantity || line.pcsPrice || line.lsnPrice,
  );
}

export function buildNotaDocumentPlan(
  transaction: NotaTransaction,
  template: InvoiceTemplate,
  options: {
    kind: NotaDocumentKind;
    scope: NotaPageScope;
    currentPageId?: string;
  },
): NotaDocumentPlan {
  if (transaction.status === 'cancelled') {
    throw new Error('Transaksi yang dibatalkan tidak dapat dicetak.');
  }
  const active = transaction.pages.filter((page) => page.status === 'active');
  if (active.length === 0) throw new Error('Nota tidak memiliki halaman aktif.');
  const current = active.find((page) => page.id === options.currentPageId) ?? active[0]!;
  const selected = options.scope === 'all' ? active : [current];
  const pages = selected.map((page) => {
    const rows = page.lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => populated(line))
      .map(({ line, index }) => ({
        code: `${index + 1}${page.suffix}`,
        line,
        total: lineTotal(line),
      }));
    const total = rows.reduce((sum, row) => sum + row.total, 0);
    const tax = Math.round(total * 12 / 112);
    return {
      id: page.id,
      suffix: page.suffix,
      documentNumber: `${transaction.baseNumber}${page.suffix}`,
      rows,
      total,
      tax,
      subtotalBeforeTax: total - tax,
    };
  });
  const title = options.kind === 'nota' ? 'Nota' : 'Invoice';
  const scope = options.scope === 'all' ? 'Semua' : current.suffix;
  return {
    kind: options.kind,
    widthMm: template.widthMm,
    heightMm: template.heightMm,
    fontSize: template.fontSize,
    fileName: `CHU-${title}-${safeFilePart(transaction.baseNumber)}-${scope}.pdf`,
    marker: ['draft', 'reopened'].includes(transaction.status) ? 'DRAF' : null,
    customerName: transaction.customerName,
    customerPlace: transaction.customerPlace,
    transactionDate: transaction.transactionDate,
    payment: transaction.payment,
    baseNumber: transaction.baseNumber,
    identity: {
      logoUrl: template.logoUrl,
      bankAccount: template.bankAccount,
      address: template.address,
      phone: template.phone,
      elements: template.elements.map((element) => ({ ...element })),
    },
    pages,
  };
}

function requireQuantity(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) {
    throw new Error('Jumlah output tidak valid.');
  }
  return quantity;
}

function sheetLayout(template: LabelTemplate) {
  return template.medium === 'a4'
    ? { widthMm: 210, heightMm: 297, columns: template.columns }
    : { widthMm: template.widthMm, heightMm: template.heightMm, columns: 1 };
}

export function buildLabelDocumentPlan(
  sku: Sku,
  template: LabelTemplate,
  quantity: number,
): LabelDocumentPlan {
  const count = requireQuantity(quantity);
  return {
    kind: 'label',
    ...sheetLayout(template),
    cardWidthMm: template.widthMm,
    cardHeightMm: template.heightMm,
    marginMm: template.marginMm,
    gapMm: template.gapMm,
    fontSize: template.fontSize,
    alignment: template.alignment,
    fields: [...template.fields],
    fileName: `CHU-Label-${safeFilePart(sku.skuNumber)}-x${count}.pdf`,
    items: Array.from({ length: count }, () => ({
      qrValue: sku.skuNumber,
      productCode: sku.skuNumber,
      name: sku.name,
      referencePrice: sku.referencePrice,
    })),
  };
}

export function buildBarcodeDocumentPlan(
  sku: Sku,
  template: LabelTemplate,
  quantity: number,
): BarcodeDocumentPlan {
  const count = requireQuantity(quantity);
  return {
    kind: 'barcode',
    ...sheetLayout(template),
    cardWidthMm: template.widthMm,
    cardHeightMm: template.heightMm,
    marginMm: template.marginMm,
    gapMm: template.gapMm,
    fontSize: template.fontSize,
    fileName: `CHU-Barcode-${safeFilePart(sku.skuNumber)}-x${count}.pdf`,
    items: Array.from({ length: count }, () => ({
      qrValue: sku.skuNumber,
      productCode: sku.skuNumber,
    })),
  };
}
