import { describe, expect, test } from 'vitest';
import { createInitialState } from '../../src/domain/operations';
import { createDraftNotaTransaction } from '../../src/domain/nota';
import { buildSkuSalesHistory } from '../../src/domain/sku-sales-history';
import type { DemoState, NotaLine, NotaPosting, RevenuePosting } from '../../src/domain/types';

const SKU_ID = 'sku-1';

function line(id: string, quantity: number): NotaLine {
  return {
    id,
    skuId: SKU_ID,
    description: 'Barang uji',
    kind: 'Uji',
    quantity,
    unit: 'pcs',
    pcsPrice: 10_000,
    lsnPrice: 120_000,
  };
}

function lifecyclePosting(input: {
  id: string;
  notaId: string;
  kind: string;
  quantity: number;
  lifecycleVersion: string;
  postedAt: string;
}): { nota: NotaPosting; revenue: RevenuePosting } {
  const nota: NotaPosting = {
    id: input.id,
    notaId: input.notaId,
    postingKind: input.kind,
    amountRupiah: input.quantity * 10_000,
    lines: [line(`line-${input.id}`, input.quantity)],
    stockEffects: { [SKU_ID]: -input.quantity },
    trackedLineIds: { [`line-${input.id}`]: SKU_ID },
    lifecycleVersion: input.lifecycleVersion,
    postedAt: input.postedAt,
  };
  return {
    nota,
    revenue: {
      id: `revenue-${input.id}`,
      notaId: input.notaId,
      notaPostingId: input.id,
      amountRupiah: input.quantity * 10_000,
      postingKind: input.kind,
      postedAt: input.postedAt,
    },
  };
}

function stateWithPostings(
  rows: Array<{ nota: NotaPosting; revenue: RevenuePosting }>,
): DemoState {
  return {
    ...createInitialState(),
    notaPostings: rows.map((row) => row.nota),
    revenuePostings: rows.map((row) => row.revenue),
  };
}

describe('SKU sales history', () => {
  test('nets complete, recomplete, reversal, and restore lifecycle units', () => {
    const notaId = 'nota-lifecycle';
    const rows = [
      lifecyclePosting({ id: 'complete', notaId, kind: 'complete', quantity: 10, lifecycleVersion: '2', postedAt: '2026-06-01T02:00:00.000Z' }),
      lifecyclePosting({ id: 'recomplete', notaId, kind: 'recomplete', quantity: 15, lifecycleVersion: '4', postedAt: '2026-06-13T02:00:00.000Z' }),
      lifecyclePosting({ id: 'cancel', notaId, kind: 'cancel_reversal', quantity: 15, lifecycleVersion: '5', postedAt: '2026-07-12T02:00:00.000Z' }),
      lifecyclePosting({ id: 'restore', notaId, kind: 'restore', quantity: 15, lifecycleVersion: '6', postedAt: '2026-07-13T02:00:00.000Z' }),
    ];

    const history = buildSkuSalesHistory(
      stateWithPostings(rows),
      new Date('2026-08-11T02:00:00.000Z'),
    ).get(SKU_ID);

    expect(history).toEqual({
      skuId: SKU_ID,
      lifetimeSoldPieces: 15,
      soldPieces30: 15,
      soldPieces60: 5,
      lastEffectiveSaleAt: '2026-07-13T02:00:00.000Z',
    });
  });

  test('includes exact WITA D-29 and D-59 boundaries and excludes one second before them', () => {
    const rows = [
      lifecyclePosting({ id: 'd29-in', notaId: 'nota-d29-in', kind: 'complete', quantity: 2, lifecycleVersion: '2', postedAt: '2026-07-12T16:00:00.000Z' }),
      lifecyclePosting({ id: 'd29-out', notaId: 'nota-d29-out', kind: 'complete', quantity: 3, lifecycleVersion: '2', postedAt: '2026-07-12T15:59:59.000Z' }),
      lifecyclePosting({ id: 'd59-in', notaId: 'nota-d59-in', kind: 'complete', quantity: 5, lifecycleVersion: '2', postedAt: '2026-06-12T16:00:00.000Z' }),
      lifecyclePosting({ id: 'd59-out', notaId: 'nota-d59-out', kind: 'complete', quantity: 7, lifecycleVersion: '2', postedAt: '2026-06-12T15:59:59.000Z' }),
      lifecyclePosting({ id: 'future', notaId: 'nota-future', kind: 'complete', quantity: 11, lifecycleVersion: '2', postedAt: '2026-08-11T16:00:00.000Z' }),
    ];

    const history = buildSkuSalesHistory(
      stateWithPostings(rows),
      new Date('2026-08-11T02:00:00.000Z'),
    ).get(SKU_ID);

    expect(history).toEqual({
      skuId: SKU_ID,
      lifetimeSoldPieces: 17,
      soldPieces30: 2,
      soldPieces60: 10,
      lastEffectiveSaleAt: '2026-07-12T16:00:00.000Z',
    });
  });

  test('uses completed transactions only when posting collections are absent', () => {
    const state = createInitialState();
    const completed = createDraftNotaTransaction(1);
    completed.status = 'completed';
    completed.completedAt = '2026-08-10T03:00:00.000Z';
    completed.pages[0]!.lines = [line('fallback-line', 4)];
    const cancelled = structuredClone(completed);
    cancelled.id = 'cancelled';
    cancelled.status = 'cancelled';
    cancelled.pages[0]!.lines = [line('cancelled-line', 99)];

    const fallback = buildSkuSalesHistory({
      ...state,
      notaTransactions: [completed, cancelled],
      notaPostings: undefined,
      revenuePostings: undefined,
    }, new Date('2026-08-11T02:00:00.000Z')).get(SKU_ID);
    const authoritativeEmpty = buildSkuSalesHistory({
      ...state,
      notaTransactions: [completed],
      notaPostings: [],
      revenuePostings: [],
    }, new Date('2026-08-11T02:00:00.000Z')).get(SKU_ID);

    expect(fallback).toEqual({
      skuId: SKU_ID,
      lifetimeSoldPieces: 4,
      soldPieces30: 4,
      soldPieces60: 4,
      lastEffectiveSaleAt: '2026-08-10T03:00:00.000Z',
    });
    expect(authoritativeEmpty).toBeUndefined();
  });
});
