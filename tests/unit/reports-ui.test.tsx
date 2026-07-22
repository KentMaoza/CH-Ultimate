import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/renderer/App';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import type { Sku } from '../../src/domain/types';

test('shows revenue cards and tracked empty-stock report preview', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Laporan Omzet' }));
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
});

test('settings identifies the session data source and can reset it', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByText('Fixture sintetis')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reset data demo' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Sesi demo direset');
});

test('empty stock combines supplier and search filters while preserving earlier selections', async () => {
  const gateway = new MockOperationsGateway();
  const base = (id: string, skuNumber: string, name: string): Sku => ({ id, skuNumber, name, aliases: [], referencePrice: 0, stock: 0, tracked: true, note: '', imageUrl: '', createdAt: '', archived: false });
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

test('empty-stock report keeps session-only restock quantities separate from warehouse stock', async () => {
  const gateway = new MockOperationsGateway();
  const stockBefore = gateway.getSnapshot().skus.find((sku) => sku.skuNumber === 'ACC-204-SLV')!.stock;
  render(<App gateway={gateway} />);
  fireEvent.click(screen.getByRole('button', { name: 'Barang Kosong' }));

  const preview = screen.getByTestId('empty-report-preview');
  let quantity = screen.getByRole('textbox', { name: 'Jumlah restock ACC-204-SLV' });
  expect(within(preview).getByText('LAPORAN BARANG KOSONG')).toBeInTheDocument();
  expect(quantity).toHaveValue('0');
  fireEvent.click(screen.getByRole('button', { name: 'Kurangi jumlah restock ACC-204-SLV' }));
  expect(quantity).toHaveValue('0');
  fireEvent.click(screen.getByRole('button', { name: 'Tambah jumlah restock ACC-204-SLV' }));
  expect(quantity).toHaveValue('1');
  expect(within(preview).queryByText('ACC-204-SLV')).not.toBeInTheDocument();
  expect(gateway.getSnapshot().skus.find((sku) => sku.skuNumber === 'ACC-204-SLV')!.stock).toBe(stockBefore);

  fireEvent.click(screen.getByLabelText('Pilih ACC-204-SLV'));
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
  expect(quantity).toHaveValue('0');
  expect(within(preview).queryByText('ACC-204-SLV')).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('Pilih ACC-204-SLV'));
  fireEvent.click(screen.getByRole('button', { name: 'Tambah jumlah restock ACC-204-SLV' }));
  await act(async () => { await gateway.adjustStock('sku-3', 4); });
  expect(screen.queryByText('ACC-204-SLV')).not.toBeInTheDocument();
  await act(async () => { await gateway.adjustStock('sku-3', -4); });
  expect(screen.getByRole('textbox', { name: 'Jumlah restock ACC-204-SLV' })).toHaveValue('0');
  expect(within(preview).queryByText('ACC-204-SLV')).not.toBeInTheDocument();
});
