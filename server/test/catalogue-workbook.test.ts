import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  assertSafeXlsxArchive,
  CatalogueValidationError,
  parseCatalogueWorkbook,
} from '../src/catalogue/workbook.js';

async function catalogueFixture(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('SKU');
  sheet.addRow([
    'Nomor SKU',
    'Judul',
    'Modal Referensi',
    'Harga Jual Referensi',
    'Semua Total Stok',
    'Tautan Gambar',
    'Catatan SKU Gudang',
    'Kode Produk',
    'Waktu Dibuat',
  ]);
  sheet.addRow([
    'SKU-panjang-tetap-utuh',
    'Produk A',
    '12000',
    '15000',
    12,
    'https://res.bigseller.pro/a.jpg',
    'Rak A',
    '87000001',
    '2026-07-30 09:24',
  ]);
  sheet.addRow([
    'SKU-B',
    'Produk B',
    '8000',
    '0',
    -2,
    '',
    '',
    '87000002',
    '2026-07-30 09:25',
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('catalogue workbook mapping', () => {
  it('selects positive sale price, falls back to modal, and preserves aliases', async () => {
    const result = await parseCatalogueWorkbook(await catalogueFixture());

    expect(result.preview).toMatchObject({
      rowCount: 2,
      imageJobCount: 1,
      missingImageCount: 1,
      priceMismatchCount: 1,
      selectedPriceTotal: 23000,
      stockTotal: 10,
    });
    expect(result.rows).toEqual([
      expect.objectContaining({
        primarySku: 'SKU-panjang-tetap-utuh',
        productCode: '87000001',
        selectedPrice: 15000,
        stockPcs: 12,
        note: 'Rak A',
      }),
      expect.objectContaining({
        primarySku: 'SKU-B',
        productCode: '87000002',
        selectedPrice: 8000,
        stockPcs: -2,
      }),
    ]);
    expect(result.preview.priceMismatches).toEqual([
      {
        rowNumber: 2,
        primarySku: 'SKU-panjang-tetap-utuh',
        modalPrice: 12000,
        salePrice: 15000,
        selectedPrice: 15000,
      },
    ]);
  });

  it('rejects empty or duplicate primary SKUs and product codes', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('SKU');
    sheet.addRow([
      'Nomor SKU',
      'Judul',
      'Modal Referensi',
      'Harga Jual Referensi',
      'Semua Total Stok',
      'Tautan Gambar',
      'Catatan SKU Gudang',
      'Kode Produk',
      'Waktu Dibuat',
    ]);
    sheet.addRow(['SKU-A', 'A', 100, 0, 1, '', '', 'CODE-A', '2026-01-01']);
    sheet.addRow(['sku-a', 'B', 100, 0, 1, '', '', 'CODE-B', '2026-01-01']);

    await expect(
      parseCatalogueWorkbook(Buffer.from(await workbook.xlsx.writeBuffer())),
    ).rejects.toMatchObject({
      code: 'DUPLICATE_PRIMARY_SKU',
    });
  });

  it('rejects a product code that collides with its own primary SKU', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('SKU');
    sheet.addRow([
      'Nomor SKU',
      'Judul',
      'Modal Referensi',
      'Harga Jual Referensi',
      'Semua Total Stok',
      'Tautan Gambar',
      'Catatan SKU Gudang',
      'Kode Produk',
      'Waktu Dibuat',
    ]);
    sheet.addRow(['SKU-A', 'A', 100, 0, 1, '', '', 'sku-a', '2026-01-01']);

    await expect(
      parseCatalogueWorkbook(Buffer.from(await workbook.xlsx.writeBuffer())),
    ).rejects.toMatchObject({ code: 'DUPLICATE_IDENTIFIER' });
  });

  it('does not enqueue an otherwise approved image host on a custom port', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('SKU');
    sheet.addRow([
      'Nomor SKU',
      'Judul',
      'Modal Referensi',
      'Harga Jual Referensi',
      'Semua Total Stok',
      'Tautan Gambar',
      'Catatan SKU Gudang',
      'Kode Produk',
      'Waktu Dibuat',
    ]);
    sheet.addRow([
      'SKU-A',
      'A',
      100,
      0,
      1,
      'https://res.bigseller.pro:8443/a.png',
      '',
      'CODE-A',
      '2026-01-01',
    ]);

    const result = await parseCatalogueWorkbook(
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );
    expect(result.preview).toMatchObject({
      imageJobCount: 0,
      missingImageCount: 1,
    });
    expect(result.preview.warnings).toHaveLength(1);
  });

  it('rejects formulas and cell text beyond 16 KiB', async () => {
    const formulaWorkbook = new ExcelJS.Workbook();
    const formulaSheet = formulaWorkbook.addWorksheet('SKU');
    formulaSheet.addRow([
      'Nomor SKU',
      'Judul',
      'Modal Referensi',
      'Harga Jual Referensi',
      'Semua Total Stok',
      'Tautan Gambar',
      'Catatan SKU Gudang',
      'Kode Produk',
      'Waktu Dibuat',
    ]);
    formulaSheet.addRow([
      'SKU-A',
      'A',
      { formula: '1+1', result: 2 },
      0,
      1,
      '',
      '',
      'CODE-A',
      '2026-01-01',
    ]);
    await expect(
      parseCatalogueWorkbook(
        Buffer.from(await formulaWorkbook.xlsx.writeBuffer()),
      ),
    ).rejects.toMatchObject({ code: 'FORMULA_NOT_ALLOWED' });

    const longWorkbook = new ExcelJS.Workbook();
    const longSheet = longWorkbook.addWorksheet('SKU');
    longSheet.addRow(
      (formulaSheet.getRow(1).values as ExcelJS.CellValue[]).slice(1),
    );
    longSheet.addRow([
      'SKU-A',
      'X'.repeat(16 * 1024 + 1),
      100,
      0,
      1,
      '',
      '',
      'CODE-A',
      '2026-01-01',
    ]);
    await expect(
      parseCatalogueWorkbook(Buffer.from(await longWorkbook.xlsx.writeBuffer())),
    ).rejects.toMatchObject({ code: 'CELL_TEXT_TOO_LONG' });
  });
});

describe('catalogue XLSX archive preflight', () => {
  it('rejects files above 5 MiB and malformed ZIP data', () => {
    for (const bytes of [
      Buffer.alloc(5 * 1024 * 1024 + 1),
      Buffer.from('not-a-zip'),
    ]) {
      try {
        assertSafeXlsxArchive(bytes);
        throw new Error('expected archive rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(CatalogueValidationError);
        expect(error).toHaveProperty('code');
      }
    }
  });

  it('rejects macros, external links, and excessive ZIP expansion', async () => {
    const source = await catalogueFixture();

    const macro = await JSZip.loadAsync(source);
    macro.file('xl/vbaProject.bin', Buffer.from('macro'));
    const macroBytes = Buffer.from(
      await macro.generateAsync({ type: 'uint8array' }),
    );
    expect(() => assertSafeXlsxArchive(macroBytes)).toThrowError(
      expect.objectContaining({ code: 'XLSX_MACRO_NOT_ALLOWED' }),
    );

    const external = await JSZip.loadAsync(source);
    external.file(
      'xl/externalLinks/externalLink1.xml',
      '<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>',
    );
    const externalBytes = Buffer.from(
      await external.generateAsync({ type: 'uint8array' }),
    );
    expect(() => assertSafeXlsxArchive(externalBytes)).toThrowError(
      expect.objectContaining({ code: 'XLSX_EXTERNAL_LINK_NOT_ALLOWED' }),
    );

    const bomb = new JSZip();
    bomb.file('xl/worksheets/sheet1.xml', Buffer.alloc(65 * 1024 * 1024));
    const bombBytes = Buffer.from(
      await bomb.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
      }),
    );
    expect(() => assertSafeXlsxArchive(bombBytes)).toThrowError(
      expect.objectContaining({ code: 'XLSX_EXPANSION_TOO_LARGE' }),
    );
  });

  it('measures actual ZIP expansion instead of trusting a forged directory size', async () => {
    const archive = await JSZip.loadAsync(await catalogueFixture());
    archive.file('xl/media/disguised.bin', Buffer.alloc(65 * 1024 * 1024));
    const bytes = Buffer.from(
      await archive.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
      }),
    );
    const name = Buffer.from('xl/media/disguised.bin');
    let nameOffset = bytes.indexOf(name);
    while (
      nameOffset >= 0 &&
      (nameOffset < 46 ||
        bytes.readUInt32LE(nameOffset - 46) !== 0x02014b50)
    ) {
      nameOffset = bytes.indexOf(name, nameOffset + 1);
    }
    expect(nameOffset).toBeGreaterThan(46);
    const centralOffset = nameOffset - 46;
    expect(bytes.readUInt32LE(centralOffset)).toBe(0x02014b50);
    bytes.writeUInt32LE(1, centralOffset + 24);

    expect(() => assertSafeXlsxArchive(bytes)).toThrowError(
      expect.objectContaining({ code: 'XLSX_EXPANSION_TOO_LARGE' }),
    );
  });
});
