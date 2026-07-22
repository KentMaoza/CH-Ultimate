import { fireEvent, render, screen } from '@testing-library/react';
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
