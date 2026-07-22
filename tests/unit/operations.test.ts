import ExcelJS from 'exceljs';
import { createInitialState, reduceOperation } from '../../src/domain/operations';
import { parseSkuWorkbook } from '../../src/domain/workbook';

test('SKU number edits preserve the previous number as a searchable alias', () => {
  const initial = createInitialState();
  const sku = initial.skus[0]!;
  const next = reduceOperation(initial, { type: 'update-sku', id: sku.id, patch: { skuNumber: 'BRS-BARU' } });
  expect(next.skus[0]?.skuNumber).toBe('BRS-BARU');
  expect(next.skus[0]?.aliases).toContain(sku.skuNumber);
});

test('tracked stock adjustments allow a negative balance', () => {
  const initial = createInitialState();
  const sku = initial.skus[0]!;
  const next = reduceOperation(initial, { type: 'adjust-stock', id: sku.id, quantity: -(sku.stock + 4) });
  expect(next.skus[0]?.stock).toBe(-4);
  expect(next.adjustments.at(-1)?.after).toBe(-4);
});

test('SKU price edits record the previous and next reference price once', () => {
  const initial = createInitialState();
  const sku = initial.skus[0]!;
  const changed = reduceOperation(initial, { type: 'update-sku', id: sku.id, patch: { referencePrice: 52_000 } });
  const unchanged = reduceOperation(changed, { type: 'update-sku', id: sku.id, patch: { referencePrice: 52_000, note: 'Rak baru' } });

  expect(unchanged.priceChanges).toHaveLength(1);
  expect(unchanged.priceChanges[0]).toMatchObject({ skuId: sku.id, before: 42_000, after: 52_000 });
  expect(unchanged.priceChanges[0]?.createdAt).toBeTruthy();
});

test('workbook mapping uses Modal Referensi and preserves long SKU numbers', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('SKU');
  sheet.addRow(['Nomor SKU', 'Judul', 'Modal Referensi', 'Harga Jual Referensi', 'Semua Total Stok', 'Tautan Gambar', 'Catatan SKU Gudang', 'Waktu Dibuat']);
  const longSku = 'SKU-' + 'X'.repeat(120);
  sheet.addRow([longSku, 'Barang Uji', 125000, 999999, 7, 'https://example.com/a.jpg', 'Rak B', '2026-07-18 10:00:00']);
  const buffer = await workbook.xlsx.writeBuffer();
  const result = await parseSkuWorkbook(buffer);
  expect(result.skus).toHaveLength(1);
  expect(result.skus[0]).toMatchObject({ skuNumber: longSku, name: 'Barang Uji', referencePrice: 125000, stock: 7, tracked: true });
});

test('workbook mapping skips duplicate and blank SKU numbers with warnings', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('SKU');
  sheet.addRow(['Nomor SKU', 'Judul', 'Modal Referensi', 'Semua Total Stok']);
  sheet.addRow(['ABC', 'Satu', 10, 1]);
  sheet.addRow(['ABC', 'Dua', 20, 2]);
  sheet.addRow(['', 'Kosong', 30, 3]);
  const result = await parseSkuWorkbook(await workbook.xlsx.writeBuffer());
  expect(result.skus).toHaveLength(1);
  expect(result.skipped).toBe(2);
  expect(result.warnings).toHaveLength(2);
});
