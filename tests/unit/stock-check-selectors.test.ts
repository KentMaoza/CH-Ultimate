import type { Sku, StockCheck } from '../../src/domain/types';
import {
  formatStockCheckWita,
  resolveSkuByIdentifier,
  selectStockCheckSkus,
} from '../../src/domain/stock-checks';

function sku(id: string, skuNumber: string, patch: Partial<Sku> = {}): Sku {
  return {
    id,
    skuNumber,
    aliases: [],
    identifiers: [],
    name: `Produk ${skuNumber}`,
    referencePrice: 10_000,
    stock: 4,
    tracked: true,
    note: '',
    imageUrl: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    archived: false,
    ...patch,
  };
}

function check(id: string, skuId: string, countedAt: string): StockCheck {
  return {
    id,
    skuId,
    observedQuantityPcs: 4,
    countedQuantityPcs: 4,
    serverQuantityBeforePcs: 4,
    appliedDeltaPcs: 0,
    forcedOffline: false,
    countedAt,
    appliedAt: '2026-08-04T04:00:00.000Z',
    deviceId: 'device-1',
    deviceDisplayName: 'Desktop Gudang',
  };
}

test('stock-check list excludes archived SKU and sorts never checked, oldest physical count, then SKU number', () => {
  const skus = [
    sku('never-b', 'CH011'),
    sku('newer', 'CH009', { lastStockCheckedAt: '2026-08-04T03:00:00.000Z' }),
    sku('never-a', 'CH002'),
    sku('older', 'CH010', { lastStockCheckedAt: '2026-08-04T02:00:00.000Z' }),
    sku('archived', 'CH001', { archived: true }),
  ];
  const checks = [
    check('check-newer', 'newer', '2026-08-04T03:00:00.000Z'),
    check('check-older', 'older', '2026-08-04T02:00:00.000Z'),
    check('check-archived', 'archived', '2026-08-01T00:00:00.000Z'),
  ];

  expect(selectStockCheckSkus(skus, checks).map(({ sku: item }) => item.id)).toEqual([
    'never-a',
    'never-b',
    'older',
    'newer',
  ]);
});

test('stock scans resolve every registered identifier kind with normalized exact matching', () => {
  const target = sku('target', 'CH010', {
    aliases: ['ALIAS-LAMA'],
    identifiers: [
      { id: 'primary', skuId: 'target', value: 'PRIMARY-010', kind: 'primary', createdAt: '' },
      { id: 'product', skuId: 'target', value: 'PRODUCT-010', kind: 'product_code', createdAt: '' },
      { id: 'alias', skuId: 'target', value: 'ALIAS-010', kind: 'alias', createdAt: '' },
      { id: 'package', skuId: 'target', value: '899000010', kind: 'package_barcode', createdAt: '' },
      { id: 'other', skuId: 'target', value: 'LEGACY-010', kind: 'other', createdAt: '' },
    ],
  });

  for (const code of ['ch010', 'alias-lama', 'primary-010', 'product-010', 'alias-010', '899000010', 'legacy-010']) {
    expect(resolveSkuByIdentifier([target], `  ${code}  `)?.id).toBe('target');
  }
  expect(resolveSkuByIdentifier([target], 'PRODUCT')).toBeNull();
  expect(resolveSkuByIdentifier([target], '   ')).toBeNull();
});

test('last checked time is formatted from countedAt in WITA', () => {
  expect(formatStockCheckWita('2026-08-04T01:15:00.000Z')).toContain('09:15');
  expect(formatStockCheckWita('2026-08-04T01:15:00.000Z')).toContain('WITA');
});
