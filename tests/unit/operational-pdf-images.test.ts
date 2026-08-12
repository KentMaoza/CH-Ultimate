import { expect, test, vi } from 'vitest';

import { buildOperationalPdfPlan } from '../../src/domain/operational-exports';
import { createInitialState } from '../../src/domain/operations';
import {
  createOperationalPdfThumbnail,
  hydrateOperationalPdfImages,
} from '../../src/renderer/operational-pdf-images';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

test('SKU PDF loads only included rows through the gateway and keeps bounded thumbnail fallbacks', async () => {
  const state = createInitialState();
  state.skus = Array.from({ length: 305 }, (_, index) => ({
    ...structuredClone(state.skus[0]!), id: `sku-${index}`,
    skuNumber: `SKU-${String(index).padStart(3, '0')}`,
    imageUrl: `https://example.test/${index}.jpg`,
  }));
  const gateway = new MockOperationsGateway(() => state);
  const loadSkuImage = vi.spyOn(gateway, 'loadSkuImage').mockImplementation(async (sku) =>
    sku.id.endsWith('-1') ? '' : `data:image/jpeg;base64,${sku.id}`);
  const thumbnail = vi.fn(async (source: string) => `thumb:${source}`);
  const plan = buildOperationalPdfPlan(state, 'sku-stock', {
    query: '', from: '', to: '', status: 'active',
  }, '2026-08-04');

  const hydrated = await hydrateOperationalPdfImages(
    plan, state.skus, gateway, { thumbnail },
  );

  expect(loadSkuImage).toHaveBeenCalledTimes(300);
  expect(thumbnail).toHaveBeenCalledTimes(299);
  expect(hydrated.rows).toHaveLength(300);
  expect(hydrated.rows.find((row) => row.skuId === 'sku-1')?.thumbnailDataUrl).toBe('');
  expect(hydrated.rows.find((row) => row.skuId === 'sku-2')?.thumbnailDataUrl).toContain('thumb:data:image/jpeg');
});

test('operational PDF thumbnails use the compact 10mm table profile', async () => {
  const encoded: Array<[number, number]> = [];
  const thumbnail = await createOperationalPdfThumbnail(
    'data:image/png;base64,ORIGINAL',
    {
      decode: async () => ({
        width: 3200,
        height: 1600,
        source: {} as CanvasImageSource,
      }),
      encode: async (_source, width, height) => {
        encoded.push([width, height]);
        return new Blob(['compact'], { type: 'image/jpeg' });
      },
    },
  );

  expect(encoded).toEqual([[96, 48]]);
  expect(thumbnail).toBe('data:image/jpeg;base64,Y29tcGFjdA==');
});

test('hydrates the 300-row mobile PDF with eight bounded workers and progress', async () => {
  const state = createInitialState();
  state.skus = Array.from({ length: 300 }, (_, index) => ({
    ...structuredClone(state.skus[0]!),
    id: `sku-progress-${index}`,
    skuNumber: `SKU-PROGRESS-${String(index).padStart(3, '0')}`,
    imageUrl: `data:image/jpeg;base64,${index}`,
  }));
  const gateway = new MockOperationsGateway(() => state);
  const plan = buildOperationalPdfPlan(state, 'sku-stock', {
    query: '', from: '', to: '', status: 'active',
  }, '2026-08-12');
  let active = 0;
  let maxActive = 0;
  const progress: Array<[number, number]> = [];
  const dependencies = {
    thumbnail: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return 'data:image/jpeg;base64,dGh1bWI=';
    },
    onProgress: (completed: number, total: number) => progress.push([completed, total]),
  };

  const hydrated = await hydrateOperationalPdfImages(
    plan, state.skus, gateway, dependencies,
  );

  expect(hydrated.rows).toHaveLength(300);
  expect(maxActive).toBe(8);
  expect(progress.at(-1)).toEqual([300, 300]);
  expect(progress.every(([completed, total], index) => (
    completed === index + 1 && total === 300
  ))).toBe(true);
});
