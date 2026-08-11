import { linePieces } from './nota';
import type { DemoState, NotaLine, NotaPosting } from './types';

export interface SkuSalesHistory {
  skuId: string;
  lifetimeSoldPieces: number;
  soldPieces30: number;
  soldPieces60: number;
  lastEffectiveSaleAt: string | null;
}

interface SalesEvent {
  notaId: string;
  postedAt: string;
  piecesBySku: Map<string, number>;
  effectivePiecesBySku?: Map<string, number>;
}

function witaDateKey(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function addLines(target: Map<string, number>, lines: NotaLine[], direction = 1): void {
  for (const item of lines) {
    if (!item.skuId) continue;
    target.set(item.skuId, (target.get(item.skuId) ?? 0) + (linePieces(item) * direction));
  }
}

function snapshotLines(lines: NotaLine[]): Map<string, number> {
  const result = new Map<string, number>();
  addLines(result, lines);
  return result;
}

function previousEffectivePosting(
  postings: NotaPosting[],
  current: NotaPosting,
): NotaPosting | undefined {
  return postings
    .filter((candidate) =>
      candidate.notaId === current.notaId &&
      ['complete', 'recomplete', 'restore'].includes(candidate.postingKind) &&
      BigInt(candidate.lifecycleVersion) < BigInt(current.lifecycleVersion))
    .sort((left, right) =>
      BigInt(left.lifecycleVersion) < BigInt(right.lifecycleVersion) ? 1 : -1)
    .at(0);
}

function postingPieces(postings: NotaPosting[], posting: NotaPosting): Map<string, number> {
  const result = new Map<string, number>();
  if (posting.postingKind.includes('reversal')) {
    addLines(result, posting.lines, -1);
  } else if (posting.postingKind === 'recomplete') {
    addLines(result, posting.lines);
    addLines(result, previousEffectivePosting(postings, posting)?.lines ?? [], -1);
  } else if (['complete', 'restore'].includes(posting.postingKind)) {
    addLines(result, posting.lines);
  }
  return result;
}

function postingEvents(state: DemoState): SalesEvent[] {
  const postings = state.notaPostings ?? [];
  const postingById = new Map(postings.map((posting) => [posting.id, posting]));
  return (state.revenuePostings ?? []).flatMap((revenue) => {
    const posting = postingById.get(revenue.notaPostingId);
    if (!posting) return [];
    const replacesEffectiveSnapshot = posting.postingKind.includes('reversal') ||
      ['complete', 'recomplete', 'restore'].includes(posting.postingKind);
    return [{
      notaId: posting.notaId,
      postedAt: revenue.postedAt,
      piecesBySku: postingPieces(postings, posting),
      effectivePiecesBySku: replacesEffectiveSnapshot
        ? posting.postingKind.includes('reversal')
          ? new Map()
          : snapshotLines(posting.lines)
        : undefined,
    }];
  });
}

function transactionEvents(state: DemoState): SalesEvent[] {
  return state.notaTransactions.flatMap((transaction) => {
    if (transaction.status !== 'completed' || !transaction.completedAt) return [];
    const piecesBySku = new Map<string, number>();
    addLines(
      piecesBySku,
      transaction.pages
        .filter((page) => page.status === 'active')
        .flatMap((page) => page.lines),
    );
    return [{
      notaId: transaction.id,
      postedAt: transaction.completedAt,
      piecesBySku,
      effectivePiecesBySku: new Map(piecesBySku),
    }];
  });
}

export function buildSkuSalesHistory(
  state: DemoState,
  asOf = new Date(),
): Map<string, SkuSalesHistory> {
  const reportDate = witaDateKey(asOf);
  const start30 = shiftDateKey(reportDate, -29);
  const start60 = shiftDateKey(reportDate, -59);
  const authoritative = state.notaPostings !== undefined && state.revenuePostings !== undefined;
  const events = authoritative ? postingEvents(state) : transactionEvents(state);
  const result = new Map<string, SkuSalesHistory>();
  const effectiveSnapshots = new Map<string, {
    postedAt: string;
    piecesBySku: Map<string, number>;
  }>();

  for (const event of events.sort((left, right) =>
    left.postedAt.localeCompare(right.postedAt))) {
    const eventDate = witaDateKey(event.postedAt);
    if (eventDate > reportDate) continue;
    if (event.effectivePiecesBySku !== undefined) {
      effectiveSnapshots.set(event.notaId, {
        postedAt: event.postedAt,
        piecesBySku: event.effectivePiecesBySku,
      });
    }
    for (const [skuId, pieces] of event.piecesBySku) {
      if (pieces === 0) continue;
      const current = result.get(skuId) ?? {
        skuId,
        lifetimeSoldPieces: 0,
        soldPieces30: 0,
        soldPieces60: 0,
        lastEffectiveSaleAt: null,
      };
      current.lifetimeSoldPieces += pieces;
      if (eventDate >= start60) current.soldPieces60 += pieces;
      if (eventDate >= start30) current.soldPieces30 += pieces;
      result.set(skuId, current);
    }
  }

  for (const snapshot of effectiveSnapshots.values()) {
    for (const [skuId, pieces] of snapshot.piecesBySku) {
      if (pieces <= 0) continue;
      const current = result.get(skuId);
      if (
        current &&
        (!current.lastEffectiveSaleAt || snapshot.postedAt > current.lastEffectiveSaleAt)
      ) current.lastEffectiveSaleAt = snapshot.postedAt;
    }
  }

  return result;
}
