import { describe, expect, it } from 'vitest';

import {
  checkedPostingAdd,
  completionPosting,
  shouldReapplyPostingOnRestore,
  shouldReversePostingOnCancel,
  reversalPosting,
  restorePosting,
} from '../src/nota/posting.js';

describe('Nota posting effects', () => {
  it('aggregates tracked SKU quantities and revenue for first completion', () => {
    const posting = completionPosting(
      [
        { skuId: 'sku-a', quantityPcs: 12n, lineTotalRupiah: 120_000n },
        { skuId: 'sku-a', quantityPcs: 2n, lineTotalRupiah: 25_000n },
        { skuId: null, quantityPcs: 1n, lineTotalRupiah: 5_000n },
      ],
      null,
    );

    expect(posting).toEqual({
      amountRupiah: 150_000n,
      revenueDeltaRupiah: 150_000n,
      snapshotEffects: new Map([['sku-a', -14n]]),
      movementEffects: new Map([['sku-a', -14n]]),
    });
  });

  it('posts only the recompletion difference', () => {
    const posting = completionPosting(
      [
        { skuId: 'sku-a', quantityPcs: 10n, lineTotalRupiah: 100_000n },
        { skuId: 'sku-b', quantityPcs: 1n, lineTotalRupiah: 50_000n },
      ],
      {
        amountRupiah: 120_000n,
        stockEffects: new Map([['sku-a', -12n]]),
      },
    );

    expect(posting.revenueDeltaRupiah).toBe(30_000n);
    expect(posting.movementEffects).toEqual(
      new Map([
        ['sku-a', 2n],
        ['sku-b', -1n],
      ]),
    );
  });

  it('reverses and restores the immutable completion snapshot exactly', () => {
    const snapshot = {
      amountRupiah: 150_000n,
      stockEffects: new Map([
        ['sku-a', -14n],
        ['sku-b', -1n],
      ]),
    };
    expect(reversalPosting(snapshot)).toEqual({
      amountRupiah: -150_000n,
      revenueDeltaRupiah: -150_000n,
      snapshotEffects: new Map(),
      movementEffects: new Map([
        ['sku-a', 14n],
        ['sku-b', 1n],
      ]),
    });
    expect(restorePosting(snapshot)).toEqual({
      amountRupiah: 150_000n,
      revenueDeltaRupiah: 150_000n,
      snapshotEffects: snapshot.stockEffects,
      movementEffects: snapshot.stockEffects,
    });
  });

  it('reverses an active prior posting when cancelling reopened Nota and reapplies on restore', () => {
    expect(shouldReversePostingOnCancel('reopened')).toBe(true);
    expect(shouldReapplyPostingOnRestore('reopened')).toBe(true);
    expect(shouldReversePostingOnCancel('draft')).toBe(false);
    expect(shouldReapplyPostingOnRestore('draft')).toBe(false);
  });

  it('rejects a combined per-SKU quantity beyond the safe integer contract', () => {
    expect(() =>
      completionPosting(
        [
          {
            skuId: 'sku-a',
            quantityPcs: BigInt(Number.MAX_SAFE_INTEGER),
            lineTotalRupiah: 0n,
          },
          { skuId: 'sku-a', quantityPcs: 1n, lineTotalRupiah: 0n },
        ],
        null,
      ),
    ).toThrow('stock effect');
  });

  it('rejects aggregate revenue and resulting balance overflow', () => {
    expect(() =>
      completionPosting(
        [
          {
            skuId: null,
            quantityPcs: 1n,
            lineTotalRupiah: BigInt(Number.MAX_SAFE_INTEGER),
          },
          { skuId: null, quantityPcs: 1n, lineTotalRupiah: 1n },
        ],
        null,
      ),
    ).toThrow('Nota amount');
    expect(() =>
      checkedPostingAdd(
        BigInt(Number.MAX_SAFE_INTEGER),
        1n,
        'stock balance',
      ),
    ).toThrow('stock balance');
  });
});
