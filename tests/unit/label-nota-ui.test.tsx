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

test('previews one Nota page at a time with inclusive PPN totals', () => {
  const gateway = new MockOperationsGateway();
  const transaction = gateway.getSnapshot().notaTransactions[0]!;
  const pageA = transaction.pages.find((page) => page.suffix === 'A')!;
  const pageB = transaction.pages.find((page) => page.suffix === 'B')!;
  pageA.lines[0] = { ...pageA.lines[0]!, description: '', kind: '', quantity: 0, pcsPrice: 0, lsnPrice: 0 };
  pageA.lines[1] = { ...pageA.lines[1]!, description: '', kind: '', quantity: 0, pcsPrice: 0, lsnPrice: 0 };
  pageA.lines[2] = {
    ...pageA.lines[2]!,
    description: 'Barang Nota A',
    kind: 'Aksesoris',
    quantity: 1,
    unit: 'pcs',
    pcsPrice: 112_000,
    lsnPrice: 1_344_000,
  };
  pageB.lines[0] = {
    ...pageB.lines[0]!,
    description: 'Barang Nota B',
    quantity: 1,
    unit: 'pcs',
    pcsPrice: 224_000,
  };

  render(<App gateway={gateway} />);
  fireEvent.click(screen.getByRole('button', { name: 'Template Label & Invoice' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Invoice' }));

  const preview = screen.getByTestId('invoice-preview');
  expect(screen.getByRole('button', { name: 'Preview Nota A' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Preview Nota B' })).toHaveAttribute('aria-pressed', 'false');
  expect(preview).toHaveTextContent('Nota A');
  expect(preview).toHaveTextContent('3A');
  expect(preview).not.toHaveTextContent('2A');
  expect(preview).not.toHaveTextContent('Barang Nota B');
  expect(within(preview).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
    'NO', 'NAMA BARANG', 'JENIS', 'JUMLAH', 'PCS/LSN', 'HARGA PCS', 'HARGA LSN', 'TOTAL',
  ]);
  expect(within(preview).getByTestId('invoice-kind-3A')).toHaveTextContent('Aksesoris');
  expect(within(preview).getByTestId('invoice-quantity-3A')).toHaveTextContent('1');
  expect(within(preview).getByTestId('invoice-price-pcs-3A')).toHaveTextContent('112.000');
  expect(within(preview).getByTestId('invoice-price-lsn-3A')).toHaveTextContent('1.344.000');
  expect(within(preview).getByTestId('invoice-line-total-3A')).toHaveTextContent('Rp 112.000');
  expect(within(preview).getByTestId('invoice-unit-3A')).toHaveTextContent('PCS');
  expect(within(preview).getByTestId('invoice-unit-3A')).not.toHaveClass('is-active');
  expect(within(preview).queryByTestId('invoice-unit-pcs-3A')).not.toBeInTheDocument();
  expect(within(preview).queryByTestId('invoice-unit-lsn-3A')).not.toBeInTheDocument();
  expect(within(preview).getByTestId('invoice-customer-name')).toHaveTextContent('Amelia');
  expect(within(preview).getByTestId('invoice-customer-place')).toHaveTextContent('Saibah');
  expect(within(preview).getByTestId('invoice-customer-date')).toHaveTextContent(transaction.transactionDate);
  expect(within(preview).getByTestId('invoice-note-total')).toHaveTextContent('Total NotaRp 100.000');
  expect(within(preview).getByTestId('invoice-ppn')).toHaveTextContent('PPN 12%Rp 12.000');
  expect(within(preview).getByTestId('invoice-transaction-total')).toHaveTextContent('Total TransaksiRp 112.000');

  fireEvent.click(screen.getByRole('button', { name: 'Preview Nota B' }));
  expect(preview).toHaveTextContent('Nota B');
  expect(preview).toHaveTextContent('1B');
  expect(preview).not.toHaveTextContent('Barang Nota A');
  expect(within(preview).getByTestId('invoice-note-total')).toHaveTextContent('Total NotaRp 200.000');
  expect(within(preview).getByTestId('invoice-ppn')).toHaveTextContent('PPN 12%Rp 24.000');
  expect(within(preview).getByTestId('invoice-transaction-total')).toHaveTextContent('Total TransaksiRp 224.000');
  expect(within(preview).getAllByTestId(/invoice-(note-total|ppn|transaction-total)/).map((item) => item.dataset.testid)).toEqual([
    'invoice-note-total', 'invoice-ppn', 'invoice-transaction-total',
  ]);
  expect(preview).not.toHaveTextContent('PPN tidak ditambahkan ke total transaksi');
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
