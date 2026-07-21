import type { DemoState, Sku } from './types';

export type Operation =
  | { type: 'update-sku'; id: string; patch: Partial<Omit<Sku, 'id' | 'aliases'>> }
  | { type: 'adjust-stock'; id: string; quantity: number }
  | { type: 'archive-sku'; id: string; archived: boolean }
  | { type: 'add-sku'; sku: Sku }
  | { type: 'replace-skus'; skus: Sku[]; sourceLabel: string; importSummary: DemoState['importSummary'] };

export function createInitialState(): DemoState {
  const createdAt = '2026-07-18T02:00:00.000Z';
  const fixture = [
    ['sku-1', 'BRS-108-BLK', 'Beras Hitam Premium 1 kg', 42000, 24, 'Rak A-03', true],
    ['sku-2', 'FSH-LINEN-WHT', 'Kemeja Linen Putih', 185000, 0, 'Fashion / tidak dilacak', false],
    ['sku-3', 'ACC-204-SLV', 'Aksesori Silver', 27500, -3, 'Perlu restock', true],
    ['sku-4', 'MNM-002', 'Minuman Serbuk Cokelat', 18000, 16, 'Rak B-11', true],
    ['sku-5', 'SNK-044', 'Keripik Pisang Original', 22000, 0, 'Rak C-02', true],
    ['sku-6', 'FSH-DRESS-RED', 'Dress Katun Merah', 245000, 0, 'Fashion / tidak dilacak', false],
  ] as const;
  return {
    skus: fixture.map(([id, skuNumber, name, referencePrice, stock, note, tracked]) => ({
      id, skuNumber, aliases: [], name, referencePrice, stock, tracked, note,
      imageUrl: '', createdAt, archived: false,
    })),
    adjustments: [],
    notaTransactions: [],
    labelTemplate: { medium: 'thermal', widthMm: 50, heightMm: 30, columns: 1, marginMm: 2, gapMm: 2, fontSize: 10, alignment: 'center', fields: ['qr', 'name', 'sku', 'price'] },
    sourceLabel: 'Fixture sintetis',
  };
}

export function reduceOperation(state: DemoState, operation: Operation): DemoState {
  if (operation.type === 'replace-skus') {
    return { ...createInitialState(), skus: operation.skus, sourceLabel: operation.sourceLabel, importSummary: operation.importSummary, notaTransactions: [], adjustments: [] };
  }
  if (operation.type === 'add-sku') return { ...state, skus: [operation.sku, ...state.skus] };
  if (operation.type === 'archive-sku') {
    return { ...state, skus: state.skus.map((sku) => sku.id === operation.id ? { ...sku, archived: operation.archived } : sku) };
  }
  if (operation.type === 'adjust-stock') {
    const sku = state.skus.find((candidate) => candidate.id === operation.id);
    if (!sku || !sku.tracked || !Number.isInteger(operation.quantity)) return state;
    const after = sku.stock + operation.quantity;
    return {
      ...state,
      skus: state.skus.map((candidate) => candidate.id === sku.id ? { ...candidate, stock: after } : candidate),
      adjustments: [...state.adjustments, { id: `adj-${Date.now()}-${state.adjustments.length}`, skuId: sku.id, quantity: operation.quantity, before: sku.stock, after, createdAt: new Date().toISOString(), source: 'manual' }],
    };
  }
  const current = state.skus.find((sku) => sku.id === operation.id);
  if (!current) return state;
  const nextNumber = operation.patch.skuNumber?.trim();
  const aliases = nextNumber && nextNumber !== current.skuNumber && !current.aliases.includes(current.skuNumber)
    ? [...current.aliases, current.skuNumber]
    : current.aliases;
  return { ...state, skus: state.skus.map((sku) => sku.id === current.id ? { ...sku, ...operation.patch, skuNumber: nextNumber || current.skuNumber, aliases } : sku) };
}

export function skuNumberExists(skus: Sku[], value: string, exceptId?: string): boolean {
  const key = value.trim().toLocaleLowerCase('id-ID');
  return skus.some((sku) => sku.id !== exceptId && [sku.skuNumber, ...sku.aliases].some((number) => number.toLocaleLowerCase('id-ID') === key));
}
