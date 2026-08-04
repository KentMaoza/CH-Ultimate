import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  assertSafeXlsxArchive,
  assertSafeXlsxPackage,
  parseCatalogueWorkbook,
} from '../src/catalogue/workbook.js';

const workbookPath = process.env.CH_CATALOGUE_ACCEPTANCE_XLSX;
const acceptance = workbookPath ? describe : describe.skip;

acceptance('approved catalogue workbook acceptance', () => {
  it('matches the independently inspected source identity and totals', async () => {
    const bytes = await readFile(workbookPath!);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'f1f4675327fac107ef9f78c114b8afe86389d5543b204540ed45e74f9b15e49c',
    );

    assertSafeXlsxArchive(bytes);
    await expect(
      assertSafeXlsxPackage(await JSZip.loadAsync(bytes)),
    ).resolves.toBeUndefined();
    const workbook = await parseCatalogueWorkbook(bytes);

    expect(workbook.preview).toMatchObject({
      rowCount: 3_144,
      imageJobCount: 2_786,
      missingImageCount: 358,
      priceMismatchCount: 3,
      selectedPriceTotal: 276_285_615,
      stockTotal: 3_988,
      maximumCellTextLength: 168,
    });
    expect(workbook.rows).toHaveLength(3_144);
    expect(workbook.rows.flatMap((row) => [row.primarySku, row.productCode]))
      .toHaveLength(6_288);
    expect(workbook.preview.priceMismatches.map((mismatch) => mismatch.rowNumber))
      .toEqual([1_018, 1_088, 1_180]);
    expect(workbook.preview.priceMismatches.map((mismatch) => mismatch.selectedPrice))
      .toEqual(workbook.preview.priceMismatches.map((mismatch) => mismatch.modalPrice));
    expect(
      workbook.rows.every(
        (row) => row.primarySku.length > 0 && row.productCode.length > 0,
      ),
    ).toBe(true);
  });
});
