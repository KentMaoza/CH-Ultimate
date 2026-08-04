import type { DemoState, Sku } from './types';

export type OperationalDataset =
  | 'sku-stock'
  | 'stock-history'
  | 'price-history'
  | 'stock-checks';

export interface OperationalFilters {
  query: string;
  from: string;
  to: string;
  status: 'active' | 'archived' | 'all';
}

export interface OperationalExportRow {
  id: string;
  skuId?: string;
  cells: Array<string | number>;
  thumbnailDataUrl?: string;
}

export interface OperationalDatasetPlan {
  dataset: OperationalDataset;
  title: string;
  headers: string[];
  rows: OperationalExportRow[];
  totalMatched: number;
}

export interface OperationalPdfPlan extends OperationalDatasetPlan {
  kind: 'operational-data';
  widthMm: 297;
  heightMm: 210;
  fileName: string;
  totalIncluded: number;
  generatedDate: string;
}

const DATASET_META: Record<OperationalDataset, { title: string; sheet: string; file: string }> = {
  'sku-stock': { title: 'SKU dan Stok Saat Ini', sheet: 'SKU_Stok', file: 'SKU-Stok' },
  'stock-history': { title: 'Riwayat Stok', sheet: 'Riwayat_Stok', file: 'Riwayat-Stok' },
  'price-history': { title: 'Riwayat Harga', sheet: 'Riwayat_Harga', file: 'Riwayat-Harga' },
  'stock-checks': { title: 'Cek Stok', sheet: 'Cek_Stok', file: 'Cek-Stok' },
};
const MAX_PDF_ROWS = 300;

function witaParts(value: string): { date: string; display: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '', display: value };
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  const display = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
  return { date: day, display: `${display} WITA` };
}

function imageMetadata(sku: Sku): [string, string, string] {
  const source = sku.sourceImageUrl || sku.imageUrl;
  if (/^https?:\/\//i.test(source)) {
    return [source, sku.imageHash ?? '', 'URL tersedia'];
  }
  if (/^(data:|blob:)/i.test(source)) {
    return ['', sku.imageHash ?? '', 'Biner dihilangkan'];
  }
  if (sku.imageHash) return ['', sku.imageHash, 'Hash tersimpan'];
  return ['', '', 'Tidak ada'];
}

function skuMatches(sku: Sku, filters: OperationalFilters): boolean {
  if (filters.status === 'active' && sku.archived) return false;
  if (filters.status === 'archived' && !sku.archived) return false;
  const query = filters.query.trim().toLocaleLowerCase('id-ID');
  return !query || [sku.skuNumber, sku.name, ...sku.aliases]
    .some((value) => value.toLocaleLowerCase('id-ID').includes(query));
}

function dateMatches(value: string, filters: OperationalFilters): boolean {
  const date = witaParts(value).date;
  return (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
}

function latestFirst<T extends { id: string }>(
  values: T[],
  date: (value: T) => string,
): T[] {
  return values.sort((left, right) => {
    const byDate = Date.parse(date(right)) - Date.parse(date(left));
    return byDate || left.id.localeCompare(right.id);
  });
}

export function buildOperationalDatasetPlan(
  state: DemoState,
  dataset: OperationalDataset,
  filters: OperationalFilters,
): OperationalDatasetPlan {
  const skuById = new Map(state.skus.map((sku) => [sku.id, sku]));
  const matchingSku = (skuId: string) => {
    const sku = skuById.get(skuId);
    return sku && skuMatches(sku, filters) ? sku : undefined;
  };
  let headers: string[];
  let rows: OperationalExportRow[];

  if (dataset === 'sku-stock') {
    headers = ['Nomor SKU', 'Nama SKU', 'Status', 'Harga Referensi', 'Stok PCS', 'Pelacakan', 'URL Gambar', 'Hash Gambar', 'Status Gambar', 'Dibuat WITA'];
    rows = state.skus
      .filter((sku) => skuMatches(sku, filters) && dateMatches(sku.createdAt, filters))
      .sort((left, right) => left.skuNumber.localeCompare(right.skuNumber, 'id-ID') || left.id.localeCompare(right.id))
      .map((sku) => {
        const [url, hash, status] = imageMetadata(sku);
        return {
          id: sku.id,
          skuId: sku.id,
          cells: [
            sku.skuNumber, sku.name, sku.archived ? 'Diarsipkan' : 'Aktif',
            sku.referencePrice, sku.stock, sku.tracked ? 'Dilacak' : 'Tidak dilacak',
            url, hash, status, witaParts(sku.createdAt).display,
          ],
        };
      });
  } else if (dataset === 'stock-history') {
    headers = ['Tanggal WITA', 'Nomor SKU', 'Nama SKU', 'Sumber', 'Sebelum PCS', 'Perubahan PCS', 'Sesudah PCS'];
    rows = latestFirst(
      state.adjustments.filter((item) => dateMatches(item.createdAt, filters)),
      (item) => item.createdAt,
    ).flatMap((item) => {
      const sku = matchingSku(item.skuId);
      return sku ? [{ id: item.id, skuId: sku.id, cells: [witaParts(item.createdAt).display, sku.skuNumber, sku.name, item.source, item.before, item.quantity, item.after] }] : [];
    });
  } else if (dataset === 'price-history') {
    headers = ['Tanggal WITA', 'Nomor SKU', 'Nama SKU', 'Sumber', 'Harga Sebelum', 'Harga Sesudah'];
    rows = latestFirst(
      state.priceChanges.filter((item) => dateMatches(item.createdAt, filters)),
      (item) => item.createdAt,
    ).flatMap((item) => {
      const sku = matchingSku(item.skuId);
      return sku ? [{ id: item.id, skuId: sku.id, cells: [witaParts(item.createdAt).display, sku.skuNumber, sku.name, item.source, item.before, item.after] }] : [];
    });
  } else {
    headers = ['Dihitung WITA', 'Diterapkan WITA', 'Nomor SKU', 'Nama SKU', 'Teramati PCS', 'Dihitung PCS', 'Stok Server PCS', 'Selisih PCS', 'Dipaksa Offline', 'Perangkat', 'Catatan'];
    rows = latestFirst(
      state.stockChecks.filter((item) => dateMatches(item.countedAt, filters)),
      (item) => item.countedAt,
    ).flatMap((item) => {
      const sku = matchingSku(item.skuId);
      return sku ? [{ id: item.id, skuId: sku.id, cells: [witaParts(item.countedAt).display, witaParts(item.appliedAt).display, sku.skuNumber, sku.name, item.observedQuantityPcs, item.countedQuantityPcs, item.serverQuantityBeforePcs, item.appliedDeltaPcs, item.forcedOffline ? 'Ya' : 'Tidak', item.deviceDisplayName, item.note ?? ''] }] : [];
    });
  }

  return {
    dataset,
    title: DATASET_META[dataset].title,
    headers,
    rows,
    totalMatched: rows.length,
  };
}

export function buildOperationalPdfPlan(
  state: DemoState,
  dataset: OperationalDataset,
  filters: OperationalFilters,
  generatedDate: string,
): OperationalPdfPlan {
  const selected = buildOperationalDatasetPlan(state, dataset, filters);
  const rows = selected.rows.slice(0, MAX_PDF_ROWS);
  return {
    ...selected,
    kind: 'operational-data',
    widthMm: 297,
    heightMm: 210,
    fileName: `CHU-Ekspor-${DATASET_META[dataset].file}-${generatedDate}.pdf`,
    rows,
    totalIncluded: rows.length,
    generatedDate,
  };
}

function pdfCell(value: string | number): string {
  return typeof value === 'number' ? new Intl.NumberFormat('id-ID').format(value) : value;
}

export async function createOperationalPdfBlob(plan: OperationalPdfPlan): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const document = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [plan.widthMm, plan.heightMm],
    compress: true,
  });
  const hasImageColumn = plan.dataset === 'sku-stock';
  const margin = 8;
  const rowHeight = 7;
  const tableWidth = plan.widthMm - (margin * 2);
  const columnCount = plan.headers.length + (hasImageColumn ? 1 : 0);
  const columnWidth = tableWidth / columnCount;
  const rowsPerPage = 21;
  const pages = Math.max(1, Math.ceil(plan.rows.length / rowsPerPage));

  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    if (pageIndex > 0) document.addPage([plan.widthMm, plan.heightMm], 'landscape');
    document.setFont('helvetica', 'bold');
    document.setFontSize(8);
    document.text('CHU · EKSPOR DATA', margin, 8);
    document.setFontSize(14);
    document.text(plan.title, margin, 14);
    document.setFont('helvetica', 'normal');
    document.setFontSize(7);
    document.text(`${plan.totalIncluded} dari ${plan.totalMatched} baris · ${plan.generatedDate}`, plan.widthMm - margin, 8, { align: 'right' });
    document.text(`Halaman ${pageIndex + 1}/${pages}`, plan.widthMm - margin, 14, { align: 'right' });

    const headers = hasImageColumn ? ['GAMBAR', ...plan.headers] : plan.headers;
    let y = 19;
    document.setFillColor(25, 25, 25);
    document.rect(margin, y, tableWidth, rowHeight, 'F');
    document.setTextColor(255, 255, 255);
    document.setFont('helvetica', 'bold');
    document.setFontSize(5.5);
    headers.forEach((header, index) => {
      document.text(header.slice(0, 22), margin + (index * columnWidth) + 1, y + 4.5, { maxWidth: columnWidth - 2 });
    });
    y += rowHeight;

    const pageRows = plan.rows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
    for (const row of pageRows) {
      document.setDrawColor(205, 205, 205);
      document.setTextColor(20, 20, 20);
      document.setFont('helvetica', 'normal');
      document.setFontSize(5.25);
      document.rect(margin, y, tableWidth, rowHeight);
      let offset = 0;
      if (hasImageColumn) {
        if (row.thumbnailDataUrl) {
          try {
            document.addImage(row.thumbnailDataUrl, 'JPEG', margin + 1, y + 0.75, 5.5, 5.5, undefined, 'FAST');
          } catch {
            document.text('CHU', margin + 1, y + 4.5);
          }
        } else {
          document.text('CHU', margin + 1, y + 4.5);
        }
        offset = 1;
      }
      row.cells.forEach((cell, index) => {
        const value = pdfCell(cell).replace(/\s+/g, ' ');
        document.text(value.slice(0, 48), margin + ((index + offset) * columnWidth) + 1, y + 4.5, { maxWidth: columnWidth - 2 });
      });
      y += rowHeight;
    }
  }

  return document.output('blob');
}
