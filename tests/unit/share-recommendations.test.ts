import { createInitialState } from '../../src/domain/operations';
import { buildShareRecommendationReport, supplierCodeFromSku } from '../../src/domain/share-recommendations';
import { createDraftNotaTransaction } from '../../src/domain/nota';
import type { Sku } from '../../src/domain/types';

function sku(id: string, name: string, createdAt: string, stock = 1, patch: Partial<Sku> = {}): Sku {
  return {
    id,
    skuNumber: `SKU-${id}`,
    aliases: [],
    name,
    referencePrice: 10_000,
    stock,
    tracked: true,
    note: '',
    imageUrl: '',
    createdAt,
    archived: false,
    ...patch,
  };
}

test('groups share recommendations by CH suffix and prioritizes the oldest stock movement', () => {
  const oldUnmoved = sku('old', 'Kemeja Lama CH009', '2025-01-10T00:00:00.000Z');
  const recentlySold = sku('sold', 'Kemeja Terjual CH009', '2024-01-10T00:00:00.000Z');
  const newer = sku('new', 'Rok Baru CH010', '2026-06-10T00:00:00.000Z');
  const archived = sku('archived', 'Arsip CH010', '2024-01-01T00:00:00.000Z', 5, { archived: true });
  const empty = sku('empty', 'Kosong CH011', '2024-01-01T00:00:00.000Z', 0);
  const completed = createDraftNotaTransaction(1);
  completed.status = 'completed';
  completed.completedAt = '2026-05-10T00:00:00.000Z';
  completed.postedLines = [{ id: 'sold-line', skuId: recentlySold.id, description: recentlySold.name, kind: '', quantity: 1, unit: 'pcs', pcsPrice: 10_000, lsnPrice: 120_000 }];

  const report = buildShareRecommendationReport(
    { ...createInitialState(), skus: [newer, recentlySold, oldUnmoved, archived, empty], notaTransactions: [completed] },
    new Date('2026-07-23T04:00:00.000Z'),
  );

  expect(report.date).toBe('2026-07-23');
  expect(report.daily.map((item) => item.sku.id).sort()).toEqual(['new', 'old', 'sold']);
  expect(report.daily.find((item) => item.sku.id === 'sold')?.lastOutAt).toBe(completed.completedAt);
  expect(report.groups.map((group) => [group.supplierCode, group.items.map((item) => item.sku.id)])).toEqual([
    ['CH009', ['old', 'sold']],
    ['CH010', ['new']],
  ]);
  expect(supplierCodeFromSku(sku('number', 'Tanpa kode', '2026-01-01T00:00:00.000Z', 1, { skuNumber: 'ABC-CH012' }))).toBe('CH012');
});

test('interleaves repriced, restocked, and idle SKU while retaining every applicable reason once', () => {
  const repriced = sku('repriced', 'Harga Baru CH009', '2026-01-01T00:00:00.000Z');
  const restocked = sku('restocked', 'Restock Baru CH010', '2026-01-02T00:00:00.000Z');
  const idle = sku('idle', 'Stok Lama CH011', '2025-01-01T00:00:00.000Z');
  const both = sku('both', 'Harga Dan Restock CH012', '2026-01-03T00:00:00.000Z');
  const state = {
    ...createInitialState(),
    skus: [idle, both, restocked, repriced],
    priceChanges: [
      { id: 'price-1', skuId: repriced.id, before: 9_000, after: 10_000, createdAt: '2026-07-22T02:00:00.000Z' },
      { id: 'price-2', skuId: both.id, before: 8_000, after: 10_000, createdAt: '2026-07-21T02:00:00.000Z' },
    ],
    adjustments: [
      { id: 'stock-1', skuId: restocked.id, quantity: 5, before: 0, after: 5, createdAt: '2026-07-22T03:00:00.000Z', source: 'manual' as const },
      { id: 'stock-2', skuId: both.id, quantity: 2, before: 1, after: 3, createdAt: '2026-07-21T03:00:00.000Z', source: 'manual' as const },
    ],
  };

  const report = buildShareRecommendationReport(state, new Date('2026-07-23T04:00:00.000Z'));

  expect(report.daily.slice(0, 3).map((item) => item.sku.id)).toEqual(['repriced', 'restocked', 'idle']);
  expect(new Set(report.daily.map((item) => item.sku.id)).size).toBe(report.daily.length);
  expect(report.daily.find((item) => item.sku.id === 'repriced')?.reasons).toEqual(['price-updated', 'idle']);
  expect(report.daily.find((item) => item.sku.id === 'restocked')?.reasons).toEqual(['restocked', 'idle']);
  expect(report.daily.find((item) => item.sku.id === 'both')?.reasons).toEqual(['price-updated', 'restocked', 'idle']);
});

test('rotates the starting supplier deterministically across consecutive WITA dates', () => {
  const skus = [
    sku('a', 'Barang A CH009', '2025-01-01T00:00:00.000Z'),
    sku('b', 'Barang B CH010', '2025-01-01T00:00:00.000Z'),
    sku('c', 'Barang C CH011', '2025-01-01T00:00:00.000Z'),
  ];
  const first = buildShareRecommendationReport(
    { ...createInitialState(), skus },
    new Date('2026-07-23T04:00:00.000Z'),
  );
  const second = buildShareRecommendationReport(
    { ...createInitialState(), skus },
    new Date('2026-07-24T04:00:00.000Z'),
  );

  expect(first.daily.map((item) => item.sku.id)).not.toEqual(second.daily.map((item) => item.sku.id));
  expect(buildShareRecommendationReport(
    { ...createInitialState(), skus },
    new Date('2026-07-23T12:00:00.000Z'),
  ).daily.map((item) => item.sku.id)).toEqual(first.daily.map((item) => item.sku.id));
});

test('marks only stock idle for more than eight calendar months as urgent', () => {
  const urgent = sku('urgent', 'Urgent CH001', '2025-11-22T00:00:00.000Z');
  const boundary = sku('boundary', 'Batas CH001', '2025-11-23T00:00:00.000Z');
  const report = buildShareRecommendationReport(
    { ...createInitialState(), skus: [boundary, urgent], notaTransactions: [] },
    new Date('2026-07-23T00:00:00.000Z'),
  );

  expect(report.urgent.map((item) => item.sku.id)).toEqual(['urgent']);
  expect(report.daily.find((item) => item.sku.id === 'urgent')?.urgent).toBe(true);
  expect(report.daily.find((item) => item.sku.id === 'boundary')?.urgent).toBe(false);
});

test('caps each daily recommendation at 300 SKU after sorting oldest first', () => {
  const skus = Array.from({ length: 305 }, (_, index) => sku(
    String(index).padStart(3, '0'),
    `Barang ${index} CH020`,
    new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
  ));
  const report = buildShareRecommendationReport(
    { ...createInitialState(), skus: skus.reverse(), notaTransactions: [] },
    new Date('2026-07-23T04:00:00.000Z'),
    999,
  );

  expect(report.daily).toHaveLength(300);
  expect(report.daily[0]?.sku.id).toBe('000');
  expect(report.daily.at(-1)?.sku.id).toBe('299');
  expect(report.totalEligible).toBe(305);
});

test('does not use future sales or SKU created after the recommendation date', () => {
  const existing = sku('existing', 'Barang Lama CH030', '2025-01-01T00:00:00.000Z');
  const notCreatedYet = sku('future-sku', 'Barang Masa Depan CH030', '2026-07-24T00:00:00.000Z');
  const futureSale = createDraftNotaTransaction(1);
  futureSale.status = 'completed';
  futureSale.completedAt = '2026-07-24T00:00:00.000Z';
  futureSale.postedLines = [{ id: 'future-line', skuId: existing.id, description: existing.name, kind: '', quantity: 1, unit: 'pcs', pcsPrice: 10_000, lsnPrice: 120_000 }];

  const report = buildShareRecommendationReport(
    { ...createInitialState(), skus: [notCreatedYet, existing], notaTransactions: [futureSale] },
    new Date('2026-07-23T04:00:00.000Z'),
  );

  expect(report.daily.map((item) => item.sku.id)).toEqual(['existing']);
  expect(report.daily[0]?.lastOutAt).toBe(existing.createdAt);
});
