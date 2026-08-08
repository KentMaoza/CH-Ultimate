import { describe, expect, it } from 'vitest';

import {
  reconcileCatalogue,
  type ExistingCatalogueRow,
} from '../src/catalogue/catalogue-reconciliation.js';
import type { CatalogueRow } from '../src/catalogue/workbook.js';

const skuA = '11111111-1111-4111-8111-111111111111';
const skuB = '22222222-2222-4222-8222-222222222222';
const identifierA = '33333333-3333-4333-8333-333333333333';
const identifierB = '44444444-4444-4444-8444-444444444444';

function source(overrides: Partial<CatalogueRow> = {}): CatalogueRow {
  return {
    rowNumber: 2,
    primarySku: 'SKU-A',
    productCode: '87000001',
    name: 'Produk A',
    selectedPrice: 15_000,
    stockPcs: 12,
    note: 'Rak A',
    imageSourceUrl: null,
    sourceCreatedAt: '2026-07-30 09:24',
    ...overrides,
  };
}

function existing(
  skuId: string,
  identifierId: string,
  identifierValue: string,
  archived = false,
  quantityPcs: unknown = '7',
  balanceRowVersion: unknown = '3',
): ExistingCatalogueRow {
  return {
    sku_id_hex: skuId.replaceAll('-', '').toUpperCase(),
    row_version: '2',
    balance_row_version: balanceRowVersion,
    quantity_pcs: quantityPcs,
    created_at: new Date('2026-07-29T02:00:00.000Z'),
    image_hash_hex: null,
    archived_at: archived ? new Date('2026-07-30T02:00:00.000Z') : null,
    identifier_id_hex: identifierId.replaceAll('-', '').toUpperCase(),
    identifier_value: identifierValue,
    identifier_created_at: new Date('2026-07-29T02:01:00.000Z'),
  };
}

function uuidSequence() {
  let counter = 5;
  return () => {
    const suffix = String(counter++).padStart(12, '0');
    return `55555555-5555-4555-8555-${suffix}`;
  };
}

describe('catalogue reconciliation', () => {
  it('rejects a workbook row whose identifiers point to different stored SKUs', () => {
    expect(() =>
      reconcileCatalogue(
        [source()],
        [
          existing(skuA, identifierA, 'SKU-A'),
          existing(skuB, identifierB, '87000001'),
        ],
        uuidSequence(),
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'CATALOGUE_IDENTITY_CONFLICT' }),
    );
  });

  it('rejects two workbook rows that resolve to the same stored SKU', () => {
    expect(() =>
      reconcileCatalogue(
        [source(), source({ rowNumber: 3 })],
        [
          existing(skuA, identifierA, 'SKU-A'),
          existing(skuA, identifierB, '87000001'),
        ],
        uuidSequence(),
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'CATALOGUE_IDENTITY_CONFLICT' }),
    );
  });

  it('preserves a matching SKU and creates only its missing desired identifier', () => {
    const result = reconcileCatalogue(
      [source()],
      [existing(skuA, identifierA, 'SKU-A')],
      uuidSequence(),
    );

    expect(result).toMatchObject({
      matchedExistingCount: 1,
      createdSkuCount: 0,
      untouchedExistingCount: 0,
    });
    expect(result.rows[0]).toMatchObject({
      skuId: skuA,
      primaryIdentifierId: identifierA,
      existingPrimaryIdentifier: true,
      existingProductIdentifier: false,
      existingSku: expect.objectContaining({ quantityPcs: '7' }),
    });
    expect(result.rows[0]?.productIdentifierId).not.toBe(identifierA);
  });

  it('retains unmatched archived SKUs and reports them for the audit receipt', () => {
    const result = reconcileCatalogue(
      [source()],
      [existing(skuB, identifierB, 'SKU-ARSIP', true)],
      uuidSequence(),
    );

    expect(result).toMatchObject({
      matchedExistingCount: 0,
      createdSkuCount: 1,
      untouchedExistingCount: 1,
    });
  });

  it('retains extra identifiers and unmatched active SKUs', () => {
    const legacyIdentifier = '66666666-6666-4666-8666-666666666666';
    const unmatchedIdentifier = '77777777-7777-4777-8777-777777777777';
    const result = reconcileCatalogue(
      [source()],
      [
        existing(skuA, identifierA, 'SKU-A', false, '7'),
        existing(skuA, legacyIdentifier, 'LEGACY-A', false, '7'),
        existing(skuB, unmatchedIdentifier, 'SKU-B', false, '3'),
      ],
      uuidSequence(),
    );

    expect(result).toMatchObject({
      matchedExistingCount: 1,
      createdSkuCount: 0,
      untouchedExistingCount: 1,
    });
    expect(result.rows[0]?.existingSku).toMatchObject({ quantityPcs: '7' });
  });

  it('fails closed when a matched SKU has no tracked balance', () => {
    expect(() =>
      reconcileCatalogue(
        [source()],
        [existing(skuA, identifierA, 'SKU-A', false, null, null)],
        uuidSequence(),
      ),
    ).toThrowError('Database returned an invalid matched SKU balance');
  });
});
