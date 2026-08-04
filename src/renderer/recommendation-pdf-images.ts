import type { RecommendationPdfPlan } from '../domain/recommendation-pdf';
import type { Sku } from '../domain/types';
import type { OperationsGateway } from '../gateway/operations-gateway-contract';

export async function hydrateRecommendationPdfImages(
  plan: RecommendationPdfPlan,
  skus: Sku[],
  gateway: OperationsGateway,
): Promise<RecommendationPdfPlan> {
  const skuById = new Map(skus.map((sku) => [sku.id, sku]));
  const productIds = [...new Set(
    plan.groups.flatMap((group) => group.products.map((product) => product.id)),
  )];
  const images = new Map<string, string>();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(2, productIds.length) }, async () => {
    while (cursor < productIds.length) {
      const id = productIds[cursor++];
      if (!id) continue;
      const sku = skuById.get(id);
      if (!sku) continue;
      const source = await gateway.loadSkuImage(sku).catch(() => '');
      images.set(id, source);
    }
  }));
  return {
    ...plan,
    groups: plan.groups.map((group) => ({
      ...group,
      products: group.products.map((product) => ({
        ...product,
        imageUrl: images.get(product.id) ?? '',
      })),
    })),
  };
}
