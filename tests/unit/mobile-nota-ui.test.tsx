import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BarcodeScannerPort } from '../../mobile/ports';
import { MobileNotaView } from '../../mobile/components/MobileNotaView';
import { createMobileDemoState } from '../../src/domain/mobile-demo-state';
import type { DemoState } from '../../src/domain/types';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

function renderNota(scanner: BarcodeScannerPort = { scan: async () => null }, seedFactory: () => DemoState = createMobileDemoState) {
  const gateway = new MockOperationsGateway(seedFactory);
  render(<MobileNotaView gateway={gateway} scanner={scanner} />);
  return gateway;
}

async function addManual(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Tambah barang tanpa barcode' }));
  fireEvent.change(screen.getByLabelText('Nama barang manual'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Jenis barang manual'), { target: { value: 'Bebas' } });
  fireEvent.change(screen.getByLabelText('Jumlah barang manual'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Harga barang manual'), { target: { value: '1000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan barang' }));
  await waitFor(() => expect(screen.getByRole('region', { name: new RegExp(name) })).toBeInTheDocument());
}

test('manual mobile entry creates a touch-friendly 1A row with the desktop A accent', async () => {
  renderNota();
  expect(await screen.findByRole('heading', { name: 'Nota Barang' })).toBeInTheDocument();

  await addManual('Kopi Bubuk');

  const row = screen.getByRole('region', { name: /Kopi Bubuk/ });
  expect(row).toHaveTextContent('1A');
  expect(screen.getByRole('button', { name: 'Bagian A' })).toHaveStyle({ '--mobile-nota-accent': '#D32F2F' });
  expect(within(row).getByLabelText('Nama barang 1A')).toHaveValue('Kopi Bubuk');
  expect(within(row).getByLabelText('Jumlah barang 1A')).toHaveAttribute('inputmode', 'numeric');
});

test('manual section buttons continue with the desktop B and C accents', async () => {
  renderNota();
  await screen.findByRole('heading', { name: 'Nota Barang' });
  fireEvent.click(screen.getByRole('button', { name: 'Tambah Bagian B' }));
  expect(await screen.findByRole('button', { name: 'Bagian B' })).toHaveStyle({ '--mobile-nota-accent': '#1565C0' });
  fireEvent.click(screen.getByRole('button', { name: 'Tambah Bagian C' }));
  expect(await screen.findByRole('button', { name: 'Bagian C' })).toHaveStyle({ '--mobile-nota-accent': '#FBC02D' });
});

test('barcode aliases fill a row, duplicate scans increment it, and failures explain why', async () => {
  const codes = ['BRS-108', 'BERAS-HITAM-1KG', 'MINUMAN-COKELAT', 'TIDAK-ADA'];
  renderNota({ scan: async () => ({ rawValue: codes.shift()!, format: 'CODE_128' }) });
  await screen.findByRole('heading', { name: 'Nota Barang' });

  fireEvent.click(screen.getByRole('button', { name: 'Scan barcode' }));
  const row = await screen.findByRole('region', { name: /Beras Hitam Premium/ });
  expect(within(row).getByLabelText('Jumlah barang 1A')).toHaveValue(1);
  fireEvent.click(screen.getByRole('button', { name: 'Scan barcode' }));
  await waitFor(() => expect(within(row).getByLabelText('Jumlah barang 1A')).toHaveValue(2));

  fireEvent.click(screen.getByRole('button', { name: 'Scan barcode' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('SKU sudah diarsipkan');
  fireEvent.click(screen.getByRole('button', { name: 'Scan barcode' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Kode tidak dikenal: TIDAK-ADA');
});

test('the sixteenth unique item automatically creates B and keeps fifteen numbered rows in A', async () => {
  renderNota();
  await screen.findByRole('heading', { name: 'Nota Barang' });
  for (let index = 1; index <= 16; index += 1) await addManual(`Barang ${index}`);

  fireEvent.click(screen.getByRole('button', { name: 'Bagian A' }));
  expect(screen.getByRole('region', { name: /Barang 15/ })).toHaveTextContent('15A');
  fireEvent.click(screen.getByRole('button', { name: 'Bagian B' }));
  expect(screen.getByRole('region', { name: /Barang 16/ })).toHaveTextContent('1B');
  expect(screen.getByRole('button', { name: 'Bagian B' })).toHaveStyle({ '--mobile-nota-accent': '#1565C0' });
});

test('mobile completion stores only in archive and honestly reports that desktop transfer is unavailable', async () => {
  const gateway = renderNota();
  await screen.findByRole('heading', { name: 'Nota Barang' });
  await addManual('Barang Demo');
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  const dialog = screen.getByRole('dialog', { name: 'Selesaikan nota mobile?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan dan kirim ke desktop' }));

  expect(await screen.findByRole('status')).toHaveTextContent('tersimpan di Arsip sebagai data demo');
  expect(screen.getByRole('status')).toHaveTextContent('belum terkirim ke desktop karena CH Core API belum tersedia');
  expect(gateway.getSnapshot().notaTransactions.find((item) => item.status === 'completed')).toMatchObject({
    completionDestination: 'archive',
  });
});
