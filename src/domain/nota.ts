import type { DemoState, Nota, NotaLine, Unit } from './types';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function noteSuffixFromIndex(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error('Index nota tidak valid.');
  let value = index + 1;
  let suffix = '';
  while (value > 0) { value -= 1; suffix = alphabet[value % 26] + suffix; value = Math.floor(value / 26); }
  return suffix;
}

export function suggestedPrice(referencePrice: number, unit: Unit): number { return unit === 'lsn' ? referencePrice * 12 : referencePrice; }
export function lineTotal(line: NotaLine): number { return Math.max(0, line.quantity) * Math.max(0, line.unitPrice); }
export function linePieces(line: NotaLine): number { return line.quantity * (line.unit === 'lsn' ? 12 : 1); }

export function createDraftNota(sequence: number): Nota {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return {
    id: `nota-${Date.now()}-${sequence}`,
    number: `CHU-${date.replaceAll('-', '')}-${String(sequence).padStart(4, '0')}`,
    suffix: noteSuffixFromIndex(0), customerName: '', transactionDate: date, payment: 'unclassified', status: 'draft',
    lines: Array.from({ length: 15 }, (_, index) => ({ id: `line-${Date.now()}-${sequence}-${index}`, description: '', quantity: 0, unit: 'pcs' as const, unitPrice: 0 })),
    postedLines: [],
  };
}

function validateLines(lines: NotaLine[]): NotaLine[] {
  const active = lines.filter((line) => line.description.trim() || line.skuId || line.quantity || line.unitPrice);
  if (!active.length) throw new Error('Nota harus memiliki setidaknya satu baris.');
  for (const line of active) {
    if (!line.description.trim()) throw new Error('Nama barang wajib diisi.');
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new Error('Jumlah harus bilangan bulat positif.');
    if (!Number.isInteger(line.unitPrice) || line.unitPrice < 0) throw new Error('Harga harus bilangan bulat nol atau lebih.');
  }
  return active;
}

function stockEffects(state: DemoState, lines: NotaLine[]): Map<string, number> {
  const effects = new Map<string, number>();
  for (const line of lines) {
    if (!line.skuId || !state.skus.find((sku) => sku.id === line.skuId)?.tracked) continue;
    effects.set(line.skuId, (effects.get(line.skuId) ?? 0) + linePieces(line));
  }
  return effects;
}

function applyStockDelta(state: DemoState, notaId: string, delta: Map<string, number>, direction: -1 | 1): DemoState {
  let skus = state.skus;
  let adjustments = state.adjustments;
  delta.forEach((pieces, skuId) => {
    const sku = skus.find((candidate) => candidate.id === skuId);
    if (!sku) return;
    const quantity = pieces * direction;
    const after = sku.stock + quantity;
    skus = skus.map((candidate) => candidate.id === skuId ? { ...candidate, stock: after } : candidate);
    adjustments = [...adjustments, { id: `adj-${notaId}-${adjustments.length}`, skuId, quantity, before: sku.stock, after, createdAt: new Date().toISOString(), source: direction === -1 ? 'nota' : 'reversal' }];
  });
  return { ...state, skus, adjustments };
}

export function completeNota(state: DemoState, notaId: string): DemoState {
  const nota = state.notas.find((item) => item.id === notaId);
  if (!nota || !['draft', 'reopened'].includes(nota.status)) return state;
  const active = validateLines(nota.lines);
  const current = stockEffects(state, active);
  const previous = stockEffects(state, nota.postedLines);
  const delta = new Map<string, number>();
  new Set([...current.keys(), ...previous.keys()]).forEach((skuId) => delta.set(skuId, (current.get(skuId) ?? 0) - (previous.get(skuId) ?? 0)));
  let next = applyStockDelta(state, notaId, delta, -1);
  next = { ...next, notas: next.notas.map((item) => item.id === notaId ? { ...item, status: 'completed', completedAt: new Date().toISOString(), lines: nota.lines, postedLines: active.map((line) => ({ ...line })) } : item) };
  return next;
}

export function reopenNota(state: DemoState, notaId: string): DemoState {
  return { ...state, notas: state.notas.map((nota) => nota.id === notaId && nota.status === 'completed' ? { ...nota, status: 'reopened' } : nota) };
}

export function cancelNota(state: DemoState, notaId: string): DemoState {
  const nota = state.notas.find((item) => item.id === notaId);
  if (!nota || nota.status !== 'completed') return state;
  const next = applyStockDelta(state, notaId, stockEffects(state, nota.postedLines), 1);
  return { ...next, notas: next.notas.map((item) => item.id === notaId ? { ...item, status: 'cancelled' } : item) };
}

export function restoreNota(state: DemoState, notaId: string): DemoState {
  const nota = state.notas.find((item) => item.id === notaId);
  if (!nota || nota.status !== 'cancelled') return state;
  const next = applyStockDelta(state, notaId, stockEffects(state, nota.postedLines), -1);
  return { ...next, notas: next.notas.map((item) => item.id === notaId ? { ...item, status: 'completed', completedAt: new Date().toISOString() } : item) };
}
