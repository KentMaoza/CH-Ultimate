import ExcelJS from 'exceljs';

import {
  buildOperationalDatasetPlan,
  type OperationalDataset,
  type OperationalFilters,
} from './operational-exports';
import type { DemoState } from './types';

const DATASETS: Array<{ dataset: OperationalDataset; sheet: string }> = [
  { dataset: 'sku-stock', sheet: 'SKU_Stok' },
  { dataset: 'stock-history', sheet: 'Riwayat_Stok' },
  { dataset: 'price-history', sheet: 'Riwayat_Harga' },
  { dataset: 'stock-checks', sheet: 'Cek_Stok' },
];

const COLUMN_WIDTHS: Record<OperationalDataset, number[]> = {
  'sku-stock': [28, 42, 14, 18, 12, 15, 48, 34, 18, 24],
  'stock-history': [24, 28, 42, 18, 14, 16, 14],
  'price-history': [24, 28, 42, 18, 18, 18],
  'stock-checks': [24, 24, 28, 42, 14, 14, 16, 14, 16, 24, 48],
};

const NUMBER_COLUMNS: Record<OperationalDataset, number[]> = {
  'sku-stock': [4, 5],
  'stock-history': [5, 6, 7],
  'price-history': [5, 6],
  'stock-checks': [5, 6, 7, 8],
};

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF111111' },
};

function formatHeader(row: ExcelJS.Row): void {
  row.height = 24;
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.eachCell((cell) => { cell.fill = HEADER_FILL; });
}

export async function createOperationalWorkbookBuffer(
  state: DemoState,
  filters: OperationalFilters,
  generatedDate: string,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CH Ultimate';
  workbook.created = new Date(`${generatedDate}T00:00:00+08:00`);
  const plans = DATASETS.map(({ dataset, sheet }) => ({
    plan: buildOperationalDatasetPlan(state, dataset, filters),
    sheet,
  }));

  const summary = workbook.addWorksheet('Ringkasan');
  summary.addRow(['Ekspor Data CH Ultimate', generatedDate]);
  summary.addRow(['Filter pencarian', filters.query]);
  summary.addRow(['Dari tanggal WITA', filters.from]);
  summary.addRow(['Sampai tanggal WITA', filters.to]);
  summary.addRow(['Status SKU', filters.status]);
  summary.addRow([]);
  summary.addRow(['Dataset', 'Baris cocok']);
  for (const { plan } of plans) summary.addRow([plan.title, plan.totalMatched]);
  summary.getColumn('A').width = 32;
  summary.getColumn('B').width = 24;
  summary.getCell('A1').font = { bold: true, size: 14 };
  summary.getCell('B1').font = { bold: true, size: 14 };
  summary.getRow(7).font = { bold: true };
  summary.getColumn('B').numFmt = '#,##0';

  for (const { plan, sheet: sheetName } of plans) {
    const sheet = workbook.addWorksheet(sheetName);
    sheet.addRow(plan.headers);
    for (const row of plan.rows) sheet.addRow(row.cells);
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: sheet.getRow(1).getCell(plan.headers.length).address };
    COLUMN_WIDTHS[plan.dataset].forEach((width, index) => {
      sheet.getColumn(index + 1).width = width;
    });
    NUMBER_COLUMNS[plan.dataset].forEach((column) => {
      sheet.getColumn(column).numFmt = '#,##0';
    });
    formatHeader(sheet.getRow(1));
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) row.eachCell((cell) => {
        cell.alignment = { vertical: 'top', wrapText: true };
      });
    });
  }
  return workbook.xlsx.writeBuffer();
}
