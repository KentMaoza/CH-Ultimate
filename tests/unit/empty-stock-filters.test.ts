import { describe, expect, test } from 'vitest';
import type { EmptyStockItem, Sku } from '../../src/domain/types';
import { addFilteredSelection, buildEmptyStockPdfPlan, filterEmptyStockItems, supplierCodeFromName } from '../../src/renderer/pages/empty-stock-utils';

const sku = (id: string, skuNumber: string, name: string): EmptyStockItem => ({
  selected: false,
  sku: { id, skuNumber, name, aliases: [], identifiers: [], referencePrice: 0, stock: 0, tracked: true, note: '', imageUrl: '', createdAt: '', archived: false } satisfies Sku,
});

const items = [
  sku('1', 'SKU-RED', 'Kemeja Merah CH02'),
  sku('2', 'SKU-BLUE', 'Kemeja Biru CH002'),
  sku('3', 'SKU-BAG', 'Tas Besar CH02'),
  sku('4', 'SKU-PLAIN', 'Barang tanpa supplier'),
];

describe('empty stock supplier filters', () => {
  test('builds a printable PDF plan from the exact selected restock rows', () => {
    const plan = buildEmptyStockPdfPlan(
      [sku('1', 'SKU-RED', 'Kemeja Merah CH02')],
      { '1': 12 },
      '2026-08-08',
    );

    expect(plan).toMatchObject({
      kind: 'operational-data',
      dataset: 'sku-stock',
      title: 'Laporan Barang Kosong',
      fileName: 'CHU-Laporan-Barang-Kosong-2026-08-08.pdf',
      totalMatched: 1,
      totalIncluded: 1,
      rows: [{ id: '1', skuId: '1', cells: ['SKU-RED', 'Kemeja Merah CH02', 0, 12] }],
    });
  });

  test('extracts only an exact supplier suffix and preserves zero padding', () => {
    expect(supplierCodeFromName('Kemeja Merah CH02')).toBe('CH02');
    expect(supplierCodeFromName('Kemeja Biru ch002 ')).toBe('CH002');
    expect(supplierCodeFromName('CH01 Kemeja')).toBeNull();
    expect(supplierCodeFromName('Kemeja CH01 revisi')).toBeNull();
  });

  test('combines name or SKU search with an exact supplier filter', () => {
    expect(filterEmptyStockItems(items, 'kemeja', 'CH02').map(({ sku }) => sku.id)).toEqual(['1']);
    expect(filterEmptyStockItems(items, 'sku-blue', 'CH002').map(({ sku }) => sku.id)).toEqual(['2']);
    expect(filterEmptyStockItems(items, '', '__none__').map(({ sku }) => sku.id)).toEqual(['4']);
  });

  test('select all merges the current filtered result with earlier selections', () => {
    const selected = addFilteredSelection(new Set(['2']), filterEmptyStockItems(items, '', 'CH02'));
    expect([...selected].sort()).toEqual(['1', '2', '3']);
  });
});
