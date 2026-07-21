import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import {
  addNotaPage,
  cancelNotaPage,
  cancelNotaTransaction,
  completeNotaTransaction,
  createDraftNotaTransaction,
  reopenNotaTransaction,
  restoreNotaPage,
  restoreNotaTransaction,
} from '../../src/domain/nota';
import { createInitialState } from '../../src/domain/operations';

function line(id: string, patch: Partial<ReturnType<typeof createDraftNotaTransaction>['pages'][number]['lines'][number]> = {}) {
  return { id, skuId: undefined, description: '', kind: '', quantity: 0, unit: 'pcs' as const, pcsPrice: 0, lsnPrice: 0, ...patch };
}

test('allocates A, Z, and AA pages without reusing a cancelled suffix', () => {
  let state = { ...createInitialState(), notaTransactions: [createDraftNotaTransaction(1)] };
  const transactionId = state.notaTransactions[0]!.id;
  for (let index = 0; index < 26; index += 1) state = addNotaPage(state, transactionId);
  expect(state.notaTransactions[0]!.pages.map((page) => page.suffix)).toEqual([
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'AA',
  ]);
  state = cancelNotaPage(state, transactionId, state.notaTransactions[0]!.pages[1]!.id);
  state = addNotaPage(state, transactionId);
  expect(state.notaTransactions[0]!.pages.at(-1)?.suffix).toBe('AB');
});

test('completion aggregates active pages, deducting only tracked linked SKUs', () => {
  let state = createInitialState();
  const transaction = createDraftNotaTransaction(1);
  transaction.pages[0]!.lines = [
    line('tracked-pcs', { skuId: 'sku-1', description: 'Beras', kind: 'Pangan', quantity: 2, pcsPrice: 42_000 }),
    line('untracked', { skuId: 'sku-2', description: 'Kemeja', kind: 'Busana', quantity: 1, pcsPrice: 185_000 }),
  ];
  transaction.pages.push({ ...transaction.pages[0]!, id: 'page-b', suffix: 'B', lines: [
    line('tracked-lsn', { skuId: 'sku-1', description: 'Beras', kind: 'Pangan', quantity: 1, unit: 'lsn', pcsPrice: 42_000, lsnPrice: 504_000 }),
    line('ad-hoc', { description: 'Jasa', kind: 'Layanan', quantity: 1, pcsPrice: 10_000 }),
  ] });
  transaction.nextNoteIndex = 2;
  state = completeNotaTransaction({ ...state, notaTransactions: [transaction] }, transaction.id);
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(10);
  expect(state.skus.find((sku) => sku.id === 'sku-2')?.stock).toBe(0);
  expect(state.notaTransactions[0]?.status).toBe('completed');
});

test('recompletion posts only the difference and transaction cancellation reverses then restores stock', () => {
  const transaction = createDraftNotaTransaction(1);
  transaction.pages[0]!.lines = [line('tracked', { skuId: 'sku-1', description: 'Beras', quantity: 2, pcsPrice: 42_000 })];
  let state = completeNotaTransaction({ ...createInitialState(), notaTransactions: [transaction] }, transaction.id);
  state = reopenNotaTransaction(state, transaction.id);
  state = {
    ...state,
    notaTransactions: state.notaTransactions.map((item) => item.id === transaction.id ? {
      ...item,
      pages: item.pages.map((page) => ({ ...page, lines: page.lines.map((itemLine) => ({ ...itemLine, quantity: 5 })) })),
    } : item),
  };
  state = completeNotaTransaction(state, transaction.id);
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(19);
  state = cancelNotaTransaction(state, transaction.id);
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(24);
  state = restoreNotaTransaction(state, transaction.id);
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(19);
});

test('draft page and draft transaction cancellation have no stock effect', () => {
  const transaction = createDraftNotaTransaction(1);
  let state = { ...createInitialState(), notaTransactions: [transaction] };
  state = cancelNotaPage(state, transaction.id, transaction.pages[0]!.id);
  state = restoreNotaPage(state, transaction.id, transaction.pages[0]!.id);
  state = cancelNotaTransaction(state, transaction.id);
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(24);
  state = restoreNotaTransaction(state, transaction.id);
  expect(state.notaTransactions[0]?.status).toBe('draft');
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(24);
});

test('normal gateway seed is Amelia in Saibah with active A and B pages and unchanged stock', () => {
  const state = new MockOperationsGateway().getSnapshot();
  const transaction = state.notaTransactions[0]!;
  expect(transaction).toMatchObject({ customerName: 'Amelia', customerPlace: 'Saibah', status: 'draft' });
  expect(transaction.pages.map((page) => [page.suffix, page.status])).toEqual([['A', 'active'], ['B', 'active']]);
  expect(transaction.pages[0]?.lines.filter((item) => item.description).map((item) => item.skuId ?? 'ad-hoc')).toEqual(['sku-1', 'ad-hoc']);
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(24);
});

test('workbook replacement clears the session transactions instead of reseeding them', async () => {
  const gateway = new MockOperationsGateway();
  await gateway.replaceFromWorkbook({ skus: [], loaded: 0, skipped: 0, warnings: [] }, 'Workbook uji');
  expect(gateway.getSnapshot().notaTransactions).toEqual([]);
});
