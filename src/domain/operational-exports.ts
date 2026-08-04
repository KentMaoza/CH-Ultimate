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
  const minimumRowHeight = 7;
  const lineHeight = 2.4;
  const cellPadding = 1;
  const tableWidth = plan.widthMm - (margin * 2);
  const columnCount = plan.headers.length + (hasImageColumn ? 1 : 0);
  const columnWidth = tableWidth / columnCount;
  const headers = hasImageColumn ? ['GAMBAR', ...plan.headers] : plan.headers;
  document.setFont('helvetica', 'bold');
  document.setFontSize(5.5);
  const headerLines = headers.map((header) =>
    document.splitTextToSize(header, columnWidth - (cellPadding * 2)) as string[],
  );
  const headerHeight = Math.max(
    minimumRowHeight,
    Math.max(...headerLines.map((lines) => lines.length)) * lineHeight +
      (cellPadding * 2),
  );
  document.setFont('helvetica', 'normal');
  document.setFontSize(5.25);
  const rowLayouts = plan.rows.map((row) => {
    const cells = row.cells.map((cell) =>
      document.splitTextToSize(
        pdfCell(cell),
        columnWidth - (cellPadding * 2),
      ) as string[],
    );
    const height = Math.max(
      minimumRowHeight,
      Math.max(1, ...cells.map((lines) => lines.length)) * lineHeight +
        (cellPadding * 2),
    );
    return {
      row,
      cells,
      height,
      lineCount: Math.max(1, ...cells.map((lines) => lines.length)),
    };
  });
  const tableTop = 19;
  const contentBottom = plan.heightMm - margin;
  const pageContentHeight = contentBottom - tableTop - headerHeight;
  const maximumLinesPerPage = Math.max(
    1,
    Math.floor(
      (pageContentHeight - (cellPadding * 2)) / lineHeight,
    ),
  );
  type PdfRowLayout = {
    row: OperationalExportRow;
    cells: string[][];
    height: number;
    showImage: boolean;
  };
  const pageRows: PdfRowLayout[][] = [[]];
  let nextY = tableTop + headerHeight;
  const startPage = () => {
    pageRows.push([]);
    nextY = tableTop + headerHeight;
  };
  for (const layout of rowLayouts) {
    const currentPage = pageRows.at(-1)!;
    if (layout.lineCount <= maximumLinesPerPage) {
      if (currentPage.length > 0 && nextY + layout.height > contentBottom) {
        startPage();
      }
      pageRows.at(-1)!.push({ ...layout, showImage: true });
      nextY += layout.height;
      continue;
    }
    if (currentPage.length > 0) startPage();
    for (
      let offset = 0;
      offset < layout.lineCount;
      offset += maximumLinesPerPage
    ) {
      const cells = layout.cells.map((lines) =>
        lines.slice(offset, offset + maximumLinesPerPage),
      );
      const height = Math.max(
        minimumRowHeight,
        Math.max(1, ...cells.map((lines) => lines.length)) * lineHeight +
          (cellPadding * 2),
      );
      if (pageRows.at(-1)!.length > 0 && nextY + height > contentBottom) {
        startPage();
      }
      pageRows.at(-1)!.push({
        row: layout.row,
        cells,
        height,
        showImage: offset === 0,
      });
      nextY += height;
    }
  }
  const pages = pageRows.length;

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

    let y = tableTop;
    document.setFillColor(25, 25, 25);
    document.rect(margin, y, tableWidth, headerHeight, 'F');
    document.setTextColor(255, 255, 255);
    document.setFont('helvetica', 'bold');
    document.setFontSize(5.5);
    headerLines.forEach((lines, index) => {
      lines.forEach((line, lineIndex) => {
        document.text(
          line,
          margin + (index * columnWidth) + cellPadding,
          y + cellPadding + lineHeight + (lineIndex * lineHeight),
        );
      });
    });
    y += headerHeight;

    for (const { row, cells, height, showImage } of pageRows[pageIndex]!) {
      document.setDrawColor(205, 205, 205);
      document.setTextColor(20, 20, 20);
      document.setFont('helvetica', 'normal');
      document.setFontSize(5.25);
      document.rect(margin, y, tableWidth, height);
      let offset = 0;
      if (hasImageColumn) {
        if (showImage) {
          const imageY = y + Math.max(0.75, (height - 5.5) / 2);
          if (row.thumbnailDataUrl) {
            try {
              document.addImage(row.thumbnailDataUrl, 'JPEG', margin + 1, imageY, 5.5, 5.5, undefined, 'FAST');
            } catch {
              document.text('CHU', margin + 1, y + cellPadding + lineHeight);
            }
          } else {
            document.text('CHU', margin + 1, y + cellPadding + lineHeight);
          }
        }
        offset = 1;
      }
      cells.forEach((lines, index) => {
        lines.forEach((line, lineIndex) => {
          document.text(
            line,
            margin + ((index + offset) * columnWidth) + cellPadding,
            y + cellPadding + lineHeight + (lineIndex * lineHeight),
          );
        });
      });
      y += height;
    }
  }

  return document.output('blob');
}
