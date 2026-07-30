import { linePieces, lineTotal } from './nota';
import type { DemoState, EmptyStockItem, RevenueReport } from './types';

function dateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { year: get('year'), month: get('month'), day: get('day'), key: `${get('year')}-${get('month')}-${get('day')}` };
}

export function buildRevenueReport(
  state: DemoState,
  asOf = new Date(),
  range: { from?: string; to?: string } = {},
): RevenueReport {
  const now = dateParts(asOf);
  let today = 0; let month = 0; let year = 0;
  const bySku = new Map<string, { skuId: string; name: string; units: number; revenue: number }>();
  const byDay = new Map<string, number>();
  if (state.revenuePostings && state.notaPostings) {
    for (const posting of state.revenuePostings) {
      const posted = dateParts(new Date(posting.postedAt));
      if ((range.from && posted.key < range.from) || (range.to && posted.key > range.to)) continue;
      if (posted.year === now.year) year += posting.amountRupiah;
      if (posted.year === now.year && posted.month === now.month) month += posting.amountRupiah;
      if (posted.key === now.key) today += posting.amountRupiah;
      byDay.set(posted.key, (byDay.get(posted.key) ?? 0) + posting.amountRupiah);
    }
    const netByNota = new Map<string, number>();
    for (const posting of state.revenuePostings) {
      netByNota.set(
        posting.notaId,
        (netByNota.get(posting.notaId) ?? 0) + posting.amountRupiah,
      );
    }
    for (const [notaId, netRevenue] of netByNota) {
      if (netRevenue <= 0) continue;
      const posting = [...state.notaPostings]
        .filter((item) =>
          item.notaId === notaId &&
          ['complete', 'recomplete', 'restore'].includes(item.postingKind))
        .sort((left, right) =>
          BigInt(left.lifecycleVersion) < BigInt(right.lifecycleVersion) ? 1 : -1)
        .at(0);
      if (!posting) continue;
      const posted = dateParts(new Date(posting.postedAt));
      if ((range.from && posted.key < range.from) || (range.to && posted.key > range.to)) continue;
      for (const line of posting.lines) {
        if (!line.skuId) continue;
        const sku = state.skus.find((item) => item.id === line.skuId);
        if (!sku) continue;
        const entry = bySku.get(sku.id) ?? { skuId: sku.id, name: sku.name, units: 0, revenue: 0 };
        entry.units += linePieces(line);
        entry.revenue += lineTotal(line);
        bySku.set(sku.id, entry);
      }
    }
    return { today, month, year, bySku: [...bySku.values()].sort((a, b) => b.revenue - a.revenue), byDay: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, revenue]) => ({ date, revenue })) };
  }
  for (const transaction of state.notaTransactions.filter((item) => item.status === 'completed' && item.completedAt)) {
    const completed = dateParts(new Date(transaction.completedAt!));
    if ((range.from && completed.key < range.from) || (range.to && completed.key > range.to)) continue;
    const lines = transaction.pages.filter((page) => page.status === 'active').flatMap((page) => page.lines);
    const total = lines.reduce((sum, line) => sum + lineTotal(line), 0);
    if (completed.year === now.year) year += total;
    if (completed.year === now.year && completed.month === now.month) month += total;
    if (completed.key === now.key) today += total;
    byDay.set(completed.key, (byDay.get(completed.key) ?? 0) + total);
    for (const line of lines) {
      if (!line.skuId) continue;
      const sku = state.skus.find((item) => item.id === line.skuId);
      if (!sku) continue;
      const entry = bySku.get(sku.id) ?? { skuId: sku.id, name: sku.name, units: 0, revenue: 0 };
      entry.units += linePieces(line); entry.revenue += lineTotal(line); bySku.set(sku.id, entry);
    }
  }
  return { today, month, year, bySku: [...bySku.values()].sort((a, b) => b.revenue - a.revenue), byDay: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, revenue]) => ({ date, revenue })) };
}

export function buildEmptyStockItems(state: DemoState, maximumStock = 0): EmptyStockItem[] {
  return state.skus.filter((sku) => sku.tracked && !sku.archived && sku.stock <= maximumStock).sort((a, b) => a.stock - b.stock || a.skuNumber.localeCompare(b.skuNumber)).map((sku) => ({ sku, selected: false }));
}
