import { expect, test, vi } from 'vitest';
import { formatSkuShareText } from '../../src/domain/sku-share';
import type { Sku } from '../../src/domain/types';
import {
  downloadSkuImage,
  loadSkuShareFile,
  shareSkuWithSystem,
} from '../../src/renderer/sku-share';

const sku: Sku = {
  id: 'share-1',
  skuNumber: 'SKU-001',
  aliases: [],
  name: 'Produk Contoh',
  referencePrice: 25_000,
  stock: 99,
  tracked: true,
  note: '',
  imageUrl: '',
  createdAt: '2026-07-23T00:00:00.000Z',
  archived: false,
};

test('formats only public SKU fields for sharing', () => {
  expect(formatSkuShareText(sku)).toBe(
    'Produk Contoh\nSKU: SKU-001\nHarga referensi: Rp25.000',
  );
  expect(formatSkuShareText(sku)).not.toContain('99');
  expect(formatSkuShareText(sku)).not.toContain('Stok');
});

test('shares one SKU with an image file and public text', async () => {
  const share = vi.fn(async () => undefined);
  const file = new File(['image'], 'SKU-001.png', { type: 'image/png' });

  const result = await shareSkuWithSystem(
    { ...sku, imageUrl: '/product.png' },
    { share, canShare: () => true },
    async () => file,
  );

  expect(result).toBe('shared');
  expect(share).toHaveBeenCalledOnce();
  expect(share).toHaveBeenCalledWith({
    title: 'Produk Contoh',
    text: 'Produk Contoh\nSKU: SKU-001\nHarga referensi: Rp25.000',
    files: [file],
  });
});

test('returns fallback when system share is unavailable', async () => {
  await expect(shareSkuWithSystem(sku, {})).resolves.toBe('fallback');
});

test('returns cancelled for AbortError without claiming success', async () => {
  const share = vi.fn(async () => {
    throw new DOMException('cancelled', 'AbortError');
  });

  await expect(shareSkuWithSystem(sku, { share })).resolves.toBe('cancelled');
});

test('falls back to text when the image cannot load', async () => {
  const share = vi.fn(async () => undefined);

  const result = await shareSkuWithSystem(
    { ...sku, imageUrl: '/missing.png' },
    { share, canShare: () => true },
    async () => null,
  );

  expect(result).toBe('shared');
  expect(share).toHaveBeenCalledWith({
    title: 'Produk Contoh',
    text: 'Produk Contoh\nSKU: SKU-001\nHarga referensi: Rp25.000',
  });
});

test('loads a safe image file for the SKU', async () => {
  const fetcher = vi.fn(async () => ({
    ok: true,
    blob: async () => ({
      type: 'image/png',
      arrayBuffer: async () => new TextEncoder().encode('image').buffer,
    }),
  } as Response));

  const file = await loadSkuShareFile(
    { ...sku, skuNumber: 'SKU / 001', imageUrl: '/product.png' },
    fetcher,
  );

  expect(fetcher).toHaveBeenCalledWith('/product.png');
  expect(file?.name).toBe('SKU-001.png');
  expect(file?.type).toBe('image/png');
});

test('downloads one prepared product image and revokes its object URL', async () => {
  const file = new File(['image'], 'SKU-001.png', { type: 'image/png' });
  const createObjectURL = vi.fn(() => 'blob:sku-image');
  const revokeObjectURL = vi.fn();
  const download = vi.fn();

  await expect(downloadSkuImage({ ...sku, imageUrl: '/product.png' }, {
    loadFile: async () => file,
    createObjectURL,
    revokeObjectURL,
    download,
  })).resolves.toBe(true);

  expect(download).toHaveBeenCalledWith('blob:sku-image', 'SKU-001.png');
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:sku-image');
});
