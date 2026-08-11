import { lineTotal } from './nota';
import type { OperationalPdfPlan } from './operational-exports';
import type { RestockRecommendationDocumentPlan } from './restock-recommendation-document';
import type {
  InvoiceTemplate,
  InvoiceElementId,
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

export type NotaDocumentColumnKey =
  | 'code'
  | 'description'
  | 'kind'
  | 'quantity'
  | 'unit'
  | 'pcsPrice'
  | 'lsnPrice'
  | 'total';

export interface NotaDocumentLayout {
  identity: Array<{
    id: InvoiceElementId;
    text: string;
    imageUrl?: string;
  }>;
  columns: Array<{
    key: NotaDocumentColumnKey;
    label: string;
    numeric: boolean;
  }>;
  pages: Array<{
    id: string;
    suffix: string;
    documentNumber: string;
    rows: Array<{
      id: string;
      cells: Record<NotaDocumentColumnKey, string | number>;
    }>;
    totals: Array<{ label: string; value: number }>;
  }>;
}

const NOTA_COLUMNS: NotaDocumentLayout['columns'] = [
  { key: 'code', label: 'NO', numeric: false },
  { key: 'description', label: 'NAMA BARANG', numeric: false },
  { key: 'kind', label: 'JENIS', numeric: false },
  { key: 'quantity', label: 'JUMLAH', numeric: true },
  { key: 'unit', label: 'PCS/LSN', numeric: false },
  { key: 'pcsPrice', label: 'HARGA PCS', numeric: true },
  { key: 'lsnPrice', label: 'HARGA LSN', numeric: true },
  { key: 'total', label: 'TOTAL', numeric: true },
];

export function buildNotaDocumentLayout(plan: NotaDocumentPlan): NotaDocumentLayout {
  const identityValues: Record<InvoiceElementId, NotaDocumentLayout['identity'][number]> = {
    logo: { id: 'logo', text: 'CHU', ...(plan.identity.logoUrl ? { imageUrl: plan.identity.logoUrl } : {}) },
    address: { id: 'address', text: plan.identity.address },
    phone: { id: 'phone', text: plan.identity.phone },
    bank: { id: 'bank', text: plan.identity.bankAccount },
  };

  return {
    identity: plan.identity.elements
      .filter((element) => element.visible)
      .map((element) => identityValues[element.id]),
    columns: NOTA_COLUMNS.map((column) => ({ ...column })),
    pages: plan.pages.map((page) => ({
      id: page.id,
      suffix: page.suffix,
      documentNumber: page.documentNumber,
      rows: page.rows.map((row) => ({
        id: row.line.id,
        cells: {
          code: row.code,
          description: row.line.description,
          kind: row.line.kind || '—',
          quantity: row.line.quantity,
          unit: row.line.unit.toUpperCase(),
          pcsPrice: row.line.pcsPrice,
          lsnPrice: row.line.lsnPrice,
          total: row.total,
        },
      })),
      totals: [
        { label: 'Total Nota', value: page.subtotalBeforeTax },
        { label: 'PPN 12%', value: page.tax },
        { label: 'Total Transaksi', value: page.total },
      ],
    })),
  };
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
  contentWidthMm: number;
  contentHeightMm: number;
  cardWidthMm: number;
  cardHeightMm: number;
  columns: number;
  cardsPerPage: number;
  pageCount: number;
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
  contentWidthMm: number;
  contentHeightMm: number;
  cardWidthMm: number;
  cardHeightMm: number;
  columns: number;
  cardsPerPage: number;
  pageCount: number;
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
  | OperationalPdfPlan
  | RestockRecommendationDocumentPlan;

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

function sheetLayout(template: LabelTemplate, itemCount: number) {
  if (template.medium === 'thermal') {
    return {
      widthMm: template.widthMm + (template.marginMm * 2),
      heightMm: template.heightMm + (template.marginMm * 2),
      contentWidthMm: template.widthMm,
      contentHeightMm: template.heightMm,
      columns: 1,
      cardsPerPage: 1,
      pageCount: itemCount,
    };
  }

  const widthMm = 210;
  const heightMm = 297;
  const contentWidthMm = widthMm - (template.marginMm * 2);
  const contentHeightMm = heightMm - (template.marginMm * 2);
  const rows = Math.max(1, Math.floor(
    (contentHeightMm + template.gapMm) / (template.heightMm + template.gapMm),
  ));
  const cardsPerPage = Math.max(1, template.columns * rows);
  return {
    widthMm,
    heightMm,
    contentWidthMm,
    contentHeightMm,
    columns: template.columns,
    cardsPerPage,
    pageCount: Math.ceil(itemCount / cardsPerPage),
  };
}

export function buildLabelDocumentPlan(
  sku: Sku,
  template: LabelTemplate,
  quantity: number,
): LabelDocumentPlan {
  const count = requireQuantity(quantity);
  return {
    kind: 'label',
    ...sheetLayout(template, count),
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
    ...sheetLayout(template, count),
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
