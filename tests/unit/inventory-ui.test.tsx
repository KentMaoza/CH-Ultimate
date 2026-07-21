import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/renderer/App';

test('adjusts a tracked SKU into a negative balance in the current session', async () => {
  render(<App />);
  const row = screen.getByRole('row', { name: /BRS-108-BLK/ });
  fireEvent.click(within(row).getByRole('button', { name: 'Atur stok BRS-108-BLK' }));
  fireEvent.change(screen.getByLabelText('Perubahan stok'), { target: { value: '-30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Terapkan perubahan' }));
  expect(await screen.findByText('-6')).toBeInTheDocument();
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

test('edits a SKU number while keeping the old value searchable', async () => {
  render(<App />);
  const row = screen.getByRole('row', { name: /BRS-108-BLK/ });
  fireEvent.click(within(row).getByRole('button', { name: 'Edit BRS-108-BLK' }));
  fireEvent.change(screen.getByLabelText('Edit nomor SKU'), { target: { value: 'BRS-NEW' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan SKU' }));
  fireEvent.change(screen.getByPlaceholderText('Nama / nomor SKU / scan QR'), { target: { value: 'BRS-108-BLK' } });
  expect(await screen.findByText('BRS-NEW')).toBeInTheDocument();
});
