import { buildSkuSalesHistory } from './sku-sales-history';
import { supplierCodeFromSku } from './share-recommendations';
import type { DemoState, Sku } from './types';

export type RestockRecommendationReason = 'zero-stock-recent' | 'top-seller';
export type RestockRecommendationRank = 'green' | 'yellow' | 'red';

export interface RestockRecommendationItem {
  sku: Sku;
  supplierCode: string | null;
  soldPieces30: number;
  soldPieces60: number;
  lastEffectiveSaleAt: string | null;
  recommendedQuantity: number;
  rank: RestockRecommendationRank;
  reasons: RestockRecommendationReason[];
}

export interface RestockRecommendationGroup {
  supplierCode: string | null;
  items: RestockRecommendationItem[];
}

export interface RestockRecommendationReport {
  date: string;
  items: RestockRecommendationItem[];
  groups: RestockRecommendationGroup[];
  eligibleCount: number;
}

interface CandidateSeed {
  sku: Sku;
  supplierCode: string | null;
  soldPieces30: number;
  soldPieces60: number;
  lastEffectiveSaleAt: string | null;
  reasons: RestockRecommendationReason[];
}

function witaDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function wasStocked(state: DemoState, sku: Sku): boolean {
  return sku.stock > 0 ||
    state.adjustments.some((item) =>
      item.skuId === sku.id && (item.before > 0 || item.after > 0)) ||
    state.stockChecks.some((item) =>
      item.skuId === sku.id && (
        item.observedQuantityPcs > 0 ||
        item.countedQuantityPcs > 0 ||
        item.serverQuantityBeforePcs > 0
      ));
}

function comparePerformance(left: CandidateSeed, right: CandidateSeed): number {
  return right.soldPieces30 - left.soldPieces30 ||
    (right.lastEffectiveSaleAt ?? '').localeCompare(left.lastEffectiveSaleAt ?? '') ||
    right.soldPieces60 - left.soldPieces60 ||
    left.sku.skuNumber.localeCompare(right.sku.skuNumber, 'id-ID', { numeric: true });
}

function sameBusinessPerformance(left: CandidateSeed, right: CandidateSeed): boolean {
  return left.soldPieces30 === right.soldPieces30 &&
    left.lastEffectiveSaleAt === right.lastEffectiveSaleAt &&
    left.soldPieces60 === right.soldPieces60;
}

function topSellerIds(eligible: CandidateSeed[]): Set<string> {
  const positive = eligible
    .filter((item) => item.soldPieces30 > 0)
    .sort(comparePerformance);
  if (positive.length === 0) return new Set();
  const count = Math.ceil(positive.length / 3);
  const cutoff = positive[count - 1]!;
  return new Set(
    positive
      .filter((item, index) => index < count || sameBusinessPerformance(item, cutoff))
      .map((item) => item.sku.id),
  );
}

function rankCandidates(items: CandidateSeed[]): Map<string, RestockRecommendationRank> {
  const positive = items
    .filter((item) => item.soldPieces30 > 0)
    .sort(comparePerformance);
  const greenEnd = Math.ceil(positive.length / 3);
  const yellowEnd = Math.ceil((positive.length * 2) / 3);
  const result = new Map<string, RestockRecommendationRank>();
  let index = 0;
  while (index < positive.length) {
    let groupEnd = index + 1;
    while (
      groupEnd < positive.length &&
      sameBusinessPerformance(positive[index]!, positive[groupEnd]!)
    ) groupEnd += 1;
    const rank: RestockRecommendationRank = index < greenEnd
      ? 'green'
      : index < yellowEnd
        ? 'yellow'
        : 'red';
    for (let groupIndex = index; groupIndex < groupEnd; groupIndex += 1) {
      result.set(positive[groupIndex]!.sku.id, rank);
    }
    index = groupEnd;
  }
  for (const item of items) {
    if (item.soldPieces30 <= 0) result.set(item.sku.id, 'red');
  }
  return result;
}

function recommendedQuantity(item: CandidateSeed): number {
  const demand = item.soldPieces30 > 0
    ? item.soldPieces30
    : Math.ceil(item.soldPieces60 / 2);
  const quantity = Math.max(0, Math.ceil(demand) - Math.max(0, item.sku.stock));
  return item.sku.stock <= 0 && item.soldPieces60 > 0
    ? Math.max(1, quantity)
    : quantity;
}

function groupItems(items: RestockRecommendationItem[]): RestockRecommendationGroup[] {
  const groups = new Map<string | null, RestockRecommendationItem[]>();
  for (const item of items) {
    groups.set(item.supplierCode, [...(groups.get(item.supplierCode) ?? []), item]);
  }
  return [...groups]
    .sort(([left], [right]) => {
      if (left === null) return 1;
      if (right === null) return -1;
      return left.localeCompare(right, 'id-ID', { numeric: true });
    })
    .map(([supplierCode, groupedItems]) => ({ supplierCode, items: groupedItems }));
}

export function buildRestockRecommendationReport(
  state: DemoState,
  asOf = new Date(),
): RestockRecommendationReport {
  const sales = buildSkuSalesHistory(state, asOf);
  const eligible = state.skus.flatMap((sku): CandidateSeed[] => {
    const history = sales.get(sku.id);
    if (
      sku.archived ||
      !sku.tracked ||
      !history ||
      history.lifetimeSoldPieces <= 0 ||
      !wasStocked(state, sku)
    ) return [];
    return [{
      sku,
      supplierCode: supplierCodeFromSku(sku),
      soldPieces30: history.soldPieces30,
      soldPieces60: history.soldPieces60,
      lastEffectiveSaleAt: history.lastEffectiveSaleAt,
      reasons: [],
    }];
  });
  const topIds = topSellerIds(eligible);
  const candidates = eligible.flatMap((item): CandidateSeed[] => {
    const zeroStockRecent = item.sku.stock <= 0 && item.soldPieces60 > 0;
    const topSeller = topIds.has(item.sku.id);
    if (!zeroStockRecent && !topSeller) return [];
    return [{
      ...item,
      reasons: [
        ...(zeroStockRecent ? ['zero-stock-recent' as const] : []),
        ...(topSeller ? ['top-seller' as const] : []),
      ],
    }];
  }).sort(comparePerformance);
  const ranks = rankCandidates(candidates);
  const items = candidates.map((item): RestockRecommendationItem => ({
    ...item,
    rank: ranks.get(item.sku.id) ?? 'red',
    recommendedQuantity: recommendedQuantity(item),
  }));
  return {
    date: witaDateKey(asOf),
    items,
    groups: groupItems(items),
    eligibleCount: eligible.length,
  };
}
