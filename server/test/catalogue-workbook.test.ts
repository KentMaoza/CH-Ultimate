import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  assertSafeXlsxArchive,
  assertSafeXlsxPackage,
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

async function workbookWithValue(
  column: number,
  value: ExcelJS.CellValue,
): Promise<Buffer> {
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
  const values: ExcelJS.CellValue[] = [
    'SKU-A',
    'Produk A',
    100,
    0,
    1,
    '',
    '',
    'CODE-A',
    '2026-07-30',
  ];
  values[column - 1] = value;
  sheet.addRow(values);
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

  it.each([
    ['trailing text', '12abc'],
    ['fractional text', '1.5'],
    ['fractional number', 1.5],
    ['unsafe number', Number.MAX_SAFE_INTEGER + 1],
    ['non-numeric text', 'seribu'],
  ])('rejects malformed integer input: %s', async (_label, value) => {
    await expect(workbookWithValue(3, value)).resolves.toBeInstanceOf(Buffer);
    await expect(
      parseCatalogueWorkbook(await workbookWithValue(3, value)),
    ).rejects.toMatchObject({ code: 'INVALID_INTEGER' });
  });

  it('rejects negative prices while preserving negative integer stock', async () => {
    await expect(
      parseCatalogueWorkbook(await workbookWithValue(3, -1)),
    ).rejects.toMatchObject({ code: 'NEGATIVE_PRICE' });

    const parsed = await parseCatalogueWorkbook(
      await workbookWithValue(5, -7),
    );
    expect(parsed.rows[0]?.stockPcs).toBe(-7);
    expect(parsed.preview.stockTotal).toBe(-7);

    const blankOptionalSale = await parseCatalogueWorkbook(
      await workbookWithValue(4, ''),
    );
    expect(blankOptionalSale.rows[0]?.selectedPrice).toBe(100);
  });

  it('rejects preview totals that overflow safe integers', async () => {
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
      Number.MAX_SAFE_INTEGER,
      0,
      1,
      '',
      '',
      'CODE-A',
      '2026-01-01',
    ]);
    sheet.addRow([
      'SKU-B',
      'B',
      Number.MAX_SAFE_INTEGER,
      0,
      1,
      '',
      '',
      'CODE-B',
      '2026-01-01',
    ]);

    await expect(
      parseCatalogueWorkbook(
        Buffer.from(await workbook.xlsx.writeBuffer()),
      ),
    ).rejects.toMatchObject({ code: 'NUMERIC_TOTAL_OVERFLOW' });
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

  it('preflights formulas and bounded worksheet XML before ExcelJS parses it', async () => {
    const formulaArchive = await JSZip.loadAsync(await workbookWithValue(3, {
      formula: '1+1',
      result: 2,
    }));
    await expect(assertSafeXlsxPackage(formulaArchive)).rejects.toMatchObject({
      code: 'FORMULA_NOT_ALLOWED',
    });

    const oversized = await JSZip.loadAsync(await catalogueFixture());
    oversized.file(
      'xl/worksheets/sheet1.xml',
      `<worksheet><sheetData>${' '.repeat(32 * 1024 * 1024)}</sheetData></worksheet>`,
    );
    await expect(assertSafeXlsxPackage(oversized)).rejects.toMatchObject({
      code: 'XLSX_WORKSHEET_TOO_LARGE',
    });
  });

  it('bounds sparse rows and workbook-wide rows and cells across every worksheet', async () => {
    const sparse = await JSZip.loadAsync(await catalogueFixture());
    const sparseSheet = await sparse
      .file('xl/worksheets/sheet1.xml')!
      .async('string');
    sparse.file(
      'xl/worksheets/sheet1.xml',
      sparseSheet
        .replace(/<row r="3"/, '<row r="1000001"')
        .replaceAll(/([A-Z]+)3/g, '$11000001'),
    );
    await expect(assertSafeXlsxPackage(sparse)).rejects.toMatchObject({
      code: 'XLSX_TOO_MANY_ROWS',
    });

    const manyRows = new ExcelJS.Workbook();
    for (const name of ['SKU', 'Lain']) {
      const sheet = manyRows.addWorksheet(name);
      for (let row = 0; row < 5_001; row += 1) sheet.addRow([row]);
    }
    const manyRowsArchive = await JSZip.loadAsync(
      Buffer.from(await manyRows.xlsx.writeBuffer()),
    );
    await expect(assertSafeXlsxPackage(manyRowsArchive)).rejects.toMatchObject({
      code: 'XLSX_TOO_MANY_ROWS',
    });

    const manyCells = await JSZip.loadAsync(await catalogueFixture());
    const cellSheet = await manyCells
      .file('xl/worksheets/sheet1.xml')!
      .async('string');
    manyCells.file(
      'xl/worksheets/sheet1.xml',
      cellSheet.replace(
        '</sheetData>',
        `<row r="4">${'<c r="A4"/>'.repeat(200_001)}</row></sheetData>`,
      ),
    );
    await expect(assertSafeXlsxPackage(manyCells)).rejects.toMatchObject({
      code: 'XLSX_TOO_MANY_CELLS',
    });
  });

  it('rejects macro and ActiveX types even when payload paths are custom', async () => {
    const contentTypeArchive = await JSZip.loadAsync(await catalogueFixture());
    contentTypeArchive.file('custom/payload.bin', Buffer.from('macro'));
    const contentTypes = await contentTypeArchive
      .file('[Content_Types].xml')!
      .async('string');
    contentTypeArchive.file(
      '[Content_Types].xml',
      contentTypes.replace(
        '</Types>',
        '<Override PartName="/custom/payload.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>',
      ),
    );
    await expect(
      assertSafeXlsxPackage(contentTypeArchive),
    ).rejects.toMatchObject({ code: 'XLSX_MACRO_NOT_ALLOWED' });

    const relationshipArchive = await JSZip.loadAsync(
      await catalogueFixture(),
    );
    relationshipArchive.file('custom/control.bin', Buffer.from('activex'));
    const relationships = await relationshipArchive
      .file('_rels/.rels')!
      .async('string');
    relationshipArchive.file(
      '_rels/.rels',
      relationships.replace(
        '</Relationships>',
        '<Relationship Id="hostile" Type="http://schemas.microsoft.com/office/2006/relationships/activeXControl" Target="custom/control.bin"/></Relationships>',
      ),
    );
    await expect(
      assertSafeXlsxPackage(relationshipArchive),
    ).rejects.toMatchObject({ code: 'XLSX_MACRO_NOT_ALLOWED' });
  });

  it('bounds decoded rich shared strings before ExcelJS parses them', async () => {
    const archive = await JSZip.loadAsync(await catalogueFixture());
    const sharedStrings = await archive
      .file('xl/sharedStrings.xml')!
      .async('string');
    archive.file(
      'xl/sharedStrings.xml',
      sharedStrings.replace(
        /<si>[\s\S]*?<\/si>/,
        `<si><r><t>${'A'.repeat(8_192)}</t></r><r><t>${'&amp;'.repeat(
          8_193,
        )}</t></r></si>`,
      ),
    );

    await expect(assertSafeXlsxPackage(archive)).rejects.toMatchObject({
      code: 'CELL_TEXT_TOO_LONG',
    });
  });

  it('aggregates rich shared-string fragments using decoded XML entity bytes', async () => {
    const archive = await JSZip.loadAsync(await catalogueFixture());
    const sharedStrings = await archive
      .file('xl/sharedStrings.xml')!
      .async('string');
    archive.file(
      'xl/sharedStrings.xml',
      sharedStrings.replace(
        /<si>[\s\S]*?<\/si>/,
        `<si><r><t>${'A'.repeat(8_192)}</t></r><r><t>${'&amp;'.repeat(
          8_192,
        )}</t></r></si>`,
      ),
    );

    await expect(assertSafeXlsxPackage(archive)).resolves.toBeUndefined();
  });

  it('rejects malformed shared-string XML and bounded compressed shared-string expansion', async () => {
    const malformed = await JSZip.loadAsync(await catalogueFixture());
    const sharedStrings = await malformed
      .file('xl/sharedStrings.xml')!
      .async('string');
    malformed.file(
      'xl/sharedStrings.xml',
      sharedStrings.replace(
        /<si>[\s\S]*?<\/si>/,
        '<si><r><t>&unknown;</t></r></si>',
      ),
    );
    await expect(assertSafeXlsxPackage(malformed)).rejects.toMatchObject({
      code: 'MALFORMED_XLSX',
    });

    const unbalanced = await JSZip.loadAsync(await catalogueFixture());
    const unbalancedStrings = await unbalanced
      .file('xl/sharedStrings.xml')!
      .async('string');
    unbalanced.file(
      'xl/sharedStrings.xml',
      unbalancedStrings.replace(
        /<si>[\s\S]*?<\/si>/,
        '<si><t>tidak lengkap</si>',
      ),
    );
    await expect(assertSafeXlsxPackage(unbalanced)).rejects.toMatchObject({
      code: 'MALFORMED_XLSX',
    });

    const mismatched = await JSZip.loadAsync(await catalogueFixture());
    const mismatchedStrings = await mismatched
      .file('xl/sharedStrings.xml')!
      .async('string');
    mismatched.file(
      'xl/sharedStrings.xml',
      mismatchedStrings.replace(
        /<si>[\s\S]*?<\/si>/,
        '<si><r><t>tidak lengkap</t></x></si>',
      ),
    );
    await expect(assertSafeXlsxPackage(mismatched)).rejects.toMatchObject({
      code: 'MALFORMED_XLSX',
    });

    const oversized = await JSZip.loadAsync(await catalogueFixture());
    oversized.file(
      'xl/sharedStrings.xml',
      `<sst><si><t>${' '.repeat(32 * 1024 * 1024)}</t></si></sst>`,
    );
    await expect(assertSafeXlsxPackage(oversized)).rejects.toMatchObject({
      code: 'XLSX_SHARED_STRINGS_TOO_LARGE',
    });
  });
});
