import type { DemoState, Nota, NotaTransaction } from '../../domain/types';

export interface NotaSearchResult {
  transaction: NotaTransaction;
  page: Nota;
  label: string;
}

const normalized = (value: string) => value.trim().toLocaleLowerCase('id-ID');

export function activePage(transaction: NotaTransaction, pageId?: string): Nota | undefined {
  return transaction.pages.find((page) => page.id === pageId && page.status === 'active')
    ?? transaction.pages.find((page) => page.status === 'active');
}

export function workingTransactions(transactions: NotaTransaction[]): NotaTransaction[] {
  return transactions.filter((transaction) => transaction.status === 'draft' || transaction.status === 'reopened');
}

function paginate(items: NotaTransaction[], page: number, size: number) {
  return { items: items.slice(page * size, page * size + size), total: items.length, pages: Math.max(1, Math.ceil(items.length / size)) };
}

export interface ArchiveFilters { query: string; place: string; from: string; to: string }
export type TrashItem = { kind: 'transaction'; transaction: NotaTransaction } | { kind: 'page'; transaction: NotaTransaction; page: Nota };

function transactionMatches(transaction: NotaTransaction, filters: ArchiveFilters) {
  const needle = normalized(filters.query);
  const numberMatches = transaction.pages.some((page) => normalized(`${transaction.baseNumber}${page.suffix}`).includes(needle));
  return (!needle || normalized(transaction.baseNumber).includes(needle) || normalized(transaction.customerName).includes(needle) || numberMatches)
    && (!filters.place || normalized(transaction.customerPlace).includes(normalized(filters.place)))
    && (!filters.from || transaction.transactionDate >= filters.from)
    && (!filters.to || transaction.transactionDate <= filters.to);
}

export function workingPage(transactions: NotaTransaction[], filters: { customer: string; from: string; to: string }, page = 0, size = 50) {
  const needleCustomer = normalized(filters.customer);
  const items = workingTransactions(transactions)
    .filter((transaction) => !needleCustomer || normalized(transaction.customerName).includes(needleCustomer))
    .filter((transaction) => !filters.from || transaction.transactionDate >= filters.from)
    .filter((transaction) => !filters.to || transaction.transactionDate <= filters.to)
    .sort((left, right) => right.transactionDate.localeCompare(left.transactionDate) || right.baseNumber.localeCompare(left.baseNumber));
  return paginate(items, page, size);
}

export function searchNota(state: DemoState, query: string): NotaSearchResult[] {
  const needle = normalized(query);
  if (!needle) return [];
  return state.notaTransactions.flatMap((transaction) => transaction.pages.map((page) => {
    const haystack = [
      transaction.baseNumber, `${transaction.baseNumber}${page.suffix}`, page.suffix,
      transaction.customerName, transaction.customerPlace,
      ...page.lines.flatMap((line) => {
        const sku = state.skus.find((item) => item.id === line.skuId);
        return [line.description, sku?.skuNumber ?? '', ...(sku?.aliases ?? [])];
      }),
    ].map(normalized);
    return haystack.some((value) => value.includes(needle))
      ? { transaction, page, label: `${transaction.baseNumber}${page.suffix} · ${transaction.customerName || 'Tanpa pelanggan'}` }
      : null;
  }).filter((result): result is NotaSearchResult => result !== null));
}

export function archivePage(transactions: NotaTransaction[], filters: ArchiveFilters, page = 0, size = 50) {
  const items = transactions.filter((transaction) => transaction.status === 'completed')
    .filter((transaction) => transactionMatches(transaction, filters))
    .sort((left, right) => right.transactionDate.localeCompare(left.transactionDate) || (right.completedAt ?? '').localeCompare(left.completedAt ?? ''));
  return paginate(items, page, size);
}

export function trashPage(transactions: NotaTransaction[], filters: ArchiveFilters, page = 0, size = 50) {
  const items = transactions.flatMap<TrashItem>((transaction) => {
    if (!transactionMatches(transaction, filters)) return [];
    if (transaction.status === 'cancelled') return [{ kind: 'transaction' as const, transaction }];
    return transaction.pages.filter((page) => page.status === 'cancelled').map((cancelledPage) => ({ kind: 'page' as const, transaction, page: cancelledPage }));
  }).sort((left, right) => right.transaction.transactionDate.localeCompare(left.transaction.transactionDate) || right.transaction.baseNumber.localeCompare(left.transaction.baseNumber));
  return { items: items.slice(page * size, page * size + size), total: items.length, pages: Math.max(1, Math.ceil(items.length / size)) };
}
