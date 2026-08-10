import { expect, test } from 'vitest';

import {
  buildRecommendationPdfPlan,
  type RecommendationPdfPlan,
} from '../../src/domain/recommendation-pdf';
import { buildShareRecommendationReport } from '../../src/domain/share-recommendations';
import { createMobileDemoState } from '../../src/domain/mobile-demo-state';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import {
  createRecommendationPdfThumbnail,
  hydrateRecommendationPdfImages,
} from '../../src/renderer/recommendation-pdf-images';

test('hydrates recommendation PDF products through the gateway loader', async () => {
  const gateway = new MockOperationsGateway(createMobileDemoState);
  const state = gateway.getSnapshot();
  const plan = buildRecommendationPdfPlan(
    buildShareRecommendationReport(state, new Date('2026-08-04T04:00:00.000Z')),
    'daily',
  );
  const load = vi.spyOn(gateway, 'loadSkuImage')
    .mockResolvedValue('data:image/png;base64,YQ==');

  const hydrated = await hydrateRecommendationPdfImages(plan, state.skus, gateway, {
    thumbnail: async () => 'data:image/jpeg;base64,dGh1bWI=',
  });

  expect(hydrated.groups.flatMap((group) => group.products)
    .every((product) => product.imageUrl === 'data:image/jpeg;base64,dGh1bWI=')).toBe(true);
  expect(load).toHaveBeenCalled();
});

test('bounds a recommendation thumbnail before returning its data URL', async () => {
  const encodedDimensions: Array<[number, number]> = [];
  const result = await createRecommendationPdfThumbnail(
    'data:image/png;base64,ORIGINAL',
    {
      decode: async () => ({
        width: 3200,
        height: 1600,
        source: {} as CanvasImageSource,
      }),
      encode: async (_source, width, height) => {
        encodedDimensions.push([width, height]);
        return new Blob(['thumbnail'], { type: 'image/jpeg' });
      },
    },
  );

  expect(encodedDimensions).toEqual([[320, 160]]);
  expect(result).toBe('data:image/jpeg;base64,dGh1bWJuYWls');
});

test('hydrates 300 products with two workers without retaining original large data URLs', async () => {
  const gateway = new MockOperationsGateway(createMobileDemoState);
  const base = gateway.getSnapshot().skus[0]!;
  const skus = Array.from({ length: 300 }, (_, index) => ({
    ...base,
    id: `sku-pdf-${index}`,
  }));
  const plan: RecommendationPdfPlan = {
    date: '2026-08-04',
    sourceLabel: 'DATA DEMO · SESSION ONLY',
    fileName: 'bounded.pdf',
    groups: [{
      supplierLabel: 'SUP',
      products: skus.map((sku) => ({
        id: sku.id,
        imageUrl: '',
        name: sku.name,
        referencePrice: sku.referencePrice,
        skuNumber: sku.skuNumber,
      })),
    }],
    title: 'Rekomendasi Harian',
    totalAvailable: 300,
    totalIncluded: 300,
  };
  vi.spyOn(gateway, 'loadSkuImage').mockImplementation(async (sku) => (
    `data:image/png;base64,ORIGINAL-${sku.id}-${'A'.repeat(16_384)}`
  ));
  let active = 0;
  let maxActive = 0;

  const hydrated = await hydrateRecommendationPdfImages(plan, skus, gateway, {
    thumbnail: async (source) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return `data:image/jpeg;base64,thumb-${source.slice(31, 42)}`;
    },
  });

  const output = hydrated.groups[0]!.products;
  expect(output).toHaveLength(300);
  expect(maxActive).toBe(2);
  expect(output.every((product) => product.imageUrl.length < 80)).toBe(true);
  expect(JSON.stringify(hydrated)).not.toContain('ORIGINAL-');
});
