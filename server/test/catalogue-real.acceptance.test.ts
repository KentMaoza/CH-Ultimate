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
      'f18d41b93197a59be3b3b93c5b68ce841716f9eb91b5f0912a81c50470b07d78',
    );

    assertSafeXlsxArchive(bytes);
    await expect(
      assertSafeXlsxPackage(await JSZip.loadAsync(bytes)),
    ).resolves.toBeUndefined();
    const workbook = await parseCatalogueWorkbook(bytes);

    expect(workbook.preview).toMatchObject({
      rowCount: 3_172,
      imageJobCount: 2_788,
      missingImageCount: 384,
      priceMismatchCount: 3,
      selectedPriceTotal: 277_389_272,
      stockTotal: 4_411,
      maximumCellTextLength: 168,
    });
    expect(workbook.rows).toHaveLength(3_172);
    expect(workbook.rows.flatMap((row) => [row.primarySku, row.productCode]))
      .toHaveLength(6_344);
    expect(workbook.preview.priceMismatches.map((mismatch) => mismatch.rowNumber))
      .toEqual([1_126, 1_196, 1_288]);
    expect(workbook.preview.priceMismatches.map((mismatch) => mismatch.selectedPrice))
      .toEqual(workbook.preview.priceMismatches.map((mismatch) => mismatch.modalPrice));
    expect(
      workbook.rows.every(
        (row) => row.primarySku.length > 0 && row.productCode.length > 0,
      ),
    ).toBe(true);
  });
});
