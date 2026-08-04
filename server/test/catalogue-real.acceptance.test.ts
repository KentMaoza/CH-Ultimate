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
      '64fcb734d84462060f76fa7f27495ee1e2dff6201ad2d7a2d13d5c6c27923817',
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
      selectedPriceTotal: 276_267_011,
      stockTotal: 4_115,
      maximumCellTextLength: 168,
    });
    expect(workbook.rows).toHaveLength(3_144);
    expect(
      workbook.rows.every(
        (row) => row.primarySku.length > 0 && row.productCode.length > 0,
      ),
    ).toBe(true);
  });
});
