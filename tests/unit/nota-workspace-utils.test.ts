import { completeNotaTransaction, createDraftNotaTransaction } from '../../src/domain/nota';
import { createInitialState } from '../../src/domain/operations';
import { archivePage, searchNota, trashPage, workingPage } from '../../src/renderer/nota/nota-workspace-utils';

function completed(sequence: number, customerName: string, customerPlace: string) {
  const transaction = createDraftNotaTransaction(sequence);
  transaction.customerName = customerName;
  transaction.customerPlace = customerPlace;
  transaction.pages[0]!.lines[0] = { ...transaction.pages[0]!.lines[0]!, skuId: 'sku-1', description: 'Beras Hitam Premium 1 kg', quantity: 1, pcsPrice: 42_000 };
  return completeNotaTransaction({ ...createInitialState(), notaTransactions: [transaction] }, transaction.id).notaTransactions[0]!;
}

test('global nota search matches CHU fields, lines, current SKU, and aliases across pages', () => {
  const transaction = completed(1, 'Amelia', 'Saibah');
  const state = { ...createInitialState(), skus: createInitialState().skus.map((sku) => sku.id === 'sku-1' ? { ...sku, aliases: ['BERAS-LAMA'] } : sku), notaTransactions: [transaction] };
  for (const query of [transaction.baseNumber, `${transaction.baseNumber}A`, 'Amelia', 'Saibah', 'Premium', 'BRS-108-BLK', 'BERAS-LAMA']) {
    expect(searchNota(state, query)).toHaveLength(1);
  }
});

test('archive filters completed transactions and paginates in groups of fifty', () => {
  const transactions = Array.from({ length: 51 }, (_, index) => completed(index + 1, index === 50 ? 'Budi' : 'Amelia', index === 50 ? 'Makassar' : 'Saibah'));
  const unfilteredFirst = archivePage(transactions, { query: '', place: '', from: '', to: '' });
  const unfilteredSecond = archivePage(transactions, { query: '', place: '', from: '', to: '' }, 1);
  expect(unfilteredFirst).toMatchObject({ total: 51, pages: 2 });
  expect(unfilteredFirst.items).toHaveLength(50);
  expect(unfilteredSecond.items).toHaveLength(1);
  const first = archivePage(transactions, { query: 'Amelia', place: 'Saibah', from: '', to: '' });
  expect(first).toMatchObject({ total: 50, pages: 1 });
  expect(first.items).toHaveLength(50);
  const budi = archivePage(transactions, { query: 'Budi', place: 'Makassar', from: '', to: '' });
  expect(budi.items.map((item) => item.customerName)).toEqual(['Budi']);
  expect(archivePage(transactions, { query: transactions[0]!.baseNumber, place: '', from: '', to: '' }).items).toHaveLength(1);
});

test('trash search includes cancelled transactions and cancelled pages with pagination', () => {
  const cancelled = createDraftNotaTransaction(80);
  cancelled.customerName = 'Budi';
  cancelled.status = 'cancelled';
  cancelled.cancelledFromStatus = 'draft';
  const withPage = createDraftNotaTransaction(81);
  withPage.pages[0]!.status = 'cancelled';
  const result = trashPage([cancelled, withPage], { query: 'CHU-', place: '', from: '', to: '' });
  expect(result.total).toBe(2);
  expect(result.items.map((item) => item.kind)).toEqual(['page', 'transaction']);
});

test('working notes filter inclusively, sort newest first, and paginate fifty per page', () => {
  const transactions = Array.from({ length: 51 }, (_, index) => {
    const transaction = createDraftNotaTransaction(index + 1);
    transaction.transactionDate = `2026-07-${String((index % 28) + 1).padStart(2, '0')}`;
    transaction.customerName = index === 50 ? 'Budi' : 'Amelia';
    return transaction;
  });

  const all = workingPage(transactions, { customer: '', from: '', to: '' });
  expect(all).toMatchObject({ total: 51, pages: 2 });
  expect(all.items).toHaveLength(50);
  expect(all.items[0]!.transactionDate >= all.items[1]!.transactionDate).toBe(true);
  expect(workingPage(transactions, { customer: 'Budi', from: '2026-07-20', to: '2026-07-23' }).items).toHaveLength(1);
  expect(workingPage(transactions, { customer: 'Amelia', from: '2026-07-20', to: '2026-07-20' }).items.every((item) => item.transactionDate === '2026-07-20')).toBe(true);
});
