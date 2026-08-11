import type { RestockRecommendationDocumentPlan } from '../domain/restock-recommendation-document';
import type { Sku } from '../domain/types';
import type { OperationsGateway } from '../gateway/operations-gateway-contract';
import {
  createOperationalPdfThumbnail,
} from './operational-pdf-images';

interface RestockRecommendationImageDependencies {
  thumbnail(source: string): Promise<string>;
}

export async function hydrateRestockRecommendationImages(
  plan: RestockRecommendationDocumentPlan,
  skus: Sku[],
  gateway: OperationsGateway,
  dependencies: RestockRecommendationImageDependencies = {
    thumbnail: createOperationalPdfThumbnail,
  },
): Promise<RestockRecommendationDocumentPlan> {
  const skuById = new Map(skus.map((sku) => [sku.id, sku]));
  const items = plan.pages.flatMap((page) => page.items);
  const thumbnails = new Map<string, string>();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(2, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (!item) continue;
      const sku = skuById.get(item.skuId);
      if (!sku) continue;
      const source = await gateway.loadSkuImage(sku).catch(() => '');
      const thumbnail = source
        ? await dependencies.thumbnail(source).catch(() => '')
        : '';
      thumbnails.set(item.skuId, thumbnail);
    }
  }));
  return {
    ...plan,
    pages: plan.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => ({
        ...item,
        thumbnailDataUrl: thumbnails.get(item.skuId) ?? '',
      })),
    })),
  };
}
