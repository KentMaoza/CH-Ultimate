import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/renderer/App';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

function openNota(gateway?: MockOperationsGateway) {
  render(<App gateway={gateway} />);
  fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
}

function chooseWarehouseSku(row: number, query: string) {
  fireEvent.focus(screen.getByRole('textbox', { name: `Nama barang baris ${row}` }));
  const search = screen.getByRole('searchbox', { name: 'Cari SKU Gudang' });
  fireEvent.change(search, { target: { value: query } });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'Enter' });
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
  expect(screen.getByLabelText('Pelanggan').closest('label')).toHaveClass('chu-nota-workspace__customer');
  expect(screen.getByLabelText('Tempat').closest('label')).toHaveClass('chu-nota-workspace__customer');
});

test('SKU Gudang panel uses the original monochrome container', () => {
  openNota();
  expect(screen.getByRole('region', { name: 'SKU Gudang' })).toHaveClass('chu-nota-workspace__warehouse');
  expect(screen.getByRole('region', { name: 'SKU Gudang' })).not.toHaveClass('chu-nota-workspace__warehouse--green');
});

test('Nota grid has the required headers and fifteen A-page rows', () => {
  openNota();
  expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
    'NO', 'NAMA BARANG', 'JENIS', 'JUMLAH', 'PCS', 'LSN', 'HARGA PCS', 'HARGA LSN', 'TOTAL', 'AKSI',
  ]);
  expect(within(screen.getByTestId('nota-grid-body')).getAllByRole('row')).toHaveLength(15);
  expect(screen.getByText('1A')).toBeInTheDocument();
  expect(screen.getByText('15A')).toBeInTheDocument();
});

test('page tabs and the large suffix use stable A and B colors', () => {
  openNota();
  const pageA = screen.getByRole('button', { name: 'Halaman A' });
  const pageB = screen.getByRole('button', { name: 'Halaman B' });
  expect(pageA).toHaveStyle({ '--nota-page-color': '#D32F2F' });
  expect(pageB).toHaveStyle({ '--nota-page-color': '#1565C0' });
  expect(screen.getByText('NOTA DIBUAT').parentElement).toHaveStyle({ '--nota-page-color': '#D32F2F' });
  fireEvent.click(pageB);
  expect(screen.getByText('NOTA DIBUAT').parentElement).toHaveStyle({ '--nota-page-color': '#1565C0' });
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

test('title-cases natural-language Nota fields as the operator types', async () => {
  openNota();
  const customer = screen.getByLabelText('Pelanggan') as HTMLInputElement;
  fireEvent.change(customer, { target: { value: 'amelia pelanggan lama' } });
  fireEvent.change(screen.getByLabelText('Tempat'), { target: { value: 'saipah lorong dua' } });
  fireEvent.change(screen.getByLabelText('Nama barang baris 3'), { target: { value: 'kopi hITAM ch001 XL' } });
  fireEvent.change(screen.getByLabelText('Jenis baris 3'), { target: { value: 'minuman grosir' } });

  expect(customer).toHaveValue('Amelia Pelanggan Lama');
  expect(screen.getByLabelText('Tempat')).toHaveValue('Saipah Lorong Dua');
  expect(screen.getByLabelText('Nama barang baris 3')).toHaveValue('Kopi Hitam CH001 XL');
  expect(screen.getByLabelText('Jenis baris 3')).toHaveValue('Minuman Grosir');

  fireEvent.change(customer, { target: { value: 'amelia baru pelanggan lama', selectionStart: 12, selectionEnd: 12 } });
  expect(customer).toHaveValue('Amelia Baru Pelanggan Lama');
  await waitFor(() => expect(customer.selectionStart).toBe(12));
});

test('clears a fixed Nota row without exposing application undo controls', () => {
  openNota();
  const row1 = screen.getByTestId('nota-grid-row-1');
  const row2 = screen.getByTestId('nota-grid-row-2');
  fireEvent.change(screen.getByLabelText('Harga PCS baris 1'), { target: { value: '52000' } });
  fireEvent.click(within(row1).getByRole('button', { name: 'Hapus' }));

  expect(screen.getByLabelText('Nama barang baris 1')).toHaveValue('');
  expect(screen.getByLabelText('Harga PCS baris 1')).toHaveValue('');
  expect(screen.getByLabelText('Nama barang baris 2')).toHaveValue('Jasa bungkus');
  expect(screen.queryByRole('button', { name: 'Undo perubahan' })).not.toBeInTheDocument();
});

test('Ctrl or Cmd+Z is left to the focused input instead of application history', async () => {
  openNota();
  const customer = screen.getByLabelText('Pelanggan');
  fireEvent.change(customer, { target: { value: 'pelanggan baru' } });

  expect(fireEvent.keyDown(customer, { key: 'z', ctrlKey: true })).toBe(true);

  await waitFor(() => expect(customer).toHaveValue('Pelanggan Baru'));
});

test('SKU Gudang panel filters names, current and alias numbers without archived entries', async () => {
  const gateway = new MockOperationsGateway();
  const longSku = '899123456789012345678901234567890123456789012345';
  await gateway.updateSku('sku-1', { skuNumber: longSku });
  await gateway.setArchived('sku-4', true);
  openNota(gateway);

  const name = screen.getByRole('textbox', { name: 'Nama barang baris 3' });
  expect(name).not.toHaveAttribute('role', 'combobox');
  expect(screen.getByRole('region', { name: 'SKU Gudang' })).toBeInTheDocument();
  const search = screen.getByRole('searchbox', { name: 'Cari SKU Gudang' });
  fireEvent.change(search, { target: { value: longSku.slice(0, 22) } });
  expect(screen.getByRole('option', { name: new RegExp(longSku) })).toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'BRS-108-BLK' } });
  expect(screen.getByRole('option', { name: new RegExp(longSku) })).toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'Minuman' } });
  expect(screen.queryByRole('option', { name: /Minuman Serbuk Cokelat/ })).not.toBeInTheDocument();
});

test('SKU Gudang paginates 3.140 imports by fifty and keeps zero, negative, and untracked SKU selectable', async () => {
  const gateway = new MockOperationsGateway();
  const skus = Array.from({ length: 3_140 }, (_, index) => ({
    id: `bulk-${index}`,
    skuNumber: `BULK-${String(index).padStart(4, '0')}`,
    aliases: index === 1 ? ['NEGATIF-LAMA'] : [],
    name: `Barang Bulk ${index}`,
    referencePrice: 10_000 + index,
    stock: index === 0 ? 0 : index === 1 ? -4 : index,
    tracked: index !== 2,
    note: '',
    imageUrl: index === 0 ? 'https://invalid.test/broken.jpg' : '',
    createdAt: '2026-07-21T00:00:00.000Z',
    archived: index === 3,
  }));
  await gateway.replaceFromWorkbook({ skus, loaded: skus.length, skipped: 0, warnings: [] }, 'Fixture 3.140 SKU');
  await gateway.createNotaTransaction();
  openNota(gateway);

  expect(screen.getByText('3.139 SKU aktif')).toBeInTheDocument();
  expect(within(screen.getByRole('listbox', { name: 'Hasil SKU Gudang' })).getAllByRole('option')).toHaveLength(50);
  fireEvent.click(screen.getByRole('button', { name: 'SKU berikutnya' }));
  expect(screen.getByText('2/63')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'SKU sebelumnya' }));

  const search = screen.getByRole('searchbox', { name: 'Cari SKU Gudang' });
  fireEvent.change(search, { target: { value: 'BULK-0000' } });
  const zero = screen.getByRole('option', { name: /BULK-0000.*Stok 0/ });
  fireEvent.error(zero.querySelector('img')!);
  expect(within(zero).getByText('CHU')).toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'NEGATIF-LAMA' } });
  expect(screen.getByRole('option', { name: /BULK-0001.*Stok -4/ })).toBeEnabled();
  fireEvent.change(search, { target: { value: 'BULK-0002' } });
  expect(screen.getByRole('option', { name: /Stok tidak dilacak/ })).toBeEnabled();
  fireEvent.change(search, { target: { value: 'BULK-0003' } });
  expect(within(screen.getByRole('listbox', { name: 'Hasil SKU Gudang' })).queryByRole('option')).not.toBeInTheDocument();
});

test('keyboard selection from SKU Gudang links the active row and manual edits unlink it', () => {
  const gateway = new MockOperationsGateway();
  openNota(gateway);
  const name = screen.getByRole('textbox', { name: 'Nama barang baris 3' });
  chooseWarehouseSku(3, 'Beras');

  let row = gateway.getSnapshot().notaTransactions[0]!.pages[0]!.lines[2]!;
  expect(row).toMatchObject({ skuId: 'sku-1', description: 'Beras Hitam Premium 1 kg', pcsPrice: 42_000, lsnPrice: 504_000, unit: 'pcs' });
  fireEvent.change(name, { target: { value: 'Beras eceran' } });
  row = gateway.getSnapshot().notaTransactions[0]!.pages[0]!.lines[2]!;
  expect(row.skuId).toBeUndefined();
});

test('keeps the stored warehouse SKU name unchanged until the operator edits it', async () => {
  const gateway = new MockOperationsGateway();
  await gateway.updateSku('sku-1', { name: 'beras hITAM ch001 XL' });
  openNota(gateway);

  chooseWarehouseSku(3, 'BRS-108-BLK');
  expect(screen.getByLabelText('Nama barang baris 3')).toHaveValue('beras hITAM ch001 XL');

  fireEvent.change(screen.getByLabelText('Nama barang baris 3'), { target: { value: 'beras hITAM ch001 XL revisi' } });
  expect(screen.getByLabelText('Nama barang baris 3')).toHaveValue('Beras Hitam CH001 XL Revisi');
  expect(gateway.getSnapshot().skus.find((sku) => sku.id === 'sku-1')?.name).toBe('beras hITAM ch001 XL');
});

test('tracked and untracked SKU choices both apply 1x and 12x reference prices', () => {
  const gateway = new MockOperationsGateway();
  openNota(gateway);
  chooseWarehouseSku(3, 'Beras');
  chooseWarehouseSku(4, 'Kemeja');
  const lines = gateway.getSnapshot().notaTransactions[0]!.pages[0]!.lines;
  expect(lines[2]).toMatchObject({ skuId: 'sku-1', pcsPrice: 42_000, lsnPrice: 504_000 });
  expect(lines[3]).toMatchObject({ skuId: 'sku-2', pcsPrice: 185_000, lsnPrice: 2_220_000 });
});

test('SKU selection clears replaced price validation without clearing another invalid field', () => {
  openNota();
  const quantity = screen.getByLabelText('Jumlah baris 3');
  const lsnPrice = screen.getByLabelText('Harga LSN baris 3');
  const pcsPrice = screen.getByLabelText('Harga PCS baris 3');
  fireEvent.change(quantity, { target: { value: '1.5' } });
  fireEvent.change(lsnPrice, { target: { value: '500.5' } });
  fireEvent.change(pcsPrice, { target: { value: '-1' } });

  chooseWarehouseSku(3, 'Beras');

  expect(lsnPrice).toHaveValue('504.000');
  expect(pcsPrice).toHaveValue('42.000');
  expect(lsnPrice).not.toHaveAttribute('aria-invalid', 'true');
  expect(pcsPrice).not.toHaveAttribute('aria-invalid', 'true');
  expect(quantity).toHaveValue('1.5');
  expect(quantity).toHaveAttribute('aria-invalid', 'true');

  fireEvent.change(quantity, { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  expect(screen.getByRole('dialog', { name: 'Selesaikan nota?' })).toBeInTheDocument();
});

test('price fields stay grouped while focused and completion focuses the first invalid value', () => {
  openNota();
  const price = screen.getByLabelText('Harga PCS baris 3');
  fireEvent.focus(price);
  fireEvent.change(price, { target: { value: '125000' } });
  expect(price).toHaveValue('125.000');
  fireEvent.blur(price);
  expect(price).toHaveValue('125.000');
  fireEvent.focus(price);
  expect(price).toHaveValue('125.000');
  const quantity = screen.getByLabelText('Jumlah baris 3');
  fireEvent.change(quantity, { target: { value: '1.5' } });
  expect(quantity).toHaveAttribute('aria-invalid', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  expect(quantity).toHaveFocus();
  expect(screen.getByText(/Perbaiki nilai angka/i)).toHaveTextContent(/bilangan bulat/i);
});

test('typing and pasting Indonesian price separators never leaves 5.2000 behind', () => {
  openNota();
  const pcsPrice = screen.getByLabelText('Harga PCS baris 3');
  fireEvent.focus(pcsPrice);
  for (const value of ['5', '52', '520', '5.200', '5.2000']) {
    fireEvent.change(pcsPrice, { target: { value, selectionStart: value.length } });
  }
  expect(pcsPrice).toHaveValue('52.000');

  const lsnPrice = screen.getByLabelText('Harga LSN baris 3');
  fireEvent.change(lsnPrice, { target: { value: '52.000', selectionStart: 6 } });
  expect(lsnPrice).toHaveValue('52.000');
  fireEvent.change(lsnPrice, { target: { value: '52.00', selectionStart: 5 } });
  expect(lsnPrice).toHaveValue('5.200');
});

test('completion finds an invalid raw number on another active page and preserves it until corrected', async () => {
  const gateway = new MockOperationsGateway();
  openNota(gateway);
  const quantityA = screen.getByLabelText('Jumlah baris 3');
  fireEvent.change(quantityA, { target: { value: '1.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Halaman B' }));

  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));

  expect(screen.queryByRole('dialog', { name: 'Selesaikan nota?' })).not.toBeInTheDocument();
  expect(gateway.getSnapshot().notaTransactions[0]?.status).toBe('draft');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Halaman A' })).toHaveAttribute('aria-pressed', 'true'));
  const restoredQuantity = screen.getByLabelText('Jumlah baris 3');
  expect(restoredQuantity).toHaveValue('1.5');
  expect(restoredQuantity).toHaveFocus();
  expect(screen.getByText(/Perbaiki nilai angka/i)).toBeInTheDocument();

  fireEvent.change(restoredQuantity, { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  expect(screen.getByRole('dialog', { name: 'Selesaikan nota?' })).toBeInTheDocument();
});

test('blurred grouped numeric values remain valid when completing without refocusing', () => {
  openNota();
  fireEvent.change(screen.getByLabelText('Nama barang baris 3'), { target: { value: 'Kopi' } });
  fireEvent.change(screen.getByLabelText('Jumlah baris 3'), { target: { value: '2' } });
  const price = screen.getByLabelText('Harga PCS baris 3');
  fireEvent.change(price, { target: { value: '125000' } });
  fireEvent.blur(price);

  expect(price).toHaveValue('125.000');
  expect(price).not.toHaveAttribute('aria-invalid', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  expect(screen.getByRole('dialog', { name: 'Selesaikan nota?' })).toBeInTheDocument();
});

test('linked SKU number appears in the grid and disappears with a manual edit', () => {
  const gateway = new MockOperationsGateway();
  openNota(gateway);
  const name = screen.getByRole('textbox', { name: 'Nama barang baris 3' });
  chooseWarehouseSku(3, 'Beras');

  expect(screen.getByTestId('nota-grid-row-3')).toHaveTextContent('BRS-108-BLK');
  expect(gateway.getSnapshot().notaTransactions[0]!.pages[0]!.lines[2]).toMatchObject({ skuId: 'sku-1' });
  fireEvent.change(name, { target: { value: 'Beras eceran' } });
  expect(screen.getByTestId('nota-grid-row-3')).not.toHaveTextContent('BRS-108-BLK');
  expect(gateway.getSnapshot().notaTransactions[0]!.pages[0]!.lines[2]?.skuId).toBeUndefined();
});

test('SKU Gudang exposes keyboard-highlighted options and can be collapsed', () => {
  openNota();
  const search = screen.getByRole('searchbox', { name: 'Cari SKU Gudang' });
  fireEvent.change(search, { target: { value: 'Beras' } });
  fireEvent.keyDown(search, { key: 'ArrowDown' });

  const option = screen.getByRole('option', { name: /Beras Hitam Premium 1 kg/ });
  expect(option).toHaveAttribute('id');
  expect(option).toHaveAttribute('aria-selected', 'true');
  expect(search).toHaveAttribute('aria-activedescendant', option.id);
  const listbox = screen.getByRole('listbox');
  const optionIds = within(listbox).getAllByRole('option').map((item) => item.id);
  expect(new Set(optionIds).size).toBe(optionIds.length);

  fireEvent.click(screen.getByRole('button', { name: 'Lipat SKU Gudang' }));
  expect(screen.queryByRole('searchbox', { name: 'Cari SKU Gudang' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Buka SKU Gudang' }));
  expect(screen.getByRole('searchbox', { name: 'Cari SKU Gudang' })).toBeInTheDocument();
});

test('SKU Gudang uses the first blank row by default and preserves operator fields when replacing a row', async () => {
  const gateway = new MockOperationsGateway();
  openNota(gateway);

  expect(screen.getByTestId('nota-grid-row-3')).toHaveClass('chu-nota-workspace__row--target');
  const search = screen.getByRole('searchbox', { name: 'Cari SKU Gudang' });
  fireEvent.change(search, { target: { value: 'Beras' } });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(gateway.getSnapshot().notaTransactions[0]!.pages[0]!.lines[2]).toMatchObject({ skuId: 'sku-1' });

  fireEvent.change(screen.getByLabelText('Jenis baris 3'), { target: { value: 'Grosir' } });
  fireEvent.change(screen.getByLabelText('Jumlah baris 3'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'LSN baris 3' }));
  fireEvent.focus(screen.getByLabelText('Jenis baris 3'));
  fireEvent.change(search, { target: { value: 'Kemeja' } });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'Enter' });

  expect(gateway.getSnapshot().notaTransactions[0]!.pages[0]!.lines[2]).toMatchObject({
    skuId: 'sku-2', description: 'Kemeja Linen Putih', kind: 'Grosir', quantity: 4, unit: 'lsn', pcsPrice: 185_000, lsnPrice: 2_220_000,
  });
  await waitFor(() => expect(screen.getByLabelText('Jumlah baris 3')).toHaveFocus());
});

test('Nota starts at 150 percent and exposes the 175 percent session-only font preset', () => {
  openNota();
  const workspace = screen.getByTestId('chu-nota-workspace');
  expect(workspace).toHaveStyle({ '--nota-font-scale': '1.5' });
  expect(workspace.style.zoom).toBe('');
  expect(screen.getByRole('button', { name: 'Halaman A' })).toHaveTextContent('Nota A');
  expect(screen.getByRole('button', { name: 'Halaman B' })).toHaveTextContent('Nota B');
  expect(screen.getByRole('button', { name: 'Tambah Nota C' })).toHaveTextContent('+ Tambah Nota C');

  fireEvent.click(screen.getByRole('button', { name: 'Perbesar tulisan' }));
  expect(workspace).toHaveStyle({ '--nota-font-scale': '1.75' });
  expect(screen.getByRole('button', { name: 'Perbesar tulisan' })).toBeDisabled();
  fireEvent.keyDown(window, { key: '0', ctrlKey: true });
  expect(workspace).toHaveStyle({ '--nota-font-scale': '1.5' });
  fireEvent.click(screen.getByRole('button', { name: 'Perkecil tulisan' }));
  expect(workspace).toHaveStyle({ '--nota-font-scale': '1.25' });
});

test('shows a separate live total for every active Nota page', async () => {
  openNota();
  expect(screen.getByTestId('nota-page-total-A')).toHaveTextContent(/Total Nota A.*Rp\s*47\.000/);
  expect(screen.getByTestId('nota-page-total-B')).toHaveTextContent(/Total Nota B.*Rp\s*0/);

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Halaman B' })); });
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Jumlah baris 1'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Harga PCS baris 1'), { target: { value: '12000' } });
  });
  expect(screen.getByTestId('nota-page-total-A')).toHaveTextContent(/Rp\s*47\.000/);
  expect(screen.getByTestId('nota-page-total-B')).toHaveTextContent(/Rp\s*24\.000/);

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tambah Nota C' })); });
  expect(screen.getByTestId('nota-page-total-C')).toHaveTextContent(/Total Nota C.*Rp\s*0/);
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

test('derives the lsn total from twelve pieces when only Harga PCS is entered', () => {
  openNota();
  fireEvent.change(screen.getByLabelText('Jumlah baris 3'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'LSN baris 3' }));
  fireEvent.change(screen.getByLabelText('Harga PCS baris 3'), { target: { value: '165000' } });

  expect(screen.getByLabelText('Harga LSN baris 3')).toHaveValue('');
  expect(screen.getByLabelText('Total baris 3')).toHaveTextContent('9.900.000');
});

test('grid arrows always traverse data cells, including unit buttons and row wrapping', () => {
  openNota();
  const name = screen.getByRole('textbox', { name: 'Nama barang baris 1' });
  const kind = screen.getByLabelText('Jenis baris 1');
  fireEvent.change(kind, { target: { value: 'Pangan' } });
  act(() => kind.focus());
  (kind as HTMLInputElement).setSelectionRange(3, 3);
  fireEvent.keyDown(kind, { key: 'ArrowRight' });
  expect(screen.getByLabelText('Jumlah baris 1')).toHaveFocus();

  fireEvent.keyDown(screen.getByLabelText('Jumlah baris 1'), { key: 'ArrowDown' });
  expect(screen.getByLabelText('Jumlah baris 2')).toHaveFocus();
  fireEvent.keyDown(screen.getByLabelText('Jumlah baris 2'), { key: 'ArrowUp' });
  expect(screen.getByLabelText('Jumlah baris 1')).toHaveFocus();

  const pcs = screen.getByRole('button', { name: 'PCS baris 1' });
  act(() => pcs.focus());
  fireEvent.keyDown(pcs, { key: 'ArrowRight' });
  expect(screen.getByRole('button', { name: 'LSN baris 1' })).toHaveFocus();

  const total = screen.getByLabelText('Total baris 1');
  act(() => total.focus());
  fireEvent.keyDown(total, { key: 'ArrowRight' });
  expect(screen.getByLabelText('Nama barang baris 2')).toHaveFocus();
  fireEvent.keyDown(screen.getByLabelText('Nama barang baris 2'), { key: 'ArrowLeft' });
  expect(total).toHaveFocus();

  fireEvent.keyDown(screen.getByLabelText('Jenis baris 1'), { key: 'ArrowDown' });
  expect(screen.getByLabelText('Jenis baris 2')).toHaveFocus();
  fireEvent.keyDown(screen.getByLabelText('Jenis baris 2'), { key: 'ArrowUp' });
  expect(screen.getByLabelText('Jenis baris 1')).toHaveFocus();
  fireEvent.keyDown(screen.getByLabelText('Jenis baris 1'), { key: 'ArrowUp' });
  expect(screen.getByLabelText('Jenis baris 1')).toHaveFocus();

  act(() => pcs.focus());
  fireEvent.keyDown(pcs, { key: 'Enter' });
  expect(pcs).toHaveFocus();
  expect(pcs).toHaveAttribute('aria-pressed', 'true');

  act(() => name.focus());
  fireEvent.keyDown(name, { key: 'ArrowLeft' });
  expect(name).toHaveFocus();
});

test('Shift+Arrow keeps native text selection and Nota text remains selectable for copy', () => {
  openNota();
  const price = screen.getByLabelText('Harga PCS baris 1') as HTMLInputElement;
  fireEvent.focus(price);
  price.setSelectionRange(0, 2);

  expect(fireEvent.mouseDown(price)).toBe(true);
  expect(fireEvent.keyDown(price, { key: 'ArrowRight', shiftKey: true })).toBe(true);
  expect(fireEvent.keyDown(price, { key: 'c', ctrlKey: true })).toBe(true);
  expect(fireEvent.copy(price)).toBe(true);
});

test.each(['ctrlKey', 'metaKey'] as const)('%s+P requests demo print without opening production print', (modifier) => {
  openNota();
  const event = { key: 'p', [modifier]: true };
  expect(fireEvent.keyDown(window, event)).toBe(false);
  expect(screen.getByText(/Print Nota belum aktif/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Print Nota' })).toBeDisabled();
});

test('click and Enter give the selected LSN or PCS unit a black selection block', () => {
  openNota();
  const lsn = screen.getByRole('button', { name: 'LSN baris 3' });
  const pcs = screen.getByRole('button', { name: 'PCS baris 3' });

  fireEvent.keyDown(lsn, { key: 'Enter' });
  expect(lsn).toHaveClass('chu-nota-workspace__unit--selected');
  expect(pcs).not.toHaveClass('chu-nota-workspace__unit--selected');

  fireEvent.click(pcs);
  expect(pcs).toHaveClass('chu-nota-workspace__unit--selected');
  expect(lsn).not.toHaveClass('chu-nota-workspace__unit--selected');
});

test.each([
  ['unit', 'LSN baris 1'],
  ['output', 'Total baris 1'],
])('Ctrl or Cmd+K does not steal focus from a grid %s control', (_kind, label) => {
  openNota();
  const editable = screen.getByLabelText(label);
  act(() => editable.focus());
  fireEvent.keyDown(editable, { key: 'k', ctrlKey: true });
  expect(editable).toHaveFocus();
  fireEvent.keyDown(editable, { key: 'k', metaKey: true });
  expect(editable).toHaveFocus();
  expect(screen.getByRole('combobox', { name: 'Cari nota' })).not.toHaveFocus();
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
