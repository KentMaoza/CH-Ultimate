import { describe, expect, it } from 'vitest';

import { parseCatalogueCommitResult } from '../src/catalogue/catalogue-import-store.js';

const validResult = {
  importId: '11111111-1111-4111-8111-111111111111',
  workbookSha256: 'a'.repeat(64),
  rowCount: 3_172,
  imageJobCount: 2_788,
  matchedExistingCount: 1,
  createdSkuCount: 3_171,
  untouchedExistingCount: 4,
  stockAdjustedCount: 1,
  zeroDeltaMatchedCount: 0,
  committedAt: '2026-08-08T10:00:00.000Z',
  replayed: false,
};

describe('catalogue commit result parser', () => {
  it('round-trips all persisted reconciliation counters', () => {
    expect(parseCatalogueCommitResult(JSON.stringify(validResult))).toEqual(
      validResult,
    );
  });

  it.each([
    ['missing', undefined],
    ['negative', -1],
    ['fractional', 0.5],
  ])('rejects a %s reconciliation counter', (_label, value) => {
    const malformed = { ...validResult } as Record<string, unknown>;
    if (value === undefined) {
      delete malformed.stockAdjustedCount;
    } else {
      malformed.stockAdjustedCount = value;
    }

    expect(() => parseCatalogueCommitResult(malformed)).toThrow(
      'Database returned an invalid catalogue result',
    );
  });
});
