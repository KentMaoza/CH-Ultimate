import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { buildRevenueReport } from '../../src/domain/reports';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

function openNota(gateway = new MockOperationsGateway()) {
  render(<App gateway={gateway} />);
  fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
  return gateway;
}

function openArchive(gateway = new MockOperationsGateway()) {
  render(<App gateway={gateway} />);
  fireEvent.click(screen.getByRole('button', { name: 'Arsip Nota' }));
  return gateway;
}

test('selects Amelia A and B pages, adds C, and restores a cancelled page from Sampah', async () => {
  openNota();
  expect(screen.getByRole('button', { name: 'Halaman A' })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(screen.getByRole('button', { name: 'Halaman B' }));
  expect(screen.getByRole('button', { name: 'Halaman B' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Tambah Nota C' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Halaman C' })).toHaveAttribute('aria-pressed', 'true'));

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Batalkan halaman C' })); });
  expect(screen.getByText(/Halaman C dipindahkan ke Sampah/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Kembali ke CH Ultimate' }));
  fireEvent.click(screen.getByRole('button', { name: 'Arsip Nota' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Sampah' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pulihkan' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Halaman C' })).toHaveAttribute('aria-pressed', 'true'));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Arsip Nota' })).not.toBeInTheDocument());
});

test('working drawer groups transactions and explains why the last page cannot be cancelled', async () => {
  const gateway = openNota();
  fireEvent.click(screen.getByRole('button', { name: 'Nota Dikerjakan' }));
  const drawer = screen.getByRole('dialog', { name: 'Nota Dikerjakan' });
  expect(within(drawer).getByText('Amelia')).toBeInTheDocument();
  expect(within(drawer).getByText(/Saibah/)).toBeInTheDocument();

  const transaction = gateway.getSnapshot().notaTransactions[0]!;
  const pageB = transaction.pages[1]!;
  await act(async () => { await gateway.cancelNotaPage(transaction.id, pageB.id); });
  expect(within(drawer).getByRole('button', { name: 'Batalkan halaman A' })).toBeDisabled();
  expect(within(drawer).getByText(/minimal satu halaman aktif/i)).toBeInTheDocument();
});

test('working drawer filters session drafts by customer and inclusive nota date', async () => {
  const gateway = new MockOperationsGateway();
  const budi = await gateway.createNotaTransaction();
  await gateway.updateNotaTransaction(budi.id, { customerName: 'Budi', transactionDate: '2026-07-20' });
  const amelia = gateway.getSnapshot().notaTransactions.find((item) => item.customerName === 'Amelia')!;
  await gateway.updateNotaTransaction(amelia.id, { transactionDate: '2026-07-21' });
  openNota(gateway);

  fireEvent.click(screen.getByRole('button', { name: 'Nota Dikerjakan' }));
  const drawer = screen.getByRole('dialog', { name: 'Nota Dikerjakan' });
  fireEvent.change(within(drawer).getByLabelText('Filter pelanggan dikerjakan'), { target: { value: 'Budi' } });
  expect(within(drawer).getByText(budi.baseNumber)).toBeInTheDocument();
  expect(within(drawer).queryByText(amelia.baseNumber)).not.toBeInTheDocument();
  fireEvent.change(within(drawer).getByLabelText('Dari tanggal dikerjakan'), { target: { value: '2026-07-21' } });
  expect(within(drawer).getByText('Tidak ada nota yang sedang dikerjakan.')).toBeInTheDocument();
});

test('archive module opens completed nota as inline read-only preview without changing stock or revenue', async () => {
  const gateway = new MockOperationsGateway();
  const transaction = gateway.getSnapshot().notaTransactions[0]!;
  await gateway.completeNotaTransaction(transaction.id);
  const stockBefore = gateway.getSnapshot().skus.map((sku) => sku.stock);
  const revenueBefore = buildRevenueReport(gateway.getSnapshot()).today;
  openArchive(gateway);

  expect(screen.getByText('SELESAI · HANYA LIHAT')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Preview arsip nota' })).toBeInTheDocument();
  const archiveCard = screen.getByRole('button', { name: /Amelia.*Saibah/ });
  expect(within(archiveCard).queryByText(transaction.baseNumber)).not.toBeInTheDocument();
  expect(within(archiveCard).getByText('Amelia')).toHaveClass('archive-nota__customer-name');
  expect(within(archiveCard).getByText('Saibah')).toHaveClass('archive-nota__customer-place');
  fireEvent.click(screen.getByRole('button', { name: 'Preview halaman B' }));
  expect(screen.queryByRole('heading', { name: `${transaction.baseNumber}B` })).not.toBeInTheDocument();
  expect(screen.getByText(`${transaction.baseNumber}B`)).toHaveClass('archive-nota__preview-number');
  expect(screen.queryByRole('region', { name: 'SKU Gudang' })).not.toBeInTheDocument();
  expect(gateway.getSnapshot().skus.map((sku) => sku.stock)).toEqual(stockBefore);
  expect(buildRevenueReport(gateway.getSnapshot()).today).toBe(revenueBefore);
  expect(gateway.getSnapshot().notaTransactions[0]?.status).toBe('completed');

  fireEvent.click(screen.getByRole('button', { name: 'Buka kembali untuk edit' }));
  expect(screen.getByRole('dialog', { name: /Buka kembali nota/i })).toBeInTheDocument();
  expect(gateway.getSnapshot().notaTransactions[0]?.status).toBe('completed');
});

test('reopen returns to Nota and back preserves archive query, place, dates, and tab', async () => {
  const gateway = new MockOperationsGateway();
  const transaction = gateway.getSnapshot().notaTransactions[0]!;
  await gateway.completeNotaTransaction(transaction.id);
  openArchive(gateway);
  fireEvent.change(screen.getByLabelText('Cari arsip nota'), { target: { value: 'Amelia' } });
  fireEvent.change(screen.getByLabelText('Filter tempat arsip'), { target: { value: 'Saibah' } });
  fireEvent.change(screen.getByLabelText('Dari tanggal arsip'), { target: { value: transaction.transactionDate } });
  fireEvent.change(screen.getByLabelText('Sampai tanggal arsip'), { target: { value: transaction.transactionDate } });
  fireEvent.click(screen.getByRole('button', { name: 'Buka kembali untuk edit' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: /Buka kembali nota/i })).getByRole('button', { name: 'Buka kembali' }));
  await waitFor(() => expect(screen.getByTestId('chu-nota-workspace')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Kembali ke CH Ultimate' }));
  expect(screen.getByRole('heading', { name: 'Arsip Nota' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Arsip' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('Cari arsip nota')).toHaveValue('Amelia');
  expect(screen.getByLabelText('Filter tempat arsip')).toHaveValue('Saibah');
  expect(screen.getByLabelText('Dari tanggal arsip')).toHaveValue(transaction.transactionDate);
  expect(screen.getByLabelText('Sampai tanggal arsip')).toHaveValue(transaction.transactionDate);
});

test('workspace search excludes completed nota', async () => {
  const gateway = new MockOperationsGateway();
  const transaction = gateway.getSnapshot().notaTransactions[0]!;
  await gateway.completeNotaTransaction(transaction.id);
  openNota(gateway);

  const search = screen.getByRole('combobox', { name: 'Cari nota' });
  fireEvent.change(search, { target: { value: transaction.baseNumber } });
  expect(screen.getByRole('listbox', { name: 'Hasil pencarian nota' })).toHaveTextContent('Tidak ada nota yang cocok.');
  expect(gateway.getSnapshot().notaTransactions[0]?.status).toBe('completed');
});

test('new transaction selects its A page and global search opens from Ctrl or Cmd+K', async () => {
  openNota();
  fireEvent.click(screen.getByRole('button', { name: 'Transaksi Baru' }));
  const dialog = screen.getByRole('dialog', { name: 'Transaksi Baru' });
  fireEvent.change(within(dialog).getByLabelText('Pelanggan'), { target: { value: 'Budi' } });
  fireEvent.change(within(dialog).getByLabelText('Tempat'), { target: { value: 'Makassar' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Buat transaksi' }));
  await waitFor(() => expect(screen.getByLabelText('Pelanggan')).toHaveValue('Budi'));
  expect(screen.getByRole('button', { name: 'Halaman A' })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  const search = screen.getByRole('combobox', { name: 'Cari nota' });
  expect(search).toHaveFocus();
  fireEvent.keyDown(search, { key: 'Escape' });
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  expect(search).toHaveFocus();
  fireEvent.change(search, { target: { value: 'Budi' } });
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(screen.getByLabelText('Pelanggan')).toHaveValue('Budi');
});

test('page cancellation offers an undo action that restores the page', async () => {
  openNota();
  fireEvent.click(screen.getByRole('button', { name: 'Halaman B' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Batalkan halaman B' })); });
  fireEvent.click(screen.getByRole('button', { name: 'Urungkan' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Halaman B' })).toBeInTheDocument());
});

test('search click opens the clicked result, exposes an active descendant, and Escape restores its prior focus', () => {
  openNota();
  const listTrigger = screen.getByRole('button', { name: 'Nota Dikerjakan' });
  listTrigger.focus();
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  const search = screen.getByRole('combobox', { name: 'Cari nota' });
  fireEvent.change(search, { target: { value: 'Amelia' } });

  const results = screen.getAllByRole('option');
  expect(search).toHaveAttribute('aria-activedescendant', results[0]!.id);
  expect(results[0]!.tagName).not.toBe('BUTTON');
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expect(search).toHaveAttribute('aria-activedescendant', results[1]!.id);
  fireEvent.keyDown(search, { key: 'ArrowUp' });
  expect(search).toHaveAttribute('aria-activedescendant', results[0]!.id);
  fireEvent.click(results[1]!);
  expect(screen.getByRole('button', { name: 'Halaman B' })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(listTrigger).toHaveFocus();
});

test('search stays expanded when a nonempty query renders an empty listbox', () => {
  openNota();
  const search = screen.getByRole('combobox', { name: 'Cari nota' });
  fireEvent.change(search, { target: { value: 'tidak-ada-nota' } });

  expect(search).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('listbox', { name: 'Hasil pencarian nota' })).toHaveTextContent('Tidak ada nota yang cocok.');
});

test('new transaction and drawer dialogs restore focus, close on Escape, and reset fields for a fresh open', () => {
  openNota();
  const newTrigger = screen.getByRole('button', { name: 'Transaksi Baru' });
  newTrigger.focus();
  fireEvent.click(newTrigger);
  const dialog = screen.getByRole('dialog', { name: 'Transaksi Baru' });
  const customer = within(dialog).getByLabelText('Pelanggan');
  expect(customer).toHaveFocus();
  fireEvent.keyDown(customer, { key: 'Tab', shiftKey: true });
  expect(within(dialog).getByRole('button', { name: 'Buat transaksi' })).toHaveFocus();
  customer.focus();
  fireEvent.change(customer, { target: { value: 'Sementara' } });
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Transaksi Baru' })).not.toBeInTheDocument();
  expect(newTrigger).toHaveFocus();

  fireEvent.click(newTrigger);
  expect(within(screen.getByRole('dialog', { name: 'Transaksi Baru' })).getByLabelText('Pelanggan')).toHaveValue('');
  const reopenedNew = screen.getByRole('dialog', { name: 'Transaksi Baru' });
  fireEvent.mouseDown(reopenedNew.parentElement!);
  expect(screen.queryByRole('dialog', { name: 'Transaksi Baru' })).not.toBeInTheDocument();

  const workingTrigger = screen.getByRole('button', { name: 'Nota Dikerjakan' });
  workingTrigger.focus();
  fireEvent.click(workingTrigger);
  const drawer = screen.getByRole('dialog', { name: 'Nota Dikerjakan' });
  expect(within(drawer).getByRole('button', { name: 'Tutup Nota Dikerjakan' })).toHaveFocus();
  fireEvent.keyDown(within(drawer).getByRole('button', { name: 'Tutup Nota Dikerjakan' }), { key: 'Tab', shiftKey: true });
  expect(within(drawer).getByRole('button', { name: 'Batalkan halaman B' })).toHaveFocus();
  fireEvent.keyDown(drawer, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Nota Dikerjakan' })).not.toBeInTheDocument();
  expect(workingTrigger).toHaveFocus();
});

test('a nested cancellation confirmation keeps focus inside Nota Dikerjakan and restores its clicked control', () => {
  openNota();
  const workingTrigger = screen.getByRole('button', { name: 'Nota Dikerjakan' });
  fireEvent.click(workingTrigger);
  const drawer = screen.getByRole('dialog', { name: 'Nota Dikerjakan' });
  const cancelTransaction = within(drawer).getByRole('button', { name: 'Batalkan transaksi' });
  fireEvent.click(cancelTransaction);

  const confirmation = screen.getByRole('dialog', { name: /Batalkan transaksi/i });
  const cancel = within(confirmation).getByRole('button', { name: 'Batal' });
  expect(cancel).toHaveFocus();
  fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
  expect(within(confirmation).getByRole('button', { name: 'Batalkan' })).toHaveFocus();
  fireEvent.click(cancel);

  expect(screen.getByRole('dialog', { name: 'Nota Dikerjakan' })).toBeInTheDocument();
  expect(cancelTransaction).toHaveFocus();
  expect(workingTrigger).not.toHaveFocus();
});

test('Escape closes archive reopen confirmation without changing status', async () => {
  const gateway = new MockOperationsGateway();
  await gateway.completeNotaTransaction(gateway.getSnapshot().notaTransactions[0]!.id);
  openArchive(gateway);
  const reopen = screen.getByRole('button', { name: 'Buka kembali untuk edit' });
  fireEvent.click(reopen);

  const confirmation = screen.getByRole('dialog', { name: /Buka kembali nota/i });
  fireEvent.keyDown(confirmation, { key: 'Escape' });

  expect(screen.getByRole('heading', { name: 'Arsip Nota' })).toBeInTheDocument();
  expect(gateway.getSnapshot().notaTransactions[0]?.status).toBe('completed');
});

test('cancelling a transaction stays in Nota workspace', async () => {
  openNota();
  fireEvent.click(screen.getByRole('button', { name: 'Batalkan transaksi' }));
  const confirmation = screen.getByRole('dialog', { name: /Batalkan transaksi/i });
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Batalkan' }));
  await waitFor(() => expect(screen.getByText('Belum ada nota yang sedang dikerjakan pada sesi ini.')).toBeInTheDocument());
  expect(screen.queryByRole('tab', { name: 'Sampah' })).not.toBeInTheDocument();
});

test('a cancelled transaction is excluded from workspace search', async () => {
  openNota();
  fireEvent.click(screen.getByRole('button', { name: 'Batalkan transaksi' }));
  await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: /Batalkan transaksi/i })).getByRole('button', { name: 'Batalkan' })); });
  const search = screen.getByRole('combobox', { name: 'Cari nota' });
  fireEvent.change(search, { target: { value: 'Amelia' } });
  expect(screen.getByRole('listbox', { name: 'Hasil pencarian nota' })).toHaveTextContent('Tidak ada nota yang cocok.');
});

test('transaction cancellation can be undone', async () => {
  const gateway = openNota();
  fireEvent.click(screen.getByRole('button', { name: 'Batalkan transaksi' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: /Batalkan transaksi/i })).getByRole('button', { name: 'Batalkan' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Urungkan' })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Urungkan' }));

  await waitFor(() => expect(gateway.getSnapshot().notaTransactions[0]?.status).toBe('draft'));
});

test('undo expires at exactly ten seconds', async () => {
  vi.useFakeTimers();
  try {
    openNota();
    fireEvent.click(screen.getByRole('button', { name: 'Halaman B' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Batalkan halaman B' })); });
    expect(screen.getByRole('button', { name: 'Urungkan' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(9_999));
    expect(screen.getByRole('button', { name: 'Urungkan' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('button', { name: 'Urungkan' })).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('a replacement undo owns a fresh timer and unmount clears it', async () => {
  vi.useFakeTimers();
  try {
    const view = render(<App gateway={new MockOperationsGateway()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
    fireEvent.click(screen.getByRole('button', { name: /Tambah Nota [A-Z]+/ }));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan halaman C' }));
    await act(async () => {});
    act(() => vi.advanceTimersByTime(5_000));
    fireEvent.click(screen.getByRole('button', { name: 'Halaman B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan halaman B' }));
    await act(async () => {});
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByRole('button', { name: 'Urungkan' })).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test('restoring a completed transaction returns to Arsip rather than the working selection', async () => {
  const gateway = new MockOperationsGateway();
  const transaction = gateway.getSnapshot().notaTransactions[0]!;
  await gateway.completeNotaTransaction(transaction.id);
  await gateway.cancelNotaTransaction(transaction.id);
  openArchive(gateway);
  fireEvent.click(screen.getByRole('tab', { name: 'Sampah' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pulihkan' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Arsip' })).toHaveAttribute('aria-selected', 'true'));
  expect(screen.getByText('SELESAI · HANYA LIHAT')).toBeInTheDocument();
});

test.each(['draft', 'reopened'] as const)('restoring a cancelled %s transaction selects its working page', async (status) => {
  const gateway = new MockOperationsGateway();
  const transaction = gateway.getSnapshot().notaTransactions[0]!;
  if (status === 'reopened') {
    await gateway.completeNotaTransaction(transaction.id);
    await gateway.reopenNotaTransaction(transaction.id);
  }
  await gateway.cancelNotaTransaction(transaction.id);
  openArchive(gateway);
  fireEvent.click(screen.getByRole('tab', { name: 'Sampah' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pulihkan' }));
  await waitFor(() => expect(screen.getByTestId('chu-nota-workspace')).toBeInTheDocument());
  expect(within(screen.getByLabelText('Halaman aktif')).getByRole('button', { name: 'Halaman A' })).toHaveAttribute('aria-pressed', 'true');
  expect(gateway.getSnapshot().notaTransactions[0]?.status).toBe(status);
});

test('a confirmation never falls back to a newly reset selection', async () => {
  const gateway = openNota();
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  const confirmation = screen.getByRole('dialog', { name: /Selesaikan nota/i });
  await act(async () => { await gateway.reset(); });
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Selesaikan' }));
  await waitFor(() => expect(screen.getByText(/sudah tidak tersedia/i)).toBeInTheDocument());
  expect(gateway.getSnapshot().notaTransactions[0]?.status).toBe('draft');
  expect(screen.queryByRole('dialog', { name: /Selesaikan nota/i })).not.toBeInTheDocument();
});

test('a confirmation after an import closes safely without acting on a replacement session', async () => {
  const gateway = openNota();
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  const confirmation = screen.getByRole('dialog', { name: /Selesaikan nota/i });
  await act(async () => { await gateway.replaceFromWorkbook({ skus: [], loaded: 0, skipped: 0, warnings: [] }, 'Workbook pengganti'); });
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Selesaikan' }));
  await waitFor(() => expect(screen.getByText(/sudah tidak tersedia/i)).toBeInTheDocument());
  expect(gateway.getSnapshot().notaTransactions).toEqual([]);
});

class RejectingPageGateway extends MockOperationsGateway {
  override async cancelNotaPage(): Promise<void> { throw new Error('Koneksi demo ditolak.'); }
}

test('a rejected mutation reports an error and never offers undo', async () => {
  openNota(new RejectingPageGateway());
  fireEvent.click(screen.getByRole('button', { name: 'Halaman B' }));
  fireEvent.click(screen.getByRole('button', { name: 'Batalkan halaman B' }));
  await waitFor(() => expect(screen.getByText('Koneksi demo ditolak.')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Urungkan' })).not.toBeInTheDocument();
});

class DelayedAddGateway extends MockOperationsGateway {
  private releaseAdd: (() => void) | null = null;

  override async addNotaPage(transactionId: string) {
    await new Promise<void>((resolve) => { this.releaseAdd = resolve; });
    return super.addNotaPage(transactionId);
  }

  release() { this.releaseAdd?.(); }
}

class DelayedCreateGateway extends MockOperationsGateway {
  private releaseCreate: (() => void) | null = null;

  override async createNotaTransaction() {
    await new Promise<void>((resolve) => { this.releaseCreate = resolve; });
    return super.createNotaTransaction();
  }

  release() { this.releaseCreate?.(); }
}

class DelayedCompleteGateway extends MockOperationsGateway {
  private releaseComplete: (() => void) | null = null;

  override async completeNotaTransaction(transactionId: string) {
    await new Promise<void>((resolve) => { this.releaseComplete = resolve; });
    return super.completeNotaTransaction(transactionId);
  }

  release() { this.releaseComplete?.(); }
}

test('delayed mutations disable mutation controls until the gateway settles', async () => {
  const gateway = new DelayedAddGateway();
  openNota(gateway);
  const add = screen.getByRole('button', { name: 'Tambah Nota C' });
  fireEvent.click(add);
  await waitFor(() => expect(add).toBeDisabled());
  expect(screen.getByTestId('chu-nota-workspace')).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('status', { name: 'Operasi nota sedang diproses' })).toHaveTextContent('Sedang memproses');
  expect(screen.getByRole('button', { name: 'Batalkan transaksi' })).toBeDisabled();
  gateway.release();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Halaman C' })).toHaveAttribute('aria-pressed', 'true'));
  expect(screen.getByTestId('chu-nota-workspace')).not.toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByRole('status', { name: 'Operasi nota sedang diproses' })).not.toBeInTheDocument();
});

test('a pending create disables Batal and ignores Escape and its backdrop', async () => {
  const gateway = new DelayedCreateGateway();
  openNota(gateway);
  const background = screen.getByRole('button', { name: 'Kembali ke CH Ultimate' });
  fireEvent.click(screen.getByRole('button', { name: 'Transaksi Baru' }));
  const dialog = screen.getByRole('dialog', { name: 'Transaksi Baru' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Buat transaksi' }));

  const cancel = within(dialog).getByRole('button', { name: 'Batal' });
  await waitFor(() => expect(cancel).toBeDisabled());
  expect(dialog).toHaveAttribute('tabindex', '-1');
  expect(dialog).toHaveFocus();
  expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
  expect(dialog).toHaveFocus();
  expect(background).not.toHaveFocus();
  expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(false);
  expect(dialog).toHaveFocus();
  expect(background).not.toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  fireEvent.mouseDown(dialog.parentElement!);
  expect(screen.getByRole('dialog', { name: 'Transaksi Baru' })).toBeInTheDocument();

  gateway.release();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Transaksi Baru' })).not.toBeInTheDocument());
});

test('a pending confirmation disables Batal and ignores Escape and its backdrop', async () => {
  const gateway = new DelayedCompleteGateway();
  openNota(gateway);
  const background = screen.getByRole('button', { name: 'Kembali ke CH Ultimate' });
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  const dialog = screen.getByRole('dialog', { name: /Selesaikan nota/i });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Selesaikan' }));

  const cancel = within(dialog).getByRole('button', { name: 'Batal' });
  await waitFor(() => expect(cancel).toBeDisabled());
  expect(dialog).toHaveAttribute('tabindex', '-1');
  expect(dialog).toHaveFocus();
  expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
  expect(dialog).toHaveFocus();
  expect(background).not.toHaveFocus();
  expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(false);
  expect(dialog).toHaveFocus();
  expect(background).not.toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  fireEvent.mouseDown(dialog.parentElement!);
  expect(screen.getByRole('dialog', { name: /Selesaikan nota/i })).toBeInTheDocument();

  gateway.release();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /Selesaikan nota/i })).not.toBeInTheDocument());
});

test('a pending drawer mutation disables close and ignores Escape and its backdrop', async () => {
  const gateway = new DelayedAddGateway();
  openNota(gateway);
  const background = screen.getByRole('button', { name: 'Kembali ke CH Ultimate' });
  fireEvent.click(screen.getByRole('button', { name: 'Nota Dikerjakan' }));
  const drawer = screen.getByRole('dialog', { name: 'Nota Dikerjakan' });
  fireEvent.click(within(drawer).getByRole('button', { name: 'Tambah Nota' }));

  const close = within(drawer).getByRole('button', { name: 'Tutup Nota Dikerjakan' });
  await waitFor(() => expect(close).toBeDisabled());
  expect(drawer).toHaveAttribute('tabindex', '-1');
  expect(drawer).toHaveFocus();
  expect(fireEvent.keyDown(drawer, { key: 'Tab' })).toBe(false);
  expect(drawer).toHaveFocus();
  expect(background).not.toHaveFocus();
  expect(fireEvent.keyDown(drawer, { key: 'Tab', shiftKey: true })).toBe(false);
  expect(drawer).toHaveFocus();
  expect(background).not.toHaveFocus();
  fireEvent.keyDown(drawer, { key: 'Escape' });
  fireEvent.mouseDown(drawer.parentElement!);
  expect(screen.getByRole('dialog', { name: 'Nota Dikerjakan' })).toBeInTheDocument();

  gateway.release();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Halaman C' })).toHaveAttribute('aria-pressed', 'true'));
});

test('multi-page completion posts aggregate revenue once, archive confirmation reopens it, and recompletion posts only its delta', async () => {
  const gateway = new MockOperationsGateway();
  const transaction = gateway.getSnapshot().notaTransactions[0]!;
  const pageB = transaction.pages[1]!;
  await gateway.updateNotaLine(transaction.id, pageB.id, pageB.lines[0]!.id, { skuId: 'sku-1', description: 'Beras Hitam Premium 1 kg', kind: 'Pangan', quantity: 2, pcsPrice: 42_000 });
  await gateway.completeNotaTransaction(transaction.id);
  expect(gateway.getSnapshot().skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(21);
  expect(buildRevenueReport(gateway.getSnapshot()).today).toBe(131_000);

  openArchive(gateway);
  fireEvent.click(screen.getByRole('button', { name: 'Buka kembali untuk edit' }));
  const confirmation = screen.getByRole('dialog', { name: /Buka kembali nota/i });
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Buka kembali' }));
  await waitFor(() => expect(gateway.getSnapshot().notaTransactions[0]?.status).toBe('reopened'));
  await act(async () => { await gateway.updateNotaLine(transaction.id, pageB.id, pageB.lines[0]!.id, { quantity: 3 }); });
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: /Selesaikan nota/i })).getByRole('button', { name: 'Selesaikan' }));
  await waitFor(() => expect(gateway.getSnapshot().notaTransactions[0]?.status).toBe('completed'));
  expect(gateway.getSnapshot().skus.find((sku) => sku.id === 'sku-1')?.stock).toBe(20);
  expect(gateway.getSnapshot().adjustments).toHaveLength(2);
  expect(buildRevenueReport(gateway.getSnapshot()).today).toBe(173_000);
});
