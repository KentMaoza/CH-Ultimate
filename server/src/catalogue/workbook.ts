import ExcelJS from 'exceljs';
import JSZip from 'jszip';

import {
  assertSafeXlsxArchive,
  CatalogueValidationError,
} from './xlsx-archive.js';

export {
  assertSafeXlsxArchive,
  CatalogueValidationError,
} from './xlsx-archive.js';

export interface CataloguePriceMismatch {
  rowNumber: number;
  primarySku: string;
  modalPrice: number;
  salePrice: number;
  selectedPrice: number;
}

export interface CatalogueRow {
  rowNumber: number;
  primarySku: string;
  productCode: string;
  name: string;
  selectedPrice: number;
  stockPcs: number;
  note: string;
  imageSourceUrl: string | null;
  sourceCreatedAt: string;
}

export interface CataloguePreview {
  rowCount: number;
  imageJobCount: number;
  missingImageCount: number;
  priceMismatchCount: number;
  selectedPriceTotal: number;
  stockTotal: number;
  maximumCellTextLength: number;
  warnings: string[];
  priceMismatches: CataloguePriceMismatch[];
}

export interface CatalogueWorkbook {
  rows: CatalogueRow[];
  preview: CataloguePreview;
}

const REQUIRED_COLUMNS = [
  'Nomor SKU',
  'Judul',
  'Modal Referensi',
  'Harga Jual Referensi',
  'Semua Total Stok',
  'Tautan Gambar',
  'Catatan SKU Gudang',
  'Kode Produk',
  'Waktu Dibuat',
] as const;
const MAX_DATA_ROWS = 10_000;
const MAX_CELL_TEXT_BYTES = 16 * 1024;

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'text' in value) {
    return String(value.text ?? '').trim();
  }
  return String(value).trim();
}

function integer(value: ExcelJS.CellValue): number {
  const parsed = Number(cellText(value).replace(/[^\d.-]/g, ''));
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function imageSource(value: string): string | null {
  if (value === '') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname.toLowerCase() === 'res.bigseller.pro' &&
      url.port === '' &&
      url.username === '' &&
      url.password === ''
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export async function parseCatalogueWorkbook(
  bytes: Uint8Array,
): Promise<CatalogueWorkbook> {
  const buffer = Buffer.from(bytes);
  assertSafeXlsxArchive(buffer);
  const archive = await JSZip.loadAsync(buffer);
  for (const [name, entry] of Object.entries(archive.files)) {
    if (!entry.dir && name.toLowerCase().endsWith('.rels')) {
      const relationships = await entry.async('string');
      if (/TargetMode\s*=\s*["']External["']/i.test(relationships)) {
        throw new CatalogueValidationError(
          'XLSX_EXTERNAL_LINK_NOT_ALLOWED',
          'Tautan eksternal XLSX tidak diizinkan.',
        );
      }
    }
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch (error) {
    if (error instanceof CatalogueValidationError) throw error;
    throw new CatalogueValidationError(
      'MALFORMED_XLSX',
      'Workbook XLSX tidak dapat dibaca.',
    );
  }
  const sheet = workbook.getWorksheet('SKU');
  if (!sheet) {
    throw new CatalogueValidationError(
      'MISSING_SKU_SHEET',
      'Workbook tidak memiliki sheet SKU.',
    );
  }
  if (sheet.rowCount - 1 > MAX_DATA_ROWS) {
    throw new CatalogueValidationError(
      'TOO_MANY_ROWS',
      'Workbook melebihi 10.000 baris data.',
    );
  }

  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, column) => {
    const header = cellText(cell.value);
    if (headers.has(header)) {
      throw new CatalogueValidationError(
        'DUPLICATE_COLUMN',
        `Kolom ${header} tercantum lebih dari sekali.`,
      );
    }
    headers.set(header, column);
  });
  for (const required of REQUIRED_COLUMNS) {
    if (!headers.has(required)) {
      throw new CatalogueValidationError(
        'MISSING_REQUIRED_COLUMN',
        `Kolom ${required} wajib tersedia.`,
      );
    }
  }
  const value = (row: ExcelJS.Row, name: (typeof REQUIRED_COLUMNS)[number]) =>
    row.getCell(headers.get(name)!).value;

  const rows: CatalogueRow[] = [];
  const warnings: string[] = [];
  const priceMismatches: CataloguePriceMismatch[] = [];
  let maximumCellTextLength = 0;

  for (const workbookSheet of workbook.worksheets) {
    workbookSheet.eachRow({ includeEmpty: true }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        if (
          cell.type === ExcelJS.ValueType.Formula ||
          (typeof cell.value === 'object' &&
            cell.value !== null &&
            ('formula' in cell.value || 'sharedFormula' in cell.value))
        ) {
          throw new CatalogueValidationError(
            'FORMULA_NOT_ALLOWED',
            `Formula tidak diizinkan pada ${workbookSheet.name}!${cell.address}.`,
          );
        }
        const content = cellText(cell.value);
        if (Buffer.byteLength(content, 'utf8') > MAX_CELL_TEXT_BYTES) {
          throw new CatalogueValidationError(
            'CELL_TEXT_TOO_LONG',
            `Teks sel ${workbookSheet.name}!${cell.address} melebihi 16 KiB.`,
          );
        }
        maximumCellTextLength = Math.max(
          maximumCellTextLength,
          content.length,
        );
      });
    });
  }

  const primarySkus = new Set<string>();
  const productCodes = new Set<string>();
  const identifiers = new Set<string>();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const source = sheet.getRow(rowNumber);
    const primarySku = cellText(value(source, 'Nomor SKU'));
    const productCode = cellText(value(source, 'Kode Produk'));
    if (primarySku === '') {
      throw new CatalogueValidationError(
        'EMPTY_PRIMARY_SKU',
        `Baris ${rowNumber}: Nomor SKU wajib diisi.`,
      );
    }
    if (productCode === '') {
      throw new CatalogueValidationError(
        'EMPTY_PRODUCT_CODE',
        `Baris ${rowNumber}: Kode Produk wajib diisi.`,
      );
    }
    const primaryKey = primarySku.toLocaleLowerCase('id-ID');
    const productKey = productCode.toLocaleLowerCase('id-ID');
    if (primarySkus.has(primaryKey)) {
      throw new CatalogueValidationError(
        'DUPLICATE_PRIMARY_SKU',
        `Baris ${rowNumber}: Nomor SKU duplikat.`,
      );
    }
    if (productCodes.has(productKey)) {
      throw new CatalogueValidationError(
        'DUPLICATE_PRODUCT_CODE',
        `Baris ${rowNumber}: Kode Produk duplikat.`,
      );
    }
    if (
      primaryKey === productKey ||
      identifiers.has(primaryKey) ||
      identifiers.has(productKey)
    ) {
      throw new CatalogueValidationError(
        'DUPLICATE_IDENTIFIER',
        `Baris ${rowNumber}: pengenal SKU duplikat.`,
      );
    }
    primarySkus.add(primaryKey);
    productCodes.add(productKey);
    identifiers.add(primaryKey);
    identifiers.add(productKey);
    const modalPrice = integer(value(source, 'Modal Referensi'));
    const salePrice = integer(value(source, 'Harga Jual Referensi'));
    const selectedPrice = salePrice > 0 ? salePrice : modalPrice;
    const rawImageSource = cellText(value(source, 'Tautan Gambar'));
    const validImageSource = imageSource(rawImageSource);
    if (rawImageSource !== '' && validImageSource === null) {
      warnings.push(`Baris ${rowNumber}: tautan gambar tidak didukung.`);
    }
    if (salePrice > 0 && modalPrice > 0 && salePrice !== modalPrice) {
      priceMismatches.push({
        rowNumber,
        primarySku,
        modalPrice,
        salePrice,
        selectedPrice,
      });
    }
    rows.push({
      rowNumber,
      primarySku,
      productCode,
      name: cellText(value(source, 'Judul')),
      selectedPrice,
      stockPcs: integer(value(source, 'Semua Total Stok')),
      note: cellText(value(source, 'Catatan SKU Gudang')),
      imageSourceUrl: validImageSource,
      sourceCreatedAt: cellText(value(source, 'Waktu Dibuat')),
    });
  }

  return {
    rows,
    preview: {
      rowCount: rows.length,
      imageJobCount: rows.filter((row) => row.imageSourceUrl !== null).length,
      missingImageCount: rows.filter((row) => row.imageSourceUrl === null).length,
      priceMismatchCount: priceMismatches.length,
      selectedPriceTotal: rows.reduce(
        (total, row) => total + row.selectedPrice,
        0,
      ),
      stockTotal: rows.reduce((total, row) => total + row.stockPcs, 0),
      maximumCellTextLength,
      warnings,
      priceMismatches,
    },
  };
}
