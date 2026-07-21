import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/renderer/App';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

function openNota(gateway?: MockOperationsGateway) {
  render(<App gateway={gateway} />);
  fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
}

test('Nota opens as a dedicated workspace and back restores the CH Ultimate shell', () => {
  openNota();
  expect(screen.getByTestId('chu-nota-workspace')).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Modul CH Ultimate' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Nota', level: 1 })).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Pelanggan'), { target: { value: 'Nadia' } });
  fireEvent.click(screen.getByRole('button', { name: 'Kembali ke CH Ultimate' }));
  expect(screen.getByRole('navigation', { name: 'Modul CH Ultimate' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'SKU Gudang', level: 1 })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
  expect(screen.getByLabelText('Pelanggan')).toHaveValue('Nadia');
});

test('Nota grid has the required headers and fifteen A-page rows', () => {
  openNota();
  expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
    'NO', 'NAMA BARANG', 'JENIS', 'JUMLAH', 'LSN', 'PCS', 'HARGA LSN', 'HARGA PCS', 'TOTAL', 'AKSI',
  ]);
  expect(within(screen.getByTestId('nota-grid-body')).getAllByRole('row')).toHaveLength(15);
  expect(screen.getByText('1A')).toBeInTheDocument();
  expect(screen.getByText('15A')).toBeInTheDocument();
});

test('Nota totals seeded values across active transaction pages', async () => {
  const gateway = new MockOperationsGateway();
  const transaction = gateway.getSnapshot().notaTransactions[0]!;
  const pageB = transaction.pages.find((page) => page.suffix === 'B')!;
  await gateway.updateNotaLine(transaction.id, pageB.id, pageB.lines[0]!.id, {
    description: 'Jasa kirim halaman B', quantity: 1, pcsPrice: 53_000,
  });

  openNota(gateway);
  expect(screen.getByText(/CHU-\d{8}-0001A/)).toBeInTheDocument();
  expect(screen.getByLabelText('Pelanggan')).toHaveValue('Amelia');
  expect(screen.getByLabelText('Pembayaran')).toHaveValue('unclassified');
  expect(screen.getByTestId('nota-transaction-total')).toHaveTextContent('100.000');
});

test('basic fields, unit, and dual prices update the in-memory Nota total', () => {
  openNota();
  fireEvent.change(screen.getByLabelText('Nama barang baris 3'), { target: { value: 'Kopi' } });
  fireEvent.change(screen.getByLabelText('Jenis baris 3'), { target: { value: 'Minuman' } });
  fireEvent.change(screen.getByLabelText('Jumlah baris 3'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Harga LSN baris 3'), { target: { value: '150000' } });
  fireEvent.click(screen.getByRole('button', { name: 'LSN baris 3' }));

  expect(screen.getByLabelText('Nama barang baris 3')).toHaveValue('Kopi');
  expect(screen.getByText('300.000')).toBeInTheDocument();
  expect(screen.getByTestId('nota-transaction-total')).toHaveTextContent('347.000');
});

test('SKU combobox filters names, current and alias numbers without archived entries and preserves a long SKU', async () => {
  const gateway = new MockOperationsGateway();
  const longSku = '899123456789012345678901234567890123456789012345';
  await gateway.updateSku('sku-1', { skuNumber: longSku });
  await gateway.setArchived('sku-4', true);
  openNota(gateway);

  const name = screen.getByRole('combobox', { name: 'Nama barang baris 3' });
  fireEvent.change(name, { target: { value: longSku.slice(0, 22) } });
  expect(screen.getByRole('option', { name: new RegExp(longSku) })).toBeInTheDocument();
  fireEvent.change(name, { target: { value: 'BRS-108-BLK' } });
  expect(screen.getByRole('option', { name: new RegExp(longSku) })).toBeInTheDocument();
  fireEvent.change(name, { target: { value: 'Minuman' } });
  expect(screen.queryByRole('option', { name: /Minuman Serbuk Cokelat/ })).not.toBeInTheDocument();
});

test('keyboard SKU selection links snapshot, applies independent prices, and manual edits unlink it', () => {
  const gateway = new MockOperationsGateway();
  openNota(gateway);
  const name = screen.getByRole('combobox', { name: 'Nama barang baris 3' });
  fireEvent.change(name, { target: { value: 'Beras' } });
  fireEvent.keyDown(name, { key: 'ArrowDown' });
  fireEvent.keyDown(name, { key: 'Enter' });

  let row = gateway.getSnapshot().notaTransactions[0]!.pages[0]!.lines[2]!;
  expect(row).toMatchObject({ skuId: 'sku-1', description: 'Beras Hitam Premium 1 kg', pcsPrice: 42_000, lsnPrice: 504_000, unit: 'pcs' });
  fireEvent.change(name, { target: { value: 'Beras eceran' } });
  row = gateway.getSnapshot().notaTransactions[0]!.pages[0]!.lines[2]!;
  expect(row.skuId).toBeUndefined();
});

test('tracked and untracked SKU choices both apply 1x and 12x reference prices', () => {
  const gateway = new MockOperationsGateway();
  openNota(gateway);
  const choose = (row: number, value: string) => {
    const input = screen.getByRole('combobox', { name: `Nama barang baris ${row}` });
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
  };
  choose(3, 'Beras');
  choose(4, 'Kemeja');
  const lines = gateway.getSnapshot().notaTransactions[0]!.pages[0]!.lines;
  expect(lines[2]).toMatchObject({ skuId: 'sku-1', pcsPrice: 42_000, lsnPrice: 504_000 });
  expect(lines[3]).toMatchObject({ skuId: 'sku-2', pcsPrice: 185_000, lsnPrice: 2_220_000 });
});

test('numeric editing keeps invalid raw text, formats valid price on blur, and completion focuses first invalid value', () => {
  openNota();
  const price = screen.getByLabelText('Harga PCS baris 3');
  fireEvent.change(price, { target: { value: '125000' } });
  fireEvent.blur(price);
  expect(price).toHaveValue('125.000');
  fireEvent.focus(price);
  expect(price).toHaveValue('125000');
  const quantity = screen.getByLabelText('Jumlah baris 3');
  fireEvent.change(quantity, { target: { value: '1.5' } });
  expect(quantity).toHaveAttribute('aria-invalid', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  expect(quantity).toHaveFocus();
  expect(screen.getByText(/Perbaiki nilai angka/i)).toHaveTextContent(/bilangan bulat/i);
});

test('unit buttons preserve dual overrides while the active unit controls total', () => {
  openNota();
  fireEvent.change(screen.getByLabelText('Jumlah baris 3'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Harga PCS baris 3'), { target: { value: '12000' } });
  fireEvent.change(screen.getByLabelText('Harga LSN baris 3'), { target: { value: '130000' } });
  fireEvent.blur(screen.getByLabelText('Harga PCS baris 3'));
  fireEvent.blur(screen.getByLabelText('Harga LSN baris 3'));
  fireEvent.click(screen.getByRole('button', { name: 'LSN baris 3' }));
  expect(screen.getByLabelText('Total baris 3')).toHaveTextContent('260.000');
  fireEvent.click(screen.getByRole('button', { name: 'PCS baris 3' }));
  expect(screen.getByLabelText('Total baris 3')).toHaveTextContent('24.000');
  expect(screen.getByLabelText('Harga LSN baris 3')).toHaveValue('130.000');
  expect(screen.getByLabelText('Harga PCS baris 3')).toHaveValue('12.000');
});

test('grid keyboard traversal respects cell, row, and caret boundaries and Escape dismisses suggestions', () => {
  openNota();
  const name = screen.getByRole('combobox', { name: 'Nama barang baris 1' });
  fireEvent.change(name, { target: { value: 'Beras' } });
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  fireEvent.keyDown(name, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  fireEvent.keyDown(name, { key: 'Enter' });
  expect(screen.getByLabelText('Jenis baris 1')).toHaveFocus();
  fireEvent.keyDown(screen.getByLabelText('Jenis baris 1'), { key: 'ArrowDown' });
  expect(screen.getByLabelText('Jenis baris 2')).toHaveFocus();
  fireEvent.keyDown(screen.getByLabelText('Jenis baris 2'), { key: 'ArrowUp' });
  expect(screen.getByLabelText('Jenis baris 1')).toHaveFocus();
  fireEvent.keyDown(screen.getByLabelText('Jenis baris 1'), { key: 'ArrowUp' });
  expect(screen.getByLabelText('Jenis baris 1')).toHaveFocus();
  const lsn = screen.getByRole('button', { name: 'LSN baris 1' });
  lsn.focus();
  fireEvent.keyDown(lsn, { key: 'Enter' });
  expect(lsn).toHaveFocus();
  expect(lsn).toHaveAttribute('aria-pressed', 'true');
  act(() => name.focus());
  (name as HTMLInputElement).setSelectionRange(0, 0);
  fireEvent.keyDown(name, { key: 'ArrowLeft' });
  expect(name).toHaveFocus();
});

test('completion confirmation traps focus, closes with Escape, and restores the trigger', () => {
  openNota();
  const trigger = screen.getByRole('button', { name: 'Selesaikan nota' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog');
  const cancel = within(dialog).getByRole('button', { name: 'Batal' });
  expect(cancel).toHaveFocus();
  fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
  expect(within(dialog).getByRole('button', { name: 'Selesaikan' })).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test('Nota print stays visibly disabled with its demo explanation', () => {
  openNota();
  expect(screen.getByRole('button', { name: 'Print Nota' })).toBeDisabled();
  expect(screen.getByText(/Printing produksi belum tersedia/i)).toBeInTheDocument();
});
