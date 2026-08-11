import { describe, expect, test } from 'vitest';
import { createInitialState } from '../../src/domain/operations';
import { buildRestockRecommendationReport } from '../../src/domain/restock-recommendations';
import type {
  DemoState,
  NotaLine,
  NotaPosting,
  RevenuePosting,
  Sku,
  StockAdjustment,
  StockCheck,
} from '../../src/domain/types';

const AS_OF = new Date('2026-08-11T02:00:00.000Z');

function sku(id: string, stock = 0, options: Partial<Sku> = {}): Sku {
  return {
    id,
    skuNumber: `SKU-${id.toUpperCase()}`,
    aliases: [],
    identifiers: [],
    name: `Barang ${id.toUpperCase()} CH01`,
    referencePrice: 10_000,
    stock,
    tracked: true,
    note: '',
    imageUrl: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    archived: false,
    ...options,
  };
}

function sale(
  id: string,
  skuId: string,
  quantity: number,
  postedAt: string,
  kind = 'complete',
  lifecycleVersion = '2',
  notaId = `nota-${id}`,
): { nota: NotaPosting; revenue: RevenuePosting } {
  const item: NotaLine = {
    id: `line-${id}`,
    skuId,
    description: `Barang ${skuId}`,
    kind: 'Uji',
    quantity,
    unit: 'pcs',
    pcsPrice: 10_000,
    lsnPrice: 120_000,
  };
  return {
    nota: {
      id: `posting-${id}`,
      notaId,
      postingKind: kind,
      amountRupiah: quantity * 10_000,
      lines: [item],
      stockEffects: { [skuId]: -quantity },
      trackedLineIds: { [item.id]: skuId },
      lifecycleVersion,
      postedAt,
    },
    revenue: {
      id: `revenue-${id}`,
      notaId,
      notaPostingId: `posting-${id}`,
      amountRupiah: quantity * 10_000,
      postingKind: kind,
      postedAt,
    },
  };
}

function stocked(id: string, before = 10, after = 0): StockAdjustment {
  return {
    id: `adjustment-${id}`,
    skuId: id,
    quantity: after - before,
    before,
    after,
    createdAt: '2026-07-01T00:00:00.000Z',
    source: 'manual',
  };
}

function checked(id: string): StockCheck {
  return {
    id: `check-${id}`,
    skuId: id,
    observedQuantityPcs: 8,
    countedQuantityPcs: 0,
    serverQuantityBeforePcs: 8,
    appliedDeltaPcs: -8,
    forcedOffline: false,
    countedAt: '2026-07-01T00:00:00.000Z',
    appliedAt: '2026-07-01T00:00:01.000Z',
    deviceId: 'device-test',
    deviceDisplayName: 'Test',
  };
}

function recommendationState(input: {
  skus: Sku[];
  sales: Array<{ nota: NotaPosting; revenue: RevenuePosting }>;
  adjustments?: StockAdjustment[];
  stockChecks?: StockCheck[];
}): DemoState {
  return {
    ...createInitialState(),
    skus: input.skus,
    adjustments: input.adjustments ?? [],
    stockChecks: input.stockChecks ?? [],
    notaTransactions: [],
    notaPostings: input.sales.map((row) => row.nota),
    revenuePostings: input.sales.map((row) => row.revenue),
  };
}

describe('restock recommendations', () => {
  test('requires independent proof that an active tracked SKU was stocked and sold', () => {
    const skus = [
      sku('balance', 2),
      sku('movement'),
      sku('check'),
      sku('never-stocked'),
      sku('never-sold'),
      sku('archived', 2, { archived: true }),
      sku('untracked', 2, { tracked: false }),
      sku('reversed'),
    ];
    const complete = sale('reversed-complete', 'reversed', 4, '2026-08-01T00:00:00.000Z', 'complete', '2', 'nota-reversed');
    const reversal = sale('reversed-cancel', 'reversed', 4, '2026-08-02T00:00:00.000Z', 'cancel_reversal', '3', 'nota-reversed');
    const sales = [
      sale('balance', 'balance', 4, '2026-08-01T00:00:00.000Z'),
      sale('movement', 'movement', 4, '2026-08-01T00:00:00.000Z'),
      sale('check', 'check', 4, '2026-08-01T00:00:00.000Z'),
      sale('never-stocked', 'never-stocked', 4, '2026-08-01T00:00:00.000Z'),
      sale('archived', 'archived', 4, '2026-08-01T00:00:00.000Z'),
      sale('untracked', 'untracked', 4, '2026-08-01T00:00:00.000Z'),
      complete,
      reversal,
    ];

    const report = buildRestockRecommendationReport(recommendationState({
      skus,
      sales,
      adjustments: [stocked('movement'), stocked('never-sold'), stocked('reversed')],
      stockChecks: [checked('check')],
    }), AS_OF);

    expect(report.items.map((item) => item.sku.id).sort()).toEqual([
      'balance',
      'check',
      'movement',
    ]);
  });

  test('unions zero-stock 60-day sellers with the top third of 30-day sellers and keeps cutoff ties', () => {
    const skus = [
      sku('a', 0, { name: 'Barang A CH01' }),
      sku('b', 50, { name: 'Barang B CH01' }),
      sku('c', 5, { name: 'Barang C CH02' }),
      sku('d', 5, { name: 'Barang D CH02' }),
      sku('e', 0, { name: 'Barang E CH03' }),
      sku('f', 0, { name: 'Barang F CH03' }),
      sku('g', 5, { name: 'Barang G CH04' }),
      sku('h', 5, { name: 'Barang H CH04' }),
    ];
    const sales = [
      sale('a', 'a', 20, '2026-08-10T00:00:00.000Z'),
      sale('b', 'b', 15, '2026-08-09T00:00:00.000Z'),
      sale('c', 'c', 10, '2026-08-08T00:00:00.000Z'),
      sale('d', 'd', 10, '2026-08-08T00:00:00.000Z'),
      sale('e', 'e', 5, '2026-08-07T00:00:00.000Z'),
      sale('f', 'f', 9, '2026-06-30T00:00:00.000Z'),
      sale('g', 'g', 1, '2026-08-06T00:00:00.000Z'),
      sale('h', 'h', 1, '2026-08-05T00:00:00.000Z'),
    ];
    const report = buildRestockRecommendationReport(recommendationState({
      skus,
      sales,
      adjustments: skus.map((item) => stocked(item.id)),
    }), AS_OF);

    expect(report.items.map((item) => item.sku.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(report.items.map((item) => [item.sku.id, item.reasons])).toEqual([
      ['a', ['zero-stock-recent', 'top-seller']],
      ['b', ['top-seller']],
      ['c', ['top-seller']],
      ['d', ['top-seller']],
      ['e', ['zero-stock-recent']],
      ['f', ['zero-stock-recent']],
    ]);
  });

  test('assigns stable performance bands and one-month restock quantities', () => {
    const skus = [
      sku('a', 0, { name: 'Barang A CH01' }),
      sku('b', 50, { name: 'Barang B CH01' }),
      sku('c', 5, { name: 'Barang C CH02' }),
      sku('d', 5, { name: 'Barang D CH02' }),
      sku('e', 0, { name: 'Barang E CH03' }),
      sku('f', -3, { name: 'Barang F tanpa supplier' }),
      sku('g', 5, { name: 'Barang G CH04' }),
      sku('h', 5, { name: 'Barang H CH04' }),
    ];
    const sales = [
      sale('a', 'a', 20, '2026-08-10T00:00:00.000Z'),
      sale('b', 'b', 15, '2026-08-09T00:00:00.000Z'),
      sale('c', 'c', 10, '2026-08-08T00:00:00.000Z'),
      sale('d', 'd', 10, '2026-08-08T00:00:00.000Z'),
      sale('e', 'e', 5, '2026-08-07T00:00:00.000Z'),
      sale('f', 'f', 9, '2026-06-30T00:00:00.000Z'),
      sale('g', 'g', 1, '2026-08-06T00:00:00.000Z'),
      sale('h', 'h', 1, '2026-08-05T00:00:00.000Z'),
    ];
    const report = buildRestockRecommendationReport(recommendationState({
      skus,
      sales,
      adjustments: skus.map((item) => stocked(item.id)),
    }), AS_OF);

    expect(report.items.map((item) => [
      item.sku.id,
      item.rank,
      item.recommendedQuantity,
      item.soldPieces30,
      item.soldPieces60,
    ])).toEqual([
      ['a', 'green', 20, 20, 20],
      ['b', 'green', 0, 15, 15],
      ['c', 'yellow', 5, 10, 10],
      ['d', 'yellow', 5, 10, 10],
      ['e', 'red', 5, 5, 5],
      ['f', 'red', 5, 0, 9],
    ]);
    expect(report.groups.map((group) => [
      group.supplierCode,
      group.items.map((item) => item.sku.id),
    ])).toEqual([
      ['CH01', ['a', 'b']],
      ['CH02', ['c', 'd']],
      ['CH03', ['e']],
      [null, ['f']],
    ]);
  });
});
