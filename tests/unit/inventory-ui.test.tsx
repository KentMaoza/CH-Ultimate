import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/renderer/App';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

test('adjusts a tracked SKU into a negative balance in the current session', async () => {
  render(<App />);
  expect(screen.getByTestId('sku-stock-sku-1')).toHaveTextContent('24');
  const row = screen.getByRole('row', { name: /BRS-108-BLK/ });
  fireEvent.click(within(row).getByRole('button', { name: 'Kurangi stok BRS-108-BLK' }));
  fireEvent.change(screen.getByLabelText('Jumlah stok dikurangi'), { target: { value: '30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Kurangi stok' }));
  expect(await screen.findByTestId('sku-stock-sku-1')).toHaveTextContent('-6');
});

test('uses explicit add and subtract stock actions without requiring signed input', async () => {
  render(<App />);
  const row = screen.getByRole('row', { name: /BRS-108-BLK/ });
  fireEvent.click(within(row).getByRole('button', { name: 'Tambah stok BRS-108-BLK' }));
  fireEvent.change(screen.getByLabelText('Jumlah stok ditambah'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tambah stok' }));
  expect(await screen.findByTestId('sku-stock-sku-1')).toHaveTextContent('29');

  fireEvent.click(within(row).getByRole('button', { name: 'Kurangi stok BRS-108-BLK' }));
  fireEvent.change(screen.getByLabelText('Jumlah stok dikurangi'), { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: 'Kurangi stok' }));
  expect(await screen.findByTestId('sku-stock-sku-1')).toHaveTextContent('22');
});

test('lists filtered price and quantity changes and exposes price export', async () => {
  const gateway = new MockOperationsGateway();
  await gateway.updateSku('sku-1', { imageUrl: 'https://example.test/beras.jpg' });
  render(<App gateway={gateway} />);
  const row = screen.getByRole('row', { name: /BRS-108-BLK/ });
  fireEvent.click(within(row).getByRole('button', { name: 'Edit BRS-108-BLK' }));
  fireEvent.change(screen.getByLabelText('Edit harga referensi'), { target: { value: '52000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan SKU' }));

  fireEvent.click(within(row).getByRole('button', { name: 'Tambah stok BRS-108-BLK' }));
  fireEvent.change(screen.getByLabelText('Jumlah stok ditambah'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tambah stok' }));
  fireEvent.click(screen.getByRole('button', { name: 'Perubahan SKU' }));

  expect(screen.getByRole('heading', { name: 'Perubahan SKU', level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Perubahan harga' })).toHaveAttribute('aria-selected', 'true');
  const priceRow = screen.getByRole('row', { name: /BRS-108-BLK.*Rp\s*42\.000.*Rp\s*52\.000/i });
  expect(priceRow).toBeInTheDocument();
  expect(within(priceRow).getByRole('img', { name: 'Gambar BRS-108-BLK' })).toHaveAttribute('src', 'https://example.test/beras.jpg');
  const createObjectURL = vi.fn(() => 'blob:price-history');
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Ekspor perubahan harga CSV' }));
  expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  expect(click).toHaveBeenCalledOnce();
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:price-history'));
  click.mockRestore();

  fireEvent.click(screen.getByRole('tab', { name: 'Perubahan jumlah' }));
  const quantityRow = screen.getByRole('row', { name: /BRS-108-BLK.*24.*\+3.*27/ });
  expect(within(quantityRow).getByRole('img', { name: 'Gambar BRS-108-BLK' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Sampai tanggal perubahan'), { target: { value: '2000-01-01' } });
  expect(screen.getByText('Belum ada perubahan jumlah pada rentang tanggal ini.')).toBeInTheDocument();
});

test('prints a chosen quantity of warehouse SKU barcodes', () => {
  const print = vi.spyOn(window, 'print').mockImplementation(() => {});
  render(<App />);
  const row = screen.getByRole('row', { name: /BRS-108-BLK/ });
  fireEvent.click(within(row).getByRole('button', { name: 'Print barcode BRS-108-BLK' }));
  const dialog = screen.getByRole('dialog', { name: 'Print barcode produk' });
  expect(within(dialog).getByLabelText('Jumlah barcode')).toHaveValue(1);
  fireEvent.change(within(dialog).getByLabelText('Jumlah barcode'), { target: { value: '3' } });
  expect(screen.getAllByTestId('barcode-print-item')).toHaveLength(3);
  expect(screen.getAllByTestId('barcode-product-qr')[0]).toHaveAttribute('data-value', 'BRS-108-BLK');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Print barcode sekarang' }));
  expect(print).toHaveBeenCalledOnce();
  print.mockRestore();
});

test('creates a SKU and shows it in the warehouse list', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Buat SKU' }));
  fireEvent.change(screen.getByLabelText('Nomor SKU'), { target: { value: 'NEW-001' } });
  fireEvent.change(screen.getByLabelText('Nama SKU'), { target: { value: 'Produk Baru' } });
  fireEvent.change(screen.getByLabelText('Harga Referensi'), { target: { value: '35000' } });
  fireEvent.change(screen.getByLabelText('Stok Awal'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan SKU' }));
  fireEvent.click(screen.getByRole('button', { name: 'SKU Gudang' }));
  expect(await screen.findByText('NEW-001')).toBeInTheDocument();
  expect(screen.getByText('Produk Baru')).toBeInTheDocument();
});

test('title-cases SKU names during create and edit without changing codes or notes', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Buat SKU' }));
  fireEvent.change(screen.getByLabelText('Nomor SKU'), { target: { value: 'ch001' } });
  fireEvent.change(screen.getByLabelText('Nama SKU'), { target: { value: 'produk hITAM ch001 XL' } });
  fireEvent.change(screen.getByLabelText('Harga Referensi'), { target: { value: '35000' } });
  fireEvent.change(screen.getByLabelText('Stok Awal'), { target: { value: '8' } });
  fireEvent.change(screen.getByLabelText('Tautan gambar (opsional)'), { target: { value: 'https://example.test/gambar.jpg' } });
  fireEvent.change(screen.getByLabelText('Catatan SKU Gudang'), { target: { value: 'stok depan. rak kedua' } });
  expect(screen.getByLabelText('Nomor SKU')).toHaveValue('ch001');
  expect(screen.getByLabelText('Tautan gambar (opsional)')).toHaveValue('https://example.test/gambar.jpg');
  expect(screen.getByLabelText('Nama SKU')).toHaveValue('Produk Hitam CH001 XL');
  expect(screen.getByLabelText('Catatan SKU Gudang')).toHaveValue('stok depan. rak kedua');
  fireEvent.click(screen.getByRole('button', { name: 'Simpan SKU' }));
  fireEvent.click(screen.getByRole('button', { name: 'SKU Gudang' }));

  const row = screen.getByRole('row', { name: /ch001/ });
  expect(row).toHaveTextContent('Produk Hitam CH001 XL');
  expect(row).toHaveTextContent('stok depan. rak kedua');
  fireEvent.click(within(row).getByRole('button', { name: 'Edit ch001' }));
  fireEvent.change(screen.getByLabelText('Edit nama SKU'), { target: { value: 'produk revisi ch002' } });
  fireEvent.change(screen.getByLabelText('Edit catatan SKU'), { target: { value: 'pindah rak. cek ulang' } });
  expect(screen.getByLabelText('Edit nama SKU')).toHaveValue('Produk Revisi CH002');
  expect(screen.getByLabelText('Edit catatan SKU')).toHaveValue('pindah rak. cek ulang');
});

test('edits a SKU number while keeping the old value searchable', async () => {
  render(<App />);
  const row = screen.getByRole('row', { name: /BRS-108-BLK/ });
  fireEvent.click(within(row).getByRole('button', { name: 'Edit BRS-108-BLK' }));
  fireEvent.change(screen.getByLabelText('Edit nomor SKU'), { target: { value: 'BRS-NEW' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan SKU' }));
  fireEvent.change(screen.getByPlaceholderText('Nama / nomor SKU / scan QR'), { target: { value: 'BRS-108-BLK' } });
  expect(await screen.findByText('BRS-NEW')).toBeInTheDocument();
});
