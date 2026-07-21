import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/renderer/App';
import { buildRevenueReport } from '../../src/domain/reports';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

function openNota(gateway = new MockOperationsGateway()) {
  render(<App gateway={gateway} />);
  fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
  return gateway;
}

test('selects Amelia A and B pages, adds C, and restores a cancelled page from Sampah', async () => {
  openNota();
  expect(screen.getByRole('button', { name: 'Halaman A' })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(screen.getByRole('button', { name: 'Halaman B' }));
  expect(screen.getByRole('button', { name: 'Halaman B' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Tambah Nota' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Halaman C' })).toHaveAttribute('aria-pressed', 'true'));

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Batalkan halaman C' })); });
  expect(screen.getByText(/Halaman C dipindahkan ke Sampah/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Daftar Nota' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Sampah' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pulihkan halaman C' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Halaman C' })).toHaveAttribute('aria-pressed', 'true'));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Daftar Nota' })).not.toBeInTheDocument());
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

test('new transaction selects its A page and global search opens from its keyboard shortcut', async () => {
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
  const listTrigger = screen.getByRole('button', { name: 'Daftar Nota' });
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

test('Escape from a nested reopening confirmation restores the clicked control inside Daftar Nota', async () => {
  const gateway = new MockOperationsGateway();
  await gateway.completeNotaTransaction(gateway.getSnapshot().notaTransactions[0]!.id);
  openNota(gateway);
  const listTrigger = screen.getByRole('button', { name: 'Daftar Nota' });
  fireEvent.click(listTrigger);
  const drawer = screen.getByRole('dialog', { name: 'Daftar Nota' });
  const reopen = within(drawer).getByRole('button', { name: 'Buka kembali' });
  fireEvent.click(reopen);

  const confirmation = screen.getByRole('dialog', { name: /Buka kembali nota/i });
  fireEvent.keyDown(confirmation, { key: 'Escape' });

  expect(screen.getByRole('dialog', { name: 'Daftar Nota' })).toBeInTheDocument();
  expect(reopen).toHaveFocus();
  expect(listTrigger).not.toHaveFocus();
});

test('cancelling a transaction opens Sampah directly', async () => {
  openNota();
  fireEvent.click(screen.getByRole('button', { name: 'Batalkan transaksi' }));
  const confirmation = screen.getByRole('dialog', { name: /Batalkan transaksi/i });
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Batalkan' }));
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Daftar Nota' })).toBeInTheDocument());
  expect(screen.getByRole('tab', { name: 'Sampah' })).toHaveAttribute('aria-selected', 'true');
});

test('restoring a completed transaction returns to Arsip rather than the working selection', async () => {
  const gateway = new MockOperationsGateway();
  const transaction = gateway.getSnapshot().notaTransactions[0]!;
  await gateway.completeNotaTransaction(transaction.id);
  await gateway.cancelNotaTransaction(transaction.id);
  openNota(gateway);
  fireEvent.click(screen.getByRole('button', { name: 'Buka Arsip' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Sampah' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pulihkan transaksi' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Arsip' })).toHaveAttribute('aria-selected', 'true'));
  expect(screen.getByRole('button', { name: new RegExp(transaction.baseNumber) })).toBeInTheDocument();
});

test.each(['draft', 'reopened'] as const)('restoring a cancelled %s transaction selects its working page', async (status) => {
  const gateway = new MockOperationsGateway();
  const transaction = gateway.getSnapshot().notaTransactions[0]!;
  if (status === 'reopened') {
    await gateway.completeNotaTransaction(transaction.id);
    await gateway.reopenNotaTransaction(transaction.id);
  }
  await gateway.cancelNotaTransaction(transaction.id);
  openNota(gateway);
  fireEvent.click(screen.getByRole('button', { name: 'Buka Arsip' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Sampah' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pulihkan transaksi' }));
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Nota Dikerjakan' })).toBeInTheDocument());
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
  const add = screen.getByRole('button', { name: 'Tambah Nota' });
  fireEvent.click(add);
  await waitFor(() => expect(add).toBeDisabled());
  expect(screen.getByRole('button', { name: 'Batalkan transaksi' })).toBeDisabled();
  gateway.release();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Halaman C' })).toHaveAttribute('aria-pressed', 'true'));
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

  openNota(gateway);
  fireEvent.click(screen.getByRole('button', { name: 'Buka Arsip' }));
  fireEvent.click(screen.getByRole('button', { name: 'Buka kembali' }));
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
