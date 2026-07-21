import { completeNotaTransaction, createDraftNotaTransaction } from '../../src/domain/nota';
import { createInitialState } from '../../src/domain/operations';
import { archivePage, searchNota } from '../../src/renderer/nota/nota-workspace-utils';

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
  const first = archivePage(transactions, { customer: 'Amelia', place: 'Saibah', from: '', to: '' });
  expect(first).toMatchObject({ total: 50, pages: 1 });
  expect(first.items).toHaveLength(50);
  const budi = archivePage(transactions, { customer: 'Budi', place: 'Makassar', from: '', to: '' });
  expect(budi.items.map((item) => item.customerName)).toEqual(['Budi']);
});
