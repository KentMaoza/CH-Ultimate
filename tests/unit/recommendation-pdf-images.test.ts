import { expect, test } from 'vitest';

import { buildRecommendationPdfPlan } from '../../src/domain/recommendation-pdf';
import { buildShareRecommendationReport } from '../../src/domain/share-recommendations';
import { createMobileDemoState } from '../../src/domain/mobile-demo-state';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { hydrateRecommendationPdfImages } from '../../src/renderer/recommendation-pdf-images';

test('hydrates recommendation PDF products through the gateway loader', async () => {
  const gateway = new MockOperationsGateway(createMobileDemoState);
  const state = gateway.getSnapshot();
  const plan = buildRecommendationPdfPlan(
    buildShareRecommendationReport(state, new Date('2026-08-04T04:00:00.000Z')),
    'daily',
  );
  const load = vi.spyOn(gateway, 'loadSkuImage')
    .mockResolvedValue('data:image/png;base64,YQ==');

  const hydrated = await hydrateRecommendationPdfImages(plan, state.skus, gateway);

  expect(hydrated.groups.flatMap((group) => group.products)
    .every((product) => product.imageUrl === 'data:image/png;base64,YQ==')).toBe(true);
  expect(load).toHaveBeenCalled();
});
