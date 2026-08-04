import type { DemoState, Sku } from './types';

export interface ShareRecommendationItem {
  sku: Sku;
  supplierCode: string | null;
  lastOutAt: string;
  idleDays: number;
  urgent: boolean;
  reasons: ShareRecommendationReason[];
}

export type ShareRecommendationReason = 'new-sku' | 'price-updated' | 'restocked' | 'idle';

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

function sourceDate(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? witaDate(value);
}

function skuCreatedAt(sku: Sku): string {
  return sku.sourceCreatedAt || sku.createdAt;
}

function skuCreatedDate(sku: Sku): string {
  return sku.sourceCreatedAt ? sourceDate(sku.sourceCreatedAt) : witaDate(sku.createdAt);
}

function isWithinFourDayPriority(eventDate: string, date: string): boolean {
  const elapsedDays = Math.floor((dateValue(date) - dateValue(eventDate)) / DAY_MS);
  return elapsedDays >= 0 && elapsedDays < 4;
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

function latestEventBySku<T extends { skuId: string; createdAt: string }>(
  events: T[],
  date: string,
  include: (event: T) => boolean = () => true,
): Map<string, string> {
  const latest = new Map<string, string>();
  for (const event of events) {
    if (!include(event) || witaDate(event.createdAt) > date) continue;
    const previous = latest.get(event.skuId);
    if (!previous || event.createdAt > previous) latest.set(event.skuId, event.createdAt);
  }
  return latest;
}

function roundRobinSuppliers(items: ShareRecommendationItem[], date: string): ShareRecommendationItem[] {
  const groups = new Map<string | null, ShareRecommendationItem[]>();
  for (const item of items) groups.set(item.supplierCode, [...(groups.get(item.supplierCode) ?? []), item]);
  const entries = [...groups.entries()];
  if (entries.length < 2) return items;
  const offset = (Math.floor(dateValue(date) / DAY_MS) + 1) % entries.length;
  const rotated = [...entries.slice(offset), ...entries.slice(0, offset)];
  const result: ShareRecommendationItem[] = [];
  for (let index = 0; result.length < items.length; index += 1) {
    for (const [, group] of rotated) {
      const item = group[index];
      if (item) result.push(item);
    }
  }
  return result;
}

function interleaveUnique(queues: ShareRecommendationItem[][], fallback: ShareRecommendationItem[], limit: number): ShareRecommendationItem[] {
  const selected: ShareRecommendationItem[] = [];
  const selectedIds = new Set<string>();
  const indexes = queues.map(() => 0);
  let progressed = true;
  while (selected.length < limit && progressed) {
    progressed = false;
    for (const [queueIndex, queue] of queues.entries()) {
      while (indexes[queueIndex]! < queue.length && selectedIds.has(queue[indexes[queueIndex]!]!.sku.id)) indexes[queueIndex]! += 1;
      const item = queue[indexes[queueIndex]!];
      if (!item) continue;
      indexes[queueIndex]! += 1;
      selected.push(item);
      selectedIds.add(item.sku.id);
      progressed = true;
      if (selected.length >= limit) break;
    }
  }
  for (const item of fallback) {
    if (selected.length >= limit) break;
    if (selectedIds.has(item.sku.id)) continue;
    selected.push(item);
    selectedIds.add(item.sku.id);
  }
  return selected;
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
  const latestPriceChangeBySku = latestEventBySku(
    state.priceChanges,
    date,
    (change) => change.source !== 'catalogue_import',
  );
  const latestRestockBySku = latestEventBySku(
    state.adjustments,
    date,
    (adjustment) => adjustment.source === 'manual' && adjustment.quantity > 0,
  );

  const newSkuById = new Map(
    state.skus.flatMap((sku) => {
      const createdDate = skuCreatedDate(sku);
      return isWithinFourDayPriority(createdDate, date)
        ? [[sku.id, createdDate] as const]
        : [];
    }),
  );
  const eligible = state.skus
    .filter((sku) => !sku.archived && skuCreatedDate(sku) <= date && (sku.stock > 0 || newSkuById.has(sku.id)))
    .map((sku): ShareRecommendationItem => {
      const lastOutAt = lastSaleBySku.get(sku.id) ?? skuCreatedAt(sku);
      const lastOutDate = witaDate(lastOutAt);
      const idleDays = Math.max(0, Math.floor((dateValue(date) - dateValue(lastOutDate)) / DAY_MS));
      const reasons: ShareRecommendationReason[] = [];
      if (newSkuById.has(sku.id)) reasons.push('new-sku');
      if (latestPriceChangeBySku.has(sku.id)) reasons.push('price-updated');
      if (latestRestockBySku.has(sku.id)) reasons.push('restocked');
      if (idleDays > 0 || reasons.length === 0) reasons.push('idle');
      return {
        sku,
        supplierCode: supplierCodeFromSku(sku),
        lastOutAt,
        idleDays,
        urgent: lastOutDate < cutoff,
        reasons,
      };
    })
    .sort((left, right) => left.lastOutAt.localeCompare(right.lastOutAt) || left.sku.skuNumber.localeCompare(right.sku.skuNumber, 'id-ID'));
  const safeLimit = Math.min(300, Math.max(0, Math.floor(limit)));
  const newSkuQueue = roundRobinSuppliers(
    eligible
      .filter((item) => newSkuById.has(item.sku.id))
      .sort((left, right) => newSkuById.get(right.sku.id)!.localeCompare(newSkuById.get(left.sku.id)!)),
    date,
  );
  const priceQueue = roundRobinSuppliers(
    eligible
      .filter((item) => latestPriceChangeBySku.has(item.sku.id))
      .sort((left, right) => latestPriceChangeBySku.get(right.sku.id)!.localeCompare(latestPriceChangeBySku.get(left.sku.id)!)),
    date,
  );
  const restockQueue = roundRobinSuppliers(
    eligible
      .filter((item) => latestRestockBySku.has(item.sku.id))
      .sort((left, right) => latestRestockBySku.get(right.sku.id)!.localeCompare(latestRestockBySku.get(left.sku.id)!)),
    date,
  );
  const idleQueue = roundRobinSuppliers(
    eligible.filter((item) => !latestPriceChangeBySku.has(item.sku.id) && !latestRestockBySku.has(item.sku.id)),
    date,
  );
  const daily = interleaveUnique(
    [newSkuQueue, priceQueue, restockQueue, idleQueue],
    roundRobinSuppliers(eligible, date),
    safeLimit,
  );
  return {
    date,
    daily,
    urgent: eligible.filter((item) => item.urgent),
    groups: groupShareRecommendationItems(daily),
    totalEligible: eligible.length,
  };
}
