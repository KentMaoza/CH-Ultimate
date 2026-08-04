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

  for (const { plan, sheet: sheetName } of plans) {
    const sheet = workbook.addWorksheet(sheetName);
    sheet.addRow(plan.headers);
    for (const row of plan.rows) sheet.addRow(row.cells);
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: sheet.getRow(1).getCell(plan.headers.length).address };
    sheet.columns.forEach((column) => { column.width = 18; });
  }
  return workbook.xlsx.writeBuffer();
}
