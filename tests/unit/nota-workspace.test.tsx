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

test('Nota starts at large text and exposes session-only font presets and explicit next-page label', () => {
  openNota();
  const workspace = screen.getByTestId('chu-nota-workspace');
  expect(workspace).toHaveStyle({ '--nota-font-scale': '1.25' });
  expect(workspace.style.zoom).toBe('');
  expect(screen.getByRole('button', { name: 'Halaman A' })).toHaveTextContent('Nota A');
  expect(screen.getByRole('button', { name: 'Halaman B' })).toHaveTextContent('Nota B');
  expect(screen.getByRole('button', { name: 'Tambah Nota C' })).toHaveTextContent('+ Tambah Nota C');

  fireEvent.click(screen.getByRole('button', { name: 'Perbesar tulisan' }));
  expect(workspace).toHaveStyle({ '--nota-font-scale': '1.5' });
  fireEvent.keyDown(window, { key: '0', ctrlKey: true });
  expect(workspace).toHaveStyle({ '--nota-font-scale': '1.25' });
  fireEvent.click(screen.getByRole('button', { name: 'Perkecil tulisan' }));
  expect(workspace).toHaveStyle({ '--nota-font-scale': '1' });
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

  const lsn = screen.getByRole('button', { name: 'LSN baris 1' });
  act(() => lsn.focus());
  fireEvent.keyDown(lsn, { key: 'ArrowRight' });
  expect(screen.getByRole('button', { name: 'PCS baris 1' })).toHaveFocus();

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

  act(() => lsn.focus());
  fireEvent.keyDown(lsn, { key: 'Enter' });
  expect(lsn).toHaveFocus();
  expect(lsn).toHaveAttribute('aria-pressed', 'true');

  act(() => name.focus());
  fireEvent.keyDown(name, { key: 'ArrowLeft' });
  expect(name).toHaveFocus();
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
