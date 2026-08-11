import type {
  RestockRecommendationItem,
  RestockRecommendationRank,
} from './restock-recommendations';

export interface RestockRecommendationDocumentItem {
  id: string;
  skuId: string;
  name: string;
  quantity: number;
  rank: RestockRecommendationRank;
  thumbnailDataUrl: string;
}

export interface RestockRecommendationDocumentPage {
  supplierCode: string | null;
  items: RestockRecommendationDocumentItem[];
}

export interface RestockRecommendationDocumentPlan {
  kind: 'restock-recommendation';
  widthMm: 210;
  heightMm: 297;
  fileName: string;
  generatedDate: string;
  totalItems: number;
  pages: RestockRecommendationDocumentPage[];
}

const ITEMS_PER_PAGE = 8;

export function buildRestockRecommendationDocumentPlan(
  recommendations: RestockRecommendationItem[],
  quantities: Record<string, number>,
  generatedDate: string,
): RestockRecommendationDocumentPlan {
  const grouped = new Map<string | null, RestockRecommendationDocumentItem[]>();
  for (const recommendation of recommendations) {
    const quantity = Math.max(0, Math.floor(quantities[recommendation.sku.id] ?? 0));
    if (quantity === 0) continue;
    const item: RestockRecommendationDocumentItem = {
      id: recommendation.sku.id,
      skuId: recommendation.sku.id,
      name: recommendation.sku.name,
      quantity,
      rank: recommendation.rank,
      thumbnailDataUrl: '',
    };
    grouped.set(
      recommendation.supplierCode,
      [...(grouped.get(recommendation.supplierCode) ?? []), item],
    );
  }
  const pages = [...grouped].flatMap(([supplierCode, items]) =>
    Array.from({ length: Math.ceil(items.length / ITEMS_PER_PAGE) }, (_, index) => ({
      supplierCode,
      items: items.slice(index * ITEMS_PER_PAGE, (index + 1) * ITEMS_PER_PAGE),
    })));
  return {
    kind: 'restock-recommendation',
    widthMm: 210,
    heightMm: 297,
    fileName: `CHU-Rekomendasi-Restock-${generatedDate}.pdf`,
    generatedDate,
    totalItems: pages.reduce((sum, page) => sum + page.items.length, 0),
    pages,
  };
}
