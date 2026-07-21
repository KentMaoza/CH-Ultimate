import { completeNota, createDraftNota, noteSuffixFromIndex, reopenNota, cancelNota, restoreNota, suggestedPrice } from '../../src/domain/nota';
import { createInitialState } from '../../src/domain/operations';

test('uses spreadsheet-style suffixes and a 12-piece lsn conversion', () => {
  expect(noteSuffixFromIndex(0)).toBe('A');
  expect(noteSuffixFromIndex(25)).toBe('Z');
  expect(noteSuffixFromIndex(26)).toBe('AA');
  expect(suggestedPrice(42000, 'lsn')).toBe(504000);
});

test('completing a nota deducts tracked SKU but ignores untracked and ad-hoc lines', () => {
  let state = createInitialState();
  const nota = createDraftNota(1);
  nota.lines = [
    { id: 'l1', skuId: 'sku-1', description: 'Beras', quantity: 2, unit: 'pcs', unitPrice: 42000 },
    { id: 'l2', skuId: 'sku-2', description: 'Kemeja', quantity: 1, unit: 'pcs', unitPrice: 185000 },
    { id: 'l3', description: 'Jasa', quantity: 1, unit: 'pcs', unitPrice: 10000 },
  ];
  state = { ...state, notas: [nota] };
  state = completeNota(state, nota.id);
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(22);
  expect(state.skus.find((sku) => sku.id === 'sku-2')?.stock).toBe(0);
});

test('recompletion applies only the stock delta, while cancel and restore reverse it', () => {
  let state = createInitialState();
  const nota = createDraftNota(2);
  nota.lines = [{ id: 'l1', skuId: 'sku-1', description: 'Beras', quantity: 2, unit: 'pcs', unitPrice: 42000 }];
  state = completeNota({ ...state, notas: [nota] }, nota.id);
  state = reopenNota(state, nota.id);
  state = { ...state, notas: state.notas.map((item) => item.id === nota.id ? { ...item, lines: [{ ...item.lines[0]!, quantity: 5 }] } : item) };
  state = completeNota(state, nota.id);
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(19);
  state = cancelNota(state, nota.id);
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(24);
  state = restoreNota(state, nota.id);
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(19);
});
