import { fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../src/renderer/App';

test('renders a configurable QR label preview and keeps export disabled', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Label' }));
  expect(screen.getByTestId('label-qr')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Media label'), { target: { value: 'a4' } });
  expect(screen.getByText('Preview A4')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Print label' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Export PDF label' })).toBeDisabled();
});

test('completes a lsn nota with suggested price and deducts twelve pieces', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
  fireEvent.change(screen.getByLabelText('Barang baris 1'), { target: { value: 'sku-1' } });
  fireEvent.change(screen.getByLabelText('Jumlah baris 1'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Satuan baris 1'), { target: { value: 'lsn' } });
  expect(screen.getByLabelText('Harga baris 1')).toHaveValue(504000);
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  expect(await screen.findByText('COMPLETED')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'SKU Gudang' }));
  expect(screen.getByRole('row', { name: /BRS-108-BLK/ })).toHaveTextContent('0');
});
