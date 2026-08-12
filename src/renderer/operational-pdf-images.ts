import type { OperationalPdfPlan } from '../domain/operational-exports';
import type { Sku } from '../domain/types';
import type { OperationsGateway } from '../gateway/operations-gateway-contract';
import {
  createRecommendationPdfThumbnail,
  type RecommendationThumbnailProcessor,
} from './recommendation-pdf-images';

interface OperationalImageDependencies {
  thumbnail(source: string): Promise<string>;
  onProgress?(completed: number, total: number): void;
}

const OPERATIONAL_PDF_IMAGE_WORKERS = 8;

export function createOperationalPdfThumbnail(
  source: string,
  processor?: RecommendationThumbnailProcessor,
): Promise<string> {
  return createRecommendationPdfThumbnail(source, processor, {
    maxEdge: 96,
    maxBytes: 16 * 1024,
  });
}

export async function hydrateOperationalPdfImages(
  plan: OperationalPdfPlan,
  skus: Sku[],
  gateway: OperationsGateway,
  dependencies: OperationalImageDependencies = {
    thumbnail: createOperationalPdfThumbnail,
  },
): Promise<OperationalPdfPlan> {
  if (plan.dataset !== 'sku-stock') return plan;
  const skuById = new Map(skus.map((sku) => [sku.id, sku]));
  const thumbnails = new Map<string, string>();
  let cursor = 0;
  let completed = 0;
  await Promise.all(Array.from({
    length: Math.min(OPERATIONAL_PDF_IMAGE_WORKERS, plan.rows.length),
  }, async () => {
    while (cursor < plan.rows.length) {
      const row = plan.rows[cursor++];
      if (row?.skuId) {
        const sku = skuById.get(row.skuId);
        if (sku) {
          const source = await gateway.loadSkuImage(sku).catch(() => '');
          const thumbnail = source
            ? await dependencies.thumbnail(source).catch(() => '')
            : '';
          thumbnails.set(row.skuId, thumbnail);
        }
      }
      completed += 1;
      dependencies.onProgress?.(completed, plan.rows.length);
    }
  }));
  return {
    ...plan,
    rows: plan.rows.map((row) => ({
      ...row,
      thumbnailDataUrl: row.skuId ? thumbnails.get(row.skuId) ?? '' : '',
    })),
  };
}
