import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/renderer/App';

function openNota() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
}

test('Nota opens as a dedicated workspace and back restores the CH Ultimate shell', () => {
  openNota();
  expect(screen.getByTestId('chu-nota-workspace')).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Modul CH Ultimate' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Nota', level: 1 })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Kembali ke CH Ultimate' }));
  expect(screen.getByRole('navigation', { name: 'Modul CH Ultimate' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'SKU Gudang', level: 1 })).toBeInTheDocument();
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

test('Nota shows seeded metadata and the total across active transaction pages', () => {
  openNota();
  expect(screen.getByText(/CHU-\d{8}-0001A/)).toBeInTheDocument();
  expect(screen.getByLabelText('Pelanggan')).toHaveValue('Amelia');
  expect(screen.getByLabelText('Pembayaran')).toHaveValue('unclassified');
  expect(screen.getByTestId('nota-transaction-total')).toHaveTextContent('47.000');
});

test('basic fields, unit, and dual prices update the in-memory Nota total', () => {
  openNota();
  fireEvent.change(screen.getByLabelText('Nama barang baris 3'), { target: { value: 'Kopi' } });
  fireEvent.change(screen.getByLabelText('Jenis baris 3'), { target: { value: 'Minuman' } });
  fireEvent.change(screen.getByLabelText('Jumlah baris 3'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Harga LSN baris 3'), { target: { value: '150000' } });
  fireEvent.click(screen.getByRole('radio', { name: 'LSN baris 3' }));

  expect(screen.getByLabelText('Nama barang baris 3')).toHaveValue('Kopi');
  expect(screen.getByText('300.000')).toBeInTheDocument();
  expect(screen.getByTestId('nota-transaction-total')).toHaveTextContent('347.000');
});

test('Nota print stays visibly disabled with its demo explanation', () => {
  openNota();
  expect(screen.getByRole('button', { name: 'Print Nota' })).toBeDisabled();
  expect(screen.getByText(/Printing produksi belum tersedia/i)).toBeInTheDocument();
});
