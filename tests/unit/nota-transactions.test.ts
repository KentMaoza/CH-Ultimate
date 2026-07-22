import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import {
  addNotaPage,
  cancelNotaPage,
  cancelNotaTransaction,
  completeNotaTransaction,
  createDraftNotaTransaction,
  deleteNotaLine,
  reopenNotaTransaction,
  restoreNotaPage,
  restoreNotaTransaction,
} from '../../src/domain/nota';
import { createInitialState } from '../../src/domain/operations';
import { buildRevenueReport } from '../../src/domain/reports';

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

test('restoring a cancelled completed transaction preserves its completion bucket until recompletion', () => {
  const transaction = createDraftNotaTransaction(1);
  transaction.pages[0]!.lines = [line('sale', { description: 'Jasa', quantity: 1, pcsPrice: 42_000 })];
  let state = completeNotaTransaction({ ...createInitialState(), notaTransactions: [transaction] }, transaction.id);
  state = {
    ...state,
    notaTransactions: state.notaTransactions.map((item) => item.id === transaction.id ? { ...item, completedAt: '2026-07-19T16:30:00.000Z' } : item),
  };
  const originalCompletedAt = state.notaTransactions[0]!.completedAt;
  state = cancelNotaTransaction(state, transaction.id);
  state = restoreNotaTransaction(state, transaction.id);

  expect(state.notaTransactions[0]).toMatchObject({ status: 'completed', completedAt: originalCompletedAt });
  expect(buildRevenueReport(state, new Date('2026-07-21T12:00:00.000Z')).byDay).toEqual([{ date: '2026-07-20', revenue: 42_000 }]);

  state = completeNotaTransaction(reopenNotaTransaction(state, transaction.id), transaction.id);
  expect(state.notaTransactions[0]!.completedAt).not.toBe(originalCompletedAt);
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

test('page lifecycle keeps one active page and allocates monotonically after cancellation', () => {
  const transaction = createDraftNotaTransaction(1);
  let state = { ...createInitialState(), notaTransactions: [transaction] };
  const pageA = transaction.pages[0]!;
  state = cancelNotaPage(state, transaction.id, pageA.id);
  expect(state.notaTransactions[0]!.pages[0]!.status).toBe('active');

  state = addNotaPage(state, transaction.id);
  const pageB = state.notaTransactions[0]!.pages[1]!;
  state = cancelNotaPage(state, transaction.id, pageB.id);
  expect(state.notaTransactions[0]!.pages[1]!.status).toBe('cancelled');
  state = addNotaPage(state, transaction.id);
  expect(state.notaTransactions[0]!.pages.at(-1)?.suffix).toBe('C');
  state = restoreNotaPage(state, transaction.id, pageB.id);
  expect(state.notaTransactions[0]!.pages[1]!.status).toBe('active');
});

test('reopened transactions permit page lifecycle and restore to reopened with posted stock reapplied', () => {
  const transaction = createDraftNotaTransaction(1);
  transaction.pages[0]!.lines = [line('tracked', { skuId: 'sku-1', description: 'Beras', quantity: 2, pcsPrice: 42_000 })];
  let state = completeNotaTransaction({ ...createInitialState(), notaTransactions: [transaction] }, transaction.id);
  state = reopenNotaTransaction(state, transaction.id);
  state = addNotaPage(state, transaction.id);
  const pageB = state.notaTransactions[0]!.pages[1]!;
  state = cancelNotaPage(state, transaction.id, pageB.id);
  expect(state.notaTransactions[0]!.pages[1]!.status).toBe('cancelled');
  state = restoreNotaPage(state, transaction.id, pageB.id);
  expect(state.notaTransactions[0]!.pages[1]!.status).toBe('active');

  state = cancelNotaTransaction(state, transaction.id);
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(24);
  state = restoreNotaTransaction(state, transaction.id);
  expect(state.notaTransactions[0]!.status).toBe('reopened');
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(22);
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

test('gateway refuses metadata and line edits outside an editable transaction or active page', async () => {
  const gateway = new MockOperationsGateway();
  const transaction = gateway.getSnapshot().notaTransactions[0]!;
  const activePage = transaction.pages[0]!;
  await gateway.completeNotaTransaction(transaction.id);
  await gateway.updateNotaTransaction(transaction.id, { customerName: 'Tidak boleh berubah' });
  await gateway.updateNotaLine(transaction.id, activePage.id, activePage.lines[0]!.id, { description: 'Tidak boleh berubah' });
  expect(gateway.getSnapshot().notaTransactions[0]).toMatchObject({ customerName: 'Amelia' });
  expect(gateway.getSnapshot().notaTransactions[0]?.pages[0]?.lines[0]?.description).toBe('Beras Hitam Premium 1 kg');
  await gateway.cancelNotaTransaction(transaction.id);
  await gateway.updateNotaTransaction(transaction.id, { customerName: 'Masih tidak boleh berubah' });
  await gateway.updateNotaLine(transaction.id, activePage.id, activePage.lines[0]!.id, { description: 'Masih tidak boleh berubah' });
  expect(gateway.getSnapshot().notaTransactions[0]).toMatchObject({ customerName: 'Amelia' });
  await gateway.reset();
  const resetTransaction = gateway.getSnapshot().notaTransactions[0]!;
  const resetCancelledPage = resetTransaction.pages[1]!;
  await gateway.cancelNotaPage(resetTransaction.id, resetCancelledPage.id);
  expect(gateway.getSnapshot().notaTransactions[0]?.pages[1]?.status).toBe('cancelled');
  await gateway.updateNotaLine(resetTransaction.id, resetCancelledPage.id, resetCancelledPage.lines[0]!.id, { description: 'Halaman batal tidak boleh berubah' });
  expect(gateway.getSnapshot().notaTransactions[0]?.pages[1]?.lines[0]?.description).toBe('');
});

test('gateway row deletion clears the selected slot without moving later row numbers', async () => {
  const gateway = new MockOperationsGateway();
  const transaction = gateway.getSnapshot().notaTransactions[0]!;
  const page = transaction.pages[0]!;
  const deleted = page.lines[0]!;
  const moved = page.lines[1]!;
  const trailing = page.lines[14]!;

  await gateway.deleteNotaLine(transaction.id, page.id, deleted.id);

  const next = gateway.getSnapshot().notaTransactions[0]!.pages[0]!.lines;
  expect(next).toHaveLength(15);
  expect(next[0]).toMatchObject({ id: deleted.id, description: '', kind: '', quantity: 0, unit: 'pcs', pcsPrice: 0, lsnPrice: 0 });
  expect(next[1]).toEqual(moved);
  expect(next[14]).toEqual(trailing);
});

test('domain row deletion preserves the deleted slot identity and every later row', () => {
  const transaction = createDraftNotaTransaction(1);
  const first = transaction.pages[0]!.lines[0]!;
  const second = transaction.pages[0]!.lines[1]!;
  const next = deleteNotaLine({ ...createInitialState(), notaTransactions: [transaction] }, transaction.id, transaction.pages[0]!.id, first.id);
  const lines = next.notaTransactions[0]!.pages[0]!.lines;
  expect(lines[0]).toMatchObject({ id: first.id, description: '', kind: '', quantity: 0, unit: 'pcs', pcsPrice: 0, lsnPrice: 0 });
  expect(lines[1]).toBe(second);
  expect(lines).toHaveLength(15);
});

test('posting effects stay immutable when a previously tracked SKU is later untracked', () => {
  const transaction = createDraftNotaTransaction(1);
  transaction.pages[0]!.lines = [line('tracked', { skuId: 'sku-1', description: 'Beras', quantity: 2, pcsPrice: 42_000 })];
  let state = completeNotaTransaction({ ...createInitialState(), notaTransactions: [transaction] }, transaction.id);
  expect(state.notaTransactions[0]?.postedStockEffects).toEqual({ 'sku-1': 2 });
  state = { ...state, skus: state.skus.map((sku) => sku.id === 'sku-1' ? { ...sku, tracked: false } : sku) };
  state = reopenNotaTransaction(state, transaction.id);
  state = {
    ...state,
    notaTransactions: state.notaTransactions.map((item) => item.id === transaction.id ? {
      ...item, pages: item.pages.map((page) => ({ ...page, lines: page.lines.map((itemLine) => ({ ...itemLine, quantity: 5 })) })),
    } : item),
  };
  state = completeNotaTransaction(state, transaction.id);
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(19);
  state = cancelNotaTransaction(state, transaction.id);
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(24);
  state = restoreNotaTransaction(state, transaction.id);
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(19);
});

test('later tracking an originally untracked SKU does not invent posting effects', () => {
  const transaction = createDraftNotaTransaction(1);
  transaction.pages[0]!.lines = [line('untracked', { skuId: 'sku-2', description: 'Kemeja', quantity: 2, pcsPrice: 185_000 })];
  let state = completeNotaTransaction({ ...createInitialState(), notaTransactions: [transaction] }, transaction.id);
  expect(state.notaTransactions[0]?.postedStockEffects).toEqual({});
  state = { ...state, skus: state.skus.map((sku) => sku.id === 'sku-2' ? { ...sku, tracked: true } : sku) };
  state = completeNotaTransaction(reopenNotaTransaction(state, transaction.id), transaction.id);
  expect(state.skus.find((sku) => sku.id === 'sku-2')?.stock).toBe(0);
  expect(state.notaTransactions[0]?.postedStockEffects).toEqual({});
});

test('reopening then adding a new tracked SKU line deducts its pieces', () => {
  const transaction = createDraftNotaTransaction(1);
  transaction.pages[0]!.lines = [line('existing', { skuId: 'sku-1', description: 'Beras', quantity: 1, pcsPrice: 42_000 })];
  let state = completeNotaTransaction({ ...createInitialState(), notaTransactions: [transaction] }, transaction.id);
  state = reopenNotaTransaction(state, transaction.id);
  state = {
    ...state,
    notaTransactions: state.notaTransactions.map((item) => item.id === transaction.id ? {
      ...item,
      pages: item.pages.map((page) => ({ ...page, lines: [...page.lines, line('new', { skuId: 'sku-4', description: 'Cokelat', quantity: 2, pcsPrice: 18_000 })] })),
    } : item),
  };
  state = completeNotaTransaction(state, transaction.id);
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(23);
  expect(state.skus.find((sku) => sku.id === 'sku-4')?.stock).toBe(14);
});

test('reopening then changing a line to another tracked SKU reverses the old effect and posts the new one', () => {
  const transaction = createDraftNotaTransaction(1);
  transaction.pages[0]!.lines = [line('swapped', { skuId: 'sku-1', description: 'Beras', quantity: 2, pcsPrice: 42_000 })];
  let state = completeNotaTransaction({ ...createInitialState(), notaTransactions: [transaction] }, transaction.id);
  state = reopenNotaTransaction(state, transaction.id);
  state = {
    ...state,
    notaTransactions: state.notaTransactions.map((item) => item.id === transaction.id ? {
      ...item,
      pages: item.pages.map((page) => ({ ...page, lines: page.lines.map((itemLine) => itemLine.id === 'swapped' ? {
        ...itemLine, skuId: 'sku-4', description: 'Cokelat', quantity: 3, pcsPrice: 18_000,
      } : itemLine) })),
    } : item),
  };
  state = completeNotaTransaction(state, transaction.id);
  expect(state.skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(24);
  expect(state.skus.find((sku) => sku.id === 'sku-4')?.stock).toBe(13);
});

test('completion rejects fractional and negative inactive prices', () => {
  for (const lsnPrice of [0.5, -1]) {
    const transaction = createDraftNotaTransaction(1);
    transaction.pages[0]!.lines = [line('price', { description: 'Beras', quantity: 1, pcsPrice: 42_000, lsnPrice })];
    expect(() => completeNotaTransaction({ ...createInitialState(), notaTransactions: [transaction] }, transaction.id)).toThrow('Harga harus bilangan bulat nol atau lebih.');
  }
});
