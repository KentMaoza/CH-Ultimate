import ExcelJS from 'exceljs';
import type { Sku, WorkbookImportResult } from './types';

function text(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('text' in value) return String(value.text ?? '');
    if ('result' in value) return String(value.result ?? '');
  }
  return String(value).trim();
}

function integer(value: ExcelJS.CellValue): number {
  const parsed = Number(text(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

export async function parseSkuWorkbook(buffer: ArrayBuffer | Uint8Array): Promise<WorkbookImportResult> {
  const workbook = new ExcelJS.Workbook();
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet('SKU') ?? workbook.worksheets[0];
  if (!sheet) throw new Error('Workbook tidak memiliki sheet SKU.');

  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, column) => headers.set(text(cell.value), column));
  const column = (name: string) => headers.get(name);
  const value = (row: ExcelJS.Row, name: string): ExcelJS.CellValue => {
    const index = column(name);
    return index ? row.getCell(index).value : null;
  };
  if (!column('Nomor SKU') || !column('Judul')) throw new Error('Kolom Nomor SKU dan Judul wajib tersedia.');

  const seen = new Set<string>();
  const skus: Sku[] = [];
  const warnings: string[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const skuNumber = text(row.getCell(column('Nomor SKU')!).value);
    const key = skuNumber.toLocaleLowerCase('id-ID');
    if (!skuNumber) { warnings.push(`Baris ${rowNumber}: Nomor SKU kosong.`); continue; }
    if (seen.has(key)) { warnings.push(`Baris ${rowNumber}: Nomor SKU duplikat ${skuNumber}.`); continue; }
    seen.add(key);
    skus.push({
      id: `import-${rowNumber}-${skuNumber.slice(0, 24)}`,
      skuNumber,
      aliases: [],
      name: text(row.getCell(column('Judul')!).value) || 'Tanpa nama',
      referencePrice: integer(value(row, 'Modal Referensi')),
      stock: integer(value(row, 'Semua Total Stok')),
      tracked: true,
      note: text(value(row, 'Catatan SKU Gudang')),
      imageUrl: text(value(row, 'Tautan Gambar')),
      createdAt: text(value(row, 'Waktu Dibuat')) || new Date(0).toISOString(),
      archived: false,
    });
  }
  return { skus, loaded: skus.length, skipped: warnings.length, warnings };
}
