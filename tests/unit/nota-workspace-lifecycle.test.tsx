import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/renderer/App';
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
  expect(screen.getByRole('button', { name: 'Halaman C' })).toHaveAttribute('aria-pressed', 'true');
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
