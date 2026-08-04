import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/renderer/App';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import type { Sku } from '../../src/domain/types';

test('shows revenue cards and tracked empty-stock report preview', () => {
  render(<App gateway={new MockOperationsGateway()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.change(screen.getByLabelText('Password omzet baru'), { target: { value: 'demo' } });
  fireEvent.change(screen.getByLabelText('Konfirmasi password omzet'), { target: { value: 'demo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan password omzet' }));
  fireEvent.click(screen.getByRole('button', { name: 'Laporan Omzet' }));
  fireEvent.change(screen.getByLabelText('Password Laporan Omzet'), { target: { value: 'demo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Buka Laporan Omzet' }));
  expect(screen.getByText('OMZET HARI INI')).toBeInTheDocument();
  expect(screen.getByTestId('revenue-today')).toBeInTheDocument();
  expect(screen.getByTestId('revenue-month')).toBeInTheDocument();
  expect(screen.getByTestId('revenue-year')).toBeInTheDocument();
  expect(screen.getByLabelText('Tanggal mulai')).toBeInTheDocument();
  expect(screen.getByLabelText('Tanggal akhir')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Barang Kosong' }));
  expect(screen.getByText('ACC-204-SLV')).toBeInTheDocument();
  expect(screen.getByText('SNK-044')).toBeInTheDocument();
  expect(screen.queryByText('FSH-LINEN-WHT')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Pilih ACC-204-SLV'));
  expect(screen.getByTestId('empty-report-preview')).toHaveTextContent('ACC-204-SLV');
  expect(screen.getByTestId('empty-report-preview')).toHaveTextContent('Jumlah: 0');
  expect(screen.getByTestId('empty-report-preview')).toHaveTextContent(
    'Demo preview',
  );
});

test('settings identifies the session data source and can reset it', async () => {
  render(<App gateway={new MockOperationsGateway()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByText('Fixture sintetis')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reset data demo' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Sesi demo direset');
});

test('empty stock combines supplier and search filters while preserving earlier selections', async () => {
  const gateway = new MockOperationsGateway();
  const base = (id: string, skuNumber: string, name: string): Sku => ({ id, skuNumber, name, aliases: [], identifiers: [], referencePrice: 0, stock: 0, tracked: true, note: '', imageUrl: '', createdAt: '', archived: false });
  await gateway.replaceFromWorkbook({
    skus: [base('a', 'SKU-RED', 'Kemeja Merah CH02'), base('b', 'SKU-BLUE', 'Kemeja Biru CH002'), base('c', 'SKU-PLAIN', 'Tanpa pemasok')],
    loaded: 3, skipped: 0, warnings: [],
  }, 'Fixture filter');
  render(<App gateway={gateway} />);
  fireEvent.click(screen.getByRole('button', { name: 'Barang Kosong' }));

  const supplier = screen.getByLabelText('Supplier');
  fireEvent.change(supplier, { target: { value: 'CH02' } });
  expect(screen.getByText('Kemeja Merah CH02')).toBeInTheDocument();
  expect(screen.queryByText('Kemeja Biru CH002')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Pilih semua hasil filter' }));

  fireEvent.change(supplier, { target: { value: 'CH002' } });
  fireEvent.change(screen.getByLabelText('Cari nama / nomor SKU'), { target: { value: 'SKU-BLUE' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pilih semua hasil filter' }));
  expect(screen.getByTestId('empty-report-preview')).toHaveTextContent('SKU-RED');
  expect(screen.getByTestId('empty-report-preview')).toHaveTextContent('SKU-BLUE');

  fireEvent.change(screen.getByLabelText('Cari nama / nomor SKU'), { target: { value: '' } });
  fireEvent.change(supplier, { target: { value: '__none__' } });
  expect(screen.getByText('Tanpa pemasok')).toBeInTheDocument();
});

test('empty stock can isolate remaining one or two pieces without losing low-stock selections', async () => {
  const gateway = new MockOperationsGateway();
  const base = (id: string, skuNumber: string, name: string, stock: number): Sku => ({ id, skuNumber, name, aliases: [], identifiers: [], referencePrice: 0, stock, tracked: true, note: '', imageUrl: '', createdAt: '', archived: false });
  await gateway.replaceFromWorkbook({
    skus: [
      base('negative', 'SKU-NEGATIVE', 'Negatif CH01', -1),
      base('zero', 'SKU-ZERO', 'Kosong CH01', 0),
      base('one', 'SKU-ONE', 'Sisa Satu CH02', 1),
      base('two', 'SKU-TWO', 'Sisa Dua CH02', 2),
      base('three', 'SKU-THREE', 'Sisa Tiga CH03', 3),
    ],
    loaded: 5, skipped: 0, warnings: [],
  }, 'Fixture stok menipis');
  render(<App gateway={gateway} />);
  fireEvent.click(screen.getByRole('button', { name: 'Barang Kosong' }));

  const condition = screen.getByLabelText('Kondisi stok');
  expect(screen.getByText('SKU-NEGATIVE')).toBeInTheDocument();
  expect(screen.getByText('SKU-ZERO')).toBeInTheDocument();
  expect(screen.queryByText('SKU-ONE')).not.toBeInTheDocument();

  fireEvent.change(condition, { target: { value: 'one' } });
  expect(screen.getByText('SKU-ONE')).toBeInTheDocument();
  expect(screen.queryByText('SKU-TWO')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Pilih SKU-ONE'));

  fireEvent.change(condition, { target: { value: 'two' } });
  expect(screen.getByText('SKU-TWO')).toBeInTheDocument();
  expect(screen.queryByLabelText('Pilih SKU-ONE')).not.toBeInTheDocument();
  expect(screen.getByTestId('empty-report-preview')).toHaveTextContent('SKU-ONE');

  fireEvent.change(condition, { target: { value: 'low' } });
  expect(screen.getByLabelText('Pilih SKU-NEGATIVE')).toBeInTheDocument();
  expect(screen.getByLabelText('Pilih SKU-ZERO')).toBeInTheDocument();
  expect(screen.getByLabelText('Pilih SKU-ONE')).toBeInTheDocument();
  expect(screen.getByLabelText('Pilih SKU-TWO')).toBeInTheDocument();
  expect(screen.queryByLabelText('Pilih SKU-THREE')).not.toBeInTheDocument();
});

test('empty-stock report keeps session-only restock quantities separate from warehouse stock', async () => {
  const gateway = new MockOperationsGateway();
  const stockBefore = gateway.getSnapshot().skus.find((sku) => sku.skuNumber === 'ACC-204-SLV')!.stock;
  render(<App gateway={gateway} />);
  fireEvent.click(screen.getByRole('button', { name: 'Barang Kosong' }));

  const preview = screen.getByTestId('empty-report-preview');
  expect(within(preview).getByText('LAPORAN BARANG KOSONG')).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Jumlah restock ACC-204-SLV' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Pilih ACC-204-SLV'));
  let quantity = within(preview).getByRole('textbox', { name: 'Jumlah restock ACC-204-SLV' });
  expect(quantity).toHaveValue('0');
  fireEvent.click(screen.getByRole('button', { name: 'Kurangi jumlah restock ACC-204-SLV' }));
  expect(quantity).toHaveValue('0');
  fireEvent.click(screen.getByRole('button', { name: 'Tambah jumlah restock ACC-204-SLV' }));
  expect(quantity).toHaveValue('1');
  expect(gateway.getSnapshot().skus.find((sku) => sku.skuNumber === 'ACC-204-SLV')!.stock).toBe(stockBefore);

  expect(within(preview).getByText('ACC-204-SLV')).toBeInTheDocument();
  expect(within(preview).getByText('Jumlah: 1')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Cari nama / nomor SKU'), { target: { value: 'SNK-044' } });
  expect(within(preview).getByText('ACC-204-SLV')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Cari nama / nomor SKU'), { target: { value: '' } });

  quantity = screen.getByRole('textbox', { name: 'Jumlah restock ACC-204-SLV' });
  fireEvent.change(quantity, { target: { value: '12abc' } });
  expect(quantity).toHaveValue('12');
  fireEvent.change(quantity, { target: { value: '12000' } });
  expect(quantity).toHaveValue('9999');
  fireEvent.click(screen.getByLabelText('Pilih ACC-204-SLV'));
  expect(within(preview).queryByText('ACC-204-SLV')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Jumlah restock ACC-204-SLV' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('Pilih ACC-204-SLV'));
  fireEvent.click(screen.getByRole('button', { name: 'Tambah jumlah restock ACC-204-SLV' }));
  await act(async () => { await gateway.adjustStock('sku-3', 6); });
  expect(screen.queryByText('ACC-204-SLV')).not.toBeInTheDocument();
  await act(async () => { await gateway.adjustStock('sku-3', -6); });
  expect(screen.queryByRole('textbox', { name: 'Jumlah restock ACC-204-SLV' })).not.toBeInTheDocument();
  expect(within(preview).queryByText('ACC-204-SLV')).not.toBeInTheDocument();
});
