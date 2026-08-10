import type { RecommendationPdfPlan } from '../domain/recommendation-pdf';
import type { Sku } from '../domain/types';
import { imageBlobToDataUrl } from '../gateway/core-image-cache';
import type { OperationsGateway } from '../gateway/operations-gateway-contract';

const MAX_THUMBNAIL_EDGE = 320;
const MAX_THUMBNAIL_BYTES = 96 * 1024;
const THUMBNAIL_QUALITIES = [0.8, 0.6, 0.4];

interface DecodedRecommendationImage {
  width: number;
  height: number;
  source: CanvasImageSource;
  close?: () => void;
}

export interface RecommendationThumbnailProcessor {
  decode(source: string): Promise<DecodedRecommendationImage>;
  encode(
    source: CanvasImageSource,
    width: number,
    height: number,
    quality: number,
  ): Promise<Blob>;
}

interface RecommendationImageDependencies {
  thumbnail: (source: string) => Promise<string>;
}

export interface PdfThumbnailLimits {
  maxEdge: number;
  maxBytes: number;
}

const RECOMMENDATION_THUMBNAIL_LIMITS: PdfThumbnailLimits = {
  maxEdge: MAX_THUMBNAIL_EDGE,
  maxBytes: MAX_THUMBNAIL_BYTES,
};

const browserThumbnailProcessor: RecommendationThumbnailProcessor = {
  async decode(source) {
    const response = await fetch(source);
    if (!response.ok) throw new Error('Gambar rekomendasi tidak dapat dibuka.');
    const bitmap = await createImageBitmap(
      await response.blob(),
      { imageOrientation: 'from-image' },
    );
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      close: () => bitmap.close(),
    };
  },
  async encode(source, width, height, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Thumbnail rekomendasi tidak dapat dibuat.');
    context.drawImage(source, 0, 0, width, height);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob
          ? resolve(blob)
          : reject(new Error('Thumbnail rekomendasi tidak dapat dikompresi.')),
        'image/jpeg',
        quality,
      );
    });
  },
};

export async function createRecommendationPdfThumbnail(
  source: string,
  processor: RecommendationThumbnailProcessor = browserThumbnailProcessor,
  limits: PdfThumbnailLimits = RECOMMENDATION_THUMBNAIL_LIMITS,
): Promise<string> {
  const decoded = await processor.decode(source);
  try {
    const scale = Math.min(
      1,
      limits.maxEdge / Math.max(decoded.width, decoded.height),
    );
    let width = Math.max(1, Math.round(decoded.width * scale));
    let height = Math.max(1, Math.round(decoded.height * scale));
    while (width >= 64 || height >= 64) {
      for (const quality of THUMBNAIL_QUALITIES) {
        const thumbnail = await processor.encode(
          decoded.source,
          width,
          height,
          quality,
        );
        if (thumbnail.size <= limits.maxBytes) {
          return imageBlobToDataUrl(thumbnail);
        }
      }
      width = Math.max(1, Math.round(width * 0.75));
      height = Math.max(1, Math.round(height * 0.75));
    }
    throw new Error('Thumbnail rekomendasi melebihi batas memori.');
  } finally {
    decoded.close?.();
  }
}

export async function hydrateRecommendationPdfImages(
  plan: RecommendationPdfPlan,
  skus: Sku[],
  gateway: OperationsGateway,
  dependencies: RecommendationImageDependencies = {
    thumbnail: createRecommendationPdfThumbnail,
  },
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
      const thumbnail = source
        ? await dependencies.thumbnail(source).catch(() => '')
        : '';
      images.set(id, thumbnail);
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
