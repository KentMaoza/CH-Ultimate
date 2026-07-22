import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/renderer/App';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

test('renders a configurable QR label preview and keeps export disabled', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Template Label & Invoice' }));
  expect(screen.getByTestId('label-qr')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Media label'), { target: { value: 'a4' } });
  expect(screen.getByText('Preview A4')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Print label' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Export PDF label' })).toBeDisabled();
});

test('configures an invoice preview and reorders its business identity elements', () => {
  const gateway = new MockOperationsGateway();
  render(<App gateway={gateway} />);
  fireEvent.click(screen.getByRole('button', { name: 'Template Label & Invoice' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Invoice' }));

  const preview = screen.getByTestId('invoice-preview');
  fireEvent.change(screen.getByLabelText('Lebar invoice (mm)'), { target: { value: '190' } });
  fireEvent.change(screen.getByLabelText('Tinggi invoice (mm)'), { target: { value: '120' } });
  fireEvent.change(screen.getByLabelText('Ukuran font invoice'), { target: { value: '16' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'URL logo' }), { target: { value: 'https://example.test/logo.png' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'No. rekening' }), { target: { value: 'BCA 1234567890' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Alamat' }), { target: { value: 'Jl. Contoh No. 10' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'No. Telp' }), { target: { value: '0812-3456-7890' } });

  expect(preview).toHaveStyle({ width: '190mm', minHeight: '120mm', fontSize: '16px' });
  expect(preview).toHaveTextContent('BCA 1234567890');
  expect(preview).toHaveTextContent('Jl. Contoh No. 10');
  expect(preview).toHaveTextContent('0812-3456-7890');
  expect(gateway.getSnapshot().invoiceTemplate.logoUrl).toBe('https://example.test/logo.png');

  fireEvent.click(screen.getByRole('button', { name: 'Naikkan No. rekening' }));
  const order = within(preview).getAllByTestId(/invoice-element-/).map((element) => element.dataset.testid);
  expect(order).toEqual(['invoice-element-logo', 'invoice-element-address', 'invoice-element-bank', 'invoice-element-phone']);
  expect(screen.getByRole('button', { name: 'Print invoice' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Export PDF invoice' })).toBeDisabled();
});

test('completes a lsn nota from the CH Nota workspace and deducts twelve pieces', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
  fireEvent.change(screen.getByLabelText('Jumlah baris 1'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'LSN baris 1' }));
  fireEvent.change(screen.getByLabelText('Harga LSN baris 1'), { target: { value: '504000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan' }));
  expect(await screen.findByText('Nota selesai dan stok demo diperbarui.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Kembali ke CH Ultimate' }));
  expect(screen.getByRole('row', { name: /BRS-108-BLK/ })).toHaveTextContent('0');
});
