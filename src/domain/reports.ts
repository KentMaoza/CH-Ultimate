import { linePieces, lineTotal } from './nota';
import type {
  DemoState,
  EmptyStockItem,
  NotaLine,
  NotaPosting,
  RevenuePosting,
  RevenueReport,
} from './types';

interface RevenueContribution {
  skuId: string;
  name: string;
  units: number;
  revenue: number;
}

const UNLINKED_SKU_ID = '__unlinked__';
const UNLINKED_SKU_NAME = 'Tanpa SKU';

function dateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { year: get('year'), month: get('month'), day: get('day'), key: `${get('year')}-${get('month')}-${get('day')}` };
}

function addContribution(
  target: Map<string, RevenueContribution>,
  contribution: RevenueContribution,
  direction = 1,
) {
  const current = target.get(contribution.skuId) ?? {
    skuId: contribution.skuId,
    name: contribution.name,
    units: 0,
    revenue: 0,
  };
  current.units += contribution.units * direction;
  current.revenue += contribution.revenue * direction;
  target.set(contribution.skuId, current);
}

function snapshotContributions(
  state: DemoState,
  lines: NotaLine[],
): Map<string, RevenueContribution> {
  const result = new Map<string, RevenueContribution>();
  for (const line of lines) {
    const sku = line.skuId
      ? state.skus.find((item) => item.id === line.skuId)
      : undefined;
    addContribution(result, {
      skuId: sku?.id ?? UNLINKED_SKU_ID,
      name: sku?.name ?? UNLINKED_SKU_NAME,
      units: linePieces(line),
      revenue: lineTotal(line),
    });
  }
  return result;
}

function postingContributions(
  state: DemoState,
  revenuePosting: RevenuePosting,
  notaPosting: NotaPosting | undefined,
): Map<string, RevenueContribution> {
  const result = new Map<string, RevenueContribution>();
  if (notaPosting) {
    const current = snapshotContributions(state, notaPosting.lines);
    if (notaPosting.postingKind.includes('reversal')) {
      for (const contribution of current.values()) {
        addContribution(result, contribution, -1);
      }
    } else if (notaPosting.postingKind === 'recomplete') {
      const previous = [...(state.notaPostings ?? [])]
        .filter((candidate) =>
          candidate.notaId === notaPosting.notaId &&
          ['complete', 'recomplete', 'restore'].includes(candidate.postingKind) &&
          BigInt(candidate.lifecycleVersion) < BigInt(notaPosting.lifecycleVersion))
        .sort((left, right) =>
          BigInt(left.lifecycleVersion) < BigInt(right.lifecycleVersion) ? 1 : -1)
        .at(0);
      for (const contribution of current.values()) {
        addContribution(result, contribution);
      }
      for (const contribution of snapshotContributions(state, previous?.lines ?? []).values()) {
        addContribution(result, contribution, -1);
      }
    } else if (['complete', 'restore'].includes(notaPosting.postingKind)) {
      for (const contribution of current.values()) {
        addContribution(result, contribution);
      }
    }
  }

  const attributedRevenue = [...result.values()]
    .reduce((sum, contribution) => sum + contribution.revenue, 0);
  const unattributedRevenue = revenuePosting.amountRupiah - attributedRevenue;
  if (unattributedRevenue !== 0) {
    addContribution(result, {
      skuId: UNLINKED_SKU_ID,
      name: UNLINKED_SKU_NAME,
      units: 0,
      revenue: unattributedRevenue,
    });
  }
  return result;
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
    const notaPostingsById = new Map(
      state.notaPostings.map((posting) => [posting.id, posting]),
    );
    for (const posting of state.revenuePostings) {
      const posted = dateParts(new Date(posting.postedAt));
      if ((range.from && posted.key < range.from) || (range.to && posted.key > range.to)) continue;
      if (posted.year === now.year) year += posting.amountRupiah;
      if (posted.year === now.year && posted.month === now.month) month += posting.amountRupiah;
      if (posted.key === now.key) today += posting.amountRupiah;
      byDay.set(posted.key, (byDay.get(posted.key) ?? 0) + posting.amountRupiah);
      const notaPosting = notaPostingsById.get(posting.notaPostingId);
      for (const contribution of postingContributions(
        state,
        posting,
        notaPosting,
      ).values()) {
        addContribution(bySku, contribution);
      }
    }
    return {
      today,
      month,
      year,
      bySku: [...bySku.values()]
        .filter((item) => item.units !== 0 || item.revenue !== 0)
        .sort((a, b) => b.revenue - a.revenue),
      byDay: [...byDay]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, revenue]) => ({ date, revenue })),
    };
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
