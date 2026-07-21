import type { DemoState, Nota, NotaLine, NotaTransaction, Unit } from './types';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function witaDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function noteSuffixFromIndex(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error('Index nota tidak valid.');
  let value = index + 1;
  let suffix = '';
  while (value > 0) { value -= 1; suffix = alphabet[value % 26] + suffix; value = Math.floor(value / 26); }
  return suffix;
}

export function suggestedPrice(referencePrice: number, unit: Unit): number { return unit === 'lsn' ? referencePrice * 12 : referencePrice; }
export function selectedPrice(line: NotaLine): number { return line.unit === 'pcs' ? line.pcsPrice : line.lsnPrice; }
export function lineTotal(line: NotaLine): number { return Math.max(0, line.quantity) * Math.max(0, selectedPrice(line)); }
export function linePieces(line: NotaLine): number { return line.quantity * (line.unit === 'lsn' ? 12 : 1); }

function createPage(sequence: number, pageIndex: number): Nota {
  const stamp = Date.now();
  return {
    id: `nota-page-${stamp}-${sequence}-${pageIndex}`,
    suffix: noteSuffixFromIndex(pageIndex),
    status: 'active',
    lines: Array.from({ length: 15 }, (_, lineIndex) => ({
      id: `nota-line-${stamp}-${sequence}-${pageIndex}-${lineIndex}`,
      description: '', kind: '', quantity: 0, unit: 'pcs' as const, pcsPrice: 0, lsnPrice: 0,
    })),
  };
}

export function createDraftNotaTransaction(sequence: number): NotaTransaction {
  const date = witaDate();
  return {
    id: `nota-transaction-${Date.now()}-${sequence}`,
    baseNumber: `CHU-${date.replaceAll('-', '')}-${String(sequence).padStart(4, '0')}`,
    customerName: '', customerPlace: '', transactionDate: date, payment: 'unclassified', status: 'draft',
    nextNoteIndex: 1, pages: [createPage(sequence, 0)], postedLines: [], postedStockEffects: {}, postedTrackedLineIds: {},
  };
}

export function addNotaPage(state: DemoState, transactionId: string): DemoState {
  const transaction = state.notaTransactions.find((item) => item.id === transactionId);
  if (!transaction || !['draft', 'reopened'].includes(transaction.status)) return state;
  const page = createPage(transaction.nextNoteIndex, transaction.nextNoteIndex);
  return {
    ...state,
    notaTransactions: state.notaTransactions.map((item) => item.id === transactionId
      ? { ...item, pages: [...item.pages, page], nextNoteIndex: item.nextNoteIndex + 1 }
      : item),
  };
}

export function cancelNotaPage(state: DemoState, transactionId: string, pageId: string): DemoState {
  const transaction = state.notaTransactions.find((item) => item.id === transactionId);
  const page = transaction?.pages.find((item) => item.id === pageId);
  if (!transaction || !['draft', 'reopened'].includes(transaction.status) || page?.status !== 'active' || transaction.pages.filter((item) => item.status === 'active').length < 2) return state;
  return {
    ...state,
    notaTransactions: state.notaTransactions.map((item) => item.id === transactionId
      ? { ...item, pages: item.pages.map((page) => page.id === pageId ? { ...page, status: 'cancelled' } : page) }
      : item),
  };
}

export function restoreNotaPage(state: DemoState, transactionId: string, pageId: string): DemoState {
  const transaction = state.notaTransactions.find((item) => item.id === transactionId);
  const page = transaction?.pages.find((item) => item.id === pageId);
  if (!transaction || !['draft', 'reopened'].includes(transaction.status) || page?.status !== 'cancelled') return state;
  return {
    ...state,
    notaTransactions: state.notaTransactions.map((item) => item.id === transactionId
      ? { ...item, pages: item.pages.map((page) => page.id === pageId ? { ...page, status: 'active' } : page) }
      : item),
  };
}

export function deleteNotaLine(state: DemoState, transactionId: string, pageId: string, lineId: string): DemoState {
  const transaction = state.notaTransactions.find((item) => item.id === transactionId);
  const page = transaction?.pages.find((item) => item.id === pageId);
  if (!transaction || !['draft', 'reopened'].includes(transaction.status) || page?.status !== 'active' || !page.lines.some((line) => line.id === lineId)) return state;
  const lines = page.lines.filter((line) => line.id !== lineId);
  const blank: NotaLine = { id: `nota-line-${Date.now()}-replacement-${lineId}`, description: '', kind: '', quantity: 0, unit: 'pcs', pcsPrice: 0, lsnPrice: 0 };
  return {
    ...state,
    notaTransactions: state.notaTransactions.map((item) => item.id === transactionId ? {
      ...item,
      pages: item.pages.map((candidate) => candidate.id === pageId ? { ...candidate, lines: [...lines, blank].slice(0, 15) } : candidate),
    } : item),
  };
}

function activeLines(transaction: NotaTransaction): NotaLine[] {
  return transaction.pages.filter((page) => page.status === 'active').flatMap((page) => page.lines);
}

function populated(line: NotaLine): boolean {
  return Boolean(line.skuId || line.description.trim() || line.kind.trim() || line.quantity || line.pcsPrice || line.lsnPrice);
}

function validateLines(lines: NotaLine[]): NotaLine[] {
  const active = lines.filter(populated);
  if (!active.length) throw new Error('Nota harus memiliki setidaknya satu baris.');
  for (const line of active) {
    if (!line.description.trim()) throw new Error('Nama barang wajib diisi.');
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new Error('Jumlah harus bilangan bulat positif.');
    if (!Number.isInteger(line.pcsPrice) || line.pcsPrice < 0 || !Number.isInteger(line.lsnPrice) || line.lsnPrice < 0) throw new Error('Harga harus bilangan bulat nol atau lebih.');
  }
  return active;
}

function effectsFromSnapshot(snapshot: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(snapshot));
}

function effectsForTrackedLines(lines: NotaLine[], trackedLineIds: Record<string, string>): Map<string, number> {
  const effects = new Map<string, number>();
  for (const line of lines) {
    if (!line.skuId || trackedLineIds[line.id] !== line.skuId) continue;
    effects.set(line.skuId, (effects.get(line.skuId) ?? 0) + linePieces(line));
  }
  return effects;
}

function trackedLineIdsForPost(state: DemoState, lines: NotaLine[], transaction?: NotaTransaction): Record<string, string> {
  const previousLines = new Map(transaction?.postedLines.map((line) => [line.id, line]) ?? []);
  const trackedLineIds: Record<string, string> = {};
  for (const line of lines) {
    if (!line.skuId) continue;
    const previous = previousLines.get(line.id);
    const tracked = previous?.skuId === line.skuId
      ? transaction?.postedTrackedLineIds[line.id] === line.skuId
      : Boolean(state.skus.find((sku) => sku.id === line.skuId)?.tracked);
    if (tracked) trackedLineIds[line.id] = line.skuId;
  }
  return trackedLineIds;
}

function applyStockDelta(state: DemoState, transactionId: string, delta: Map<string, number>, direction: -1 | 1): DemoState {
  let skus = state.skus;
  let adjustments = state.adjustments;
  delta.forEach((pieces, skuId) => {
    if (!pieces) return;
    const sku = skus.find((candidate) => candidate.id === skuId);
    if (!sku) return;
    const quantity = pieces * direction;
    const after = sku.stock + quantity;
    skus = skus.map((candidate) => candidate.id === skuId ? { ...candidate, stock: after } : candidate);
    adjustments = [...adjustments, {
      id: `adj-${transactionId}-${adjustments.length}`, skuId, quantity, before: sku.stock, after,
      createdAt: new Date().toISOString(), source: direction === -1 ? 'nota' : 'reversal',
    }];
  });
  return { ...state, skus, adjustments };
}

function difference(current: Map<string, number>, previous: Map<string, number>): Map<string, number> {
  const delta = new Map<string, number>();
  new Set([...current.keys(), ...previous.keys()]).forEach((skuId) => delta.set(skuId, (current.get(skuId) ?? 0) - (previous.get(skuId) ?? 0)));
  return delta;
}

export function completeNotaTransaction(state: DemoState, transactionId: string): DemoState {
  const transaction = state.notaTransactions.find((item) => item.id === transactionId);
  if (!transaction || !['draft', 'reopened'].includes(transaction.status)) return state;
  const postedLines = validateLines(activeLines(transaction));
  const trackedLineIds = trackedLineIdsForPost(state, postedLines, transaction.status === 'reopened' ? transaction : undefined);
  const currentEffects = effectsForTrackedLines(postedLines, trackedLineIds);
  const delta = difference(currentEffects, effectsFromSnapshot(transaction.postedStockEffects));
  const next = applyStockDelta(state, transactionId, delta, -1);
  return {
    ...next,
    notaTransactions: next.notaTransactions.map((item) => item.id === transactionId ? {
      ...item, status: 'completed', completedAt: new Date().toISOString(),
      postedLines: postedLines.map((line) => ({ ...line })), postedStockEffects: Object.fromEntries(currentEffects), postedTrackedLineIds: trackedLineIds, cancelledFromStatus: undefined,
    } : item),
  };
}

export function reopenNotaTransaction(state: DemoState, transactionId: string): DemoState {
  return {
    ...state,
    notaTransactions: state.notaTransactions.map((transaction) => transaction.id === transactionId && transaction.status === 'completed'
      ? { ...transaction, status: 'reopened' }
      : transaction),
  };
}

export function cancelNotaTransaction(state: DemoState, transactionId: string): DemoState {
  const transaction = state.notaTransactions.find((item) => item.id === transactionId);
  if (!transaction || transaction.status === 'cancelled') return state;
  const cancelledFromStatus = transaction.status;
  const next = transaction.status === 'draft'
    ? state
    : applyStockDelta(state, transactionId, effectsFromSnapshot(transaction.postedStockEffects), 1);
  return {
    ...next,
    notaTransactions: next.notaTransactions.map((item) => item.id === transactionId ? {
      ...item, status: 'cancelled', cancelledFromStatus,
    } : item),
  };
}

export function restoreNotaTransaction(state: DemoState, transactionId: string): DemoState {
  const transaction = state.notaTransactions.find((item) => item.id === transactionId);
  if (!transaction || transaction.status !== 'cancelled') return state;
  if (transaction.cancelledFromStatus === 'draft') {
    return {
      ...state,
      notaTransactions: state.notaTransactions.map((item) => item.id === transactionId
        ? { ...item, status: 'draft', cancelledFromStatus: undefined }
        : item),
    };
  }
  const restoredStatus = transaction.cancelledFromStatus;
  if (restoredStatus !== 'completed' && restoredStatus !== 'reopened') return state;
  const next = applyStockDelta(state, transactionId, effectsFromSnapshot(transaction.postedStockEffects), -1);
  return {
    ...next,
    notaTransactions: next.notaTransactions.map((item) => item.id === transactionId
      ? { ...item, status: restoredStatus, cancelledFromStatus: undefined }
      : item),
  };
}
