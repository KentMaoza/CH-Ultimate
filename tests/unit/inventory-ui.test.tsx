import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/renderer/App';

test('adjusts a tracked SKU into a negative balance in the current session', async () => {
  render(<App />);
  expect(screen.getByTestId('sku-stock-sku-1')).toHaveTextContent('24');
  const row = screen.getByRole('row', { name: /BRS-108-BLK/ });
  fireEvent.click(within(row).getByRole('button', { name: 'Atur stok BRS-108-BLK' }));
  fireEvent.change(screen.getByLabelText('Perubahan stok'), { target: { value: '-30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Terapkan perubahan' }));
  expect(await screen.findByTestId('sku-stock-sku-1')).toHaveTextContent('-6');
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

test('capitalizes natural-language SKU fields during create and edit without changing the SKU number', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Buat SKU' }));
  fireEvent.change(screen.getByLabelText('Nomor SKU'), { target: { value: 'ch001' } });
  fireEvent.change(screen.getByLabelText('Nama SKU'), { target: { value: 'produk baru. edisi kedua' } });
  fireEvent.change(screen.getByLabelText('Harga Referensi'), { target: { value: '35000' } });
  fireEvent.change(screen.getByLabelText('Stok Awal'), { target: { value: '8' } });
  fireEvent.change(screen.getByLabelText('Tautan gambar (opsional)'), { target: { value: 'https://example.test/gambar.jpg' } });
  fireEvent.change(screen.getByLabelText('Catatan SKU Gudang'), { target: { value: 'stok depan. rak kedua' } });
  expect(screen.getByLabelText('Nomor SKU')).toHaveValue('ch001');
  expect(screen.getByLabelText('Tautan gambar (opsional)')).toHaveValue('https://example.test/gambar.jpg');
  expect(screen.getByLabelText('Nama SKU')).toHaveValue('Produk baru. Edisi kedua');
  expect(screen.getByLabelText('Catatan SKU Gudang')).toHaveValue('Stok depan. Rak kedua');
  fireEvent.click(screen.getByRole('button', { name: 'Simpan SKU' }));
  fireEvent.click(screen.getByRole('button', { name: 'SKU Gudang' }));

  const row = screen.getByRole('row', { name: /ch001/ });
  expect(row).toHaveTextContent('Produk baru. Edisi kedua');
  expect(row).toHaveTextContent('Stok depan. Rak kedua');
  fireEvent.click(within(row).getByRole('button', { name: 'Edit ch001' }));
  fireEvent.change(screen.getByLabelText('Edit nama SKU'), { target: { value: 'produk revisi. edisi akhir' } });
  fireEvent.change(screen.getByLabelText('Edit catatan SKU'), { target: { value: 'pindah rak. cek ulang' } });
  expect(screen.getByLabelText('Edit nama SKU')).toHaveValue('Produk revisi. Edisi akhir');
  expect(screen.getByLabelText('Edit catatan SKU')).toHaveValue('Pindah rak. Cek ulang');
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
