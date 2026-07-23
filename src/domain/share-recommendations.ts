import type { DemoState, Sku } from './types';

export interface ShareRecommendationItem {
  sku: Sku;
  supplierCode: string | null;
  lastOutAt: string;
  idleDays: number;
  urgent: boolean;
}

export interface ShareRecommendationGroup {
  supplierCode: string | null;
  items: ShareRecommendationItem[];
}

export interface ShareRecommendationReport {
  date: string;
  daily: ShareRecommendationItem[];
  urgent: ShareRecommendationItem[];
  groups: ShareRecommendationGroup[];
  totalEligible: number;
}

const DAY_MS = 86_400_000;

function witaDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function dateValue(key: string): number {
  return Date.parse(`${key}T00:00:00.000Z`);
}

function eightMonthsBefore(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  const cutoff = new Date(Date.UTC(year, month - 1 - 8, day));
  return cutoff.toISOString().slice(0, 10);
}

export function supplierCodeFromSku(sku: Sku): string | null {
  const pattern = /(?:^|[\s_-])(CH\d+)\s*$/i;
  return (sku.name.match(pattern)?.[1] ?? sku.skuNumber.match(pattern)?.[1])?.toUpperCase() ?? null;
}

export function groupShareRecommendationItems(items: ShareRecommendationItem[]): ShareRecommendationGroup[] {
  const groups = new Map<string | null, ShareRecommendationItem[]>();
  for (const item of items) groups.set(item.supplierCode, [...(groups.get(item.supplierCode) ?? []), item]);
  return [...groups].map(([supplierCode, groupedItems]) => ({ supplierCode, items: groupedItems }));
}

export function buildShareRecommendationReport(state: DemoState, asOf = new Date(), limit = 300): ShareRecommendationReport {
  const date = witaDate(asOf);
  const cutoff = eightMonthsBefore(date);
  const lastSaleBySku = new Map<string, string>();
  for (const transaction of state.notaTransactions) {
    if (transaction.status !== 'completed' || !transaction.completedAt || witaDate(transaction.completedAt) > date) continue;
    for (const skuId of new Set(transaction.postedLines.flatMap((line) => line.skuId ? [line.skuId] : []))) {
      const previous = lastSaleBySku.get(skuId);
      if (!previous || transaction.completedAt > previous) lastSaleBySku.set(skuId, transaction.completedAt);
    }
  }

  const eligible = state.skus
    .filter((sku) => !sku.archived && sku.stock > 0 && witaDate(sku.createdAt) <= date)
    .map((sku): ShareRecommendationItem => {
      const lastOutAt = lastSaleBySku.get(sku.id) ?? sku.createdAt;
      const lastOutDate = witaDate(lastOutAt);
      return {
        sku,
        supplierCode: supplierCodeFromSku(sku),
        lastOutAt,
        idleDays: Math.max(0, Math.floor((dateValue(date) - dateValue(lastOutDate)) / DAY_MS)),
        urgent: lastOutDate < cutoff,
      };
    })
    .sort((left, right) => left.lastOutAt.localeCompare(right.lastOutAt) || left.sku.skuNumber.localeCompare(right.sku.skuNumber, 'id-ID'));
  const safeLimit = Math.min(300, Math.max(0, Math.floor(limit)));
  const daily = eligible.slice(0, safeLimit);
  return {
    date,
    daily,
    urgent: eligible.filter((item) => item.urgent),
    groups: groupShareRecommendationItems(daily),
    totalEligible: eligible.length,
  };
}
