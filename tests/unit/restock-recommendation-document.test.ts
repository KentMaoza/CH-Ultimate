import { expect, test, vi } from 'vitest';
import { createInitialState } from '../../src/domain/operations';
import {
  buildRestockRecommendationDocumentPlan,
} from '../../src/domain/restock-recommendation-document';
import type { RestockRecommendationItem } from '../../src/domain/restock-recommendations';
import type { Sku } from '../../src/domain/types';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { hydrateRestockRecommendationImages } from '../../src/renderer/restock-recommendation-images';

function recommendation(index: number, supplierCode: string | null): RestockRecommendationItem {
  const sku: Sku = {
    id: `sku-${index}`,
    skuNumber: `SKU-${index}`,
    aliases: [],
    identifiers: [],
    name: `Barang ${index}${supplierCode ? ` ${supplierCode}` : ''}`,
    referencePrice: 10_000,
    stock: 0,
    tracked: true,
    note: '',
    imageUrl: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    archived: false,
  };
  return {
    sku,
    supplierCode,
    soldPieces30: 10,
    soldPieces60: 20,
    lastEffectiveSaleAt: '2026-08-10T00:00:00.000Z',
    recommendedQuantity: index,
    rank: index % 3 === 0 ? 'green' : index % 3 === 1 ? 'yellow' : 'red',
    reasons: ['top-seller'],
  };
}

test('builds supplier-contained portrait A4 pages and omits zero quantities', () => {
  const items = [
    ...Array.from({ length: 9 }, (_, index) => recommendation(index + 1, 'CH01')),
    recommendation(10, 'CH02'),
    recommendation(11, null),
  ];
  const quantities = Object.fromEntries(items.map((item) => [
    item.sku.id,
    item.sku.id === 'sku-11' ? 0 : item.recommendedQuantity,
  ]));

  const plan = buildRestockRecommendationDocumentPlan(items, quantities, '2026-08-11');

  expect(plan).toMatchObject({
    kind: 'restock-recommendation',
    widthMm: 210,
    heightMm: 297,
    fileName: 'CHU-Rekomendasi-Restock-2026-08-11.pdf',
    generatedDate: '2026-08-11',
    totalItems: 10,
  });
  expect(plan.pages.map((page) => [page.supplierCode, page.items.length])).toEqual([
    ['CH01', 8],
    ['CH01', 1],
    ['CH02', 1],
  ]);
  expect(plan.pages.flatMap((page) => page.items).map((item) => ({
    name: item.name,
    quantity: item.quantity,
    rank: item.rank,
  }))).toEqual(items.slice(0, 10).map((item) => ({
    name: item.sku.name,
    quantity: item.recommendedQuantity,
    rank: item.rank,
  })));
});

test('hydrates thumbnails with bounded processing and keeps an empty fallback on failure', async () => {
  const state = createInitialState();
  const first = recommendation(1, 'CH01');
  const second = recommendation(2, 'CH01');
  first.sku = { ...state.skus[0]!, imageUrl: 'data:image/png;base64,first' };
  second.sku = { ...state.skus[1]!, imageUrl: 'data:image/png;base64,second' };
  const plan = buildRestockRecommendationDocumentPlan(
    [first, second],
    { [first.sku.id]: 4, [second.sku.id]: 5 },
    '2026-08-11',
  );
  const thumbnail = vi.fn(async (source: string) => {
    if (source.endsWith('second')) throw new Error('broken image');
    return 'data:image/jpeg;base64,thumb';
  });

  const hydrated = await hydrateRestockRecommendationImages(
    plan,
    [first.sku, second.sku],
    new MockOperationsGateway(),
    { thumbnail },
  );

  expect(thumbnail).toHaveBeenCalledTimes(2);
  expect(hydrated.pages[0]!.items.map((item) => item.thumbnailDataUrl)).toEqual([
    'data:image/jpeg;base64,thumb',
    '',
  ]);
});
