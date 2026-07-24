import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MobileApp } from '../../mobile/MobileApp';
import type { BarcodeScannerPort, LocalNotificationPort, RecommendationPdfSharePort } from '../../mobile/ports';
import { createMobileDemoState } from '../../src/domain/mobile-demo-state';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

const scanner: BarcodeScannerPort = { scan: async () => null };
const notifications: LocalNotificationPort = {
  ensurePermission: async () => 'denied',
  notifyPriceChange: async () => undefined,
  listenForPriceChangeActions: async () => async () => undefined,
};
const share: RecommendationPdfSharePort = { sharePdf: async () => undefined };

async function createCompleted(gateway: MockOperationsGateway, customerName: string, destination: 'archive' | 'finished') {
  const transaction = await gateway.createNotaTransaction();
  await gateway.updateNotaTransaction(transaction.id, { customerName });
  await gateway.updateNotaLine(transaction.id, transaction.pages[0]!.id, transaction.pages[0]!.lines[0]!.id, {
    description: `Barang ${customerName}`,
    kind: 'Demo',
    quantity: 1,
    unit: 'pcs',
    pcsPrice: 10_000,
  });
  await gateway.completeNotaTransaction(transaction.id, destination);
  return transaction;
}

test('mobile archive shows only archived completed notes with a frontend-demo transfer badge', async () => {
  const gateway = new MockOperationsGateway(createMobileDemoState);
  await createCompleted(gateway, 'Pelanggan Arsip', 'archive');
  await createCompleted(gateway, 'Pelanggan Selesai', 'finished');
  const trash = await gateway.createNotaTransaction();
  await gateway.updateNotaTransaction(trash.id, { customerName: 'Pelanggan Sampah' });
  await gateway.cancelNotaTransaction(trash.id);
  render(<MobileApp gateway={gateway} scanner={scanner} notifications={notifications} share={share} />);

  fireEvent.click(screen.getByRole('button', { name: 'Arsip' }));

  expect(screen.getByText('Pelanggan Arsip')).toBeInTheDocument();
  expect(screen.queryByText('Pelanggan Selesai')).not.toBeInTheDocument();
  expect(screen.queryByText('Pelanggan Sampah')).not.toBeInTheDocument();
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(screen.getByText('Belum terkirim ke desktop · frontend demo')).toBeInTheDocument();
});

test('a note completed in the mobile editor appears read-only in mobile archive', async () => {
  const gateway = new MockOperationsGateway(createMobileDemoState);
  render(<MobileApp gateway={gateway} scanner={scanner} notifications={notifications} share={share} />);
  fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
  await screen.findByRole('heading', { name: 'Nota Barang' });
  fireEvent.click(screen.getByRole('button', { name: 'Tambah barang tanpa barcode' }));
  fireEvent.change(screen.getByLabelText('Nama barang manual'), { target: { value: 'Kopi Mobile' } });
  fireEvent.change(screen.getByLabelText('Jumlah barang manual'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Harga barang manual'), { target: { value: '12000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan barang' }));
  await screen.findByRole('region', { name: /Kopi Mobile/ });
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  await act(async () => {
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Selesaikan nota mobile?' })).getByRole('button', { name: 'Simpan ke Arsip' }));
  });
  await waitFor(() => expect(gateway.getSnapshot().notaTransactions.some((item) => item.status === 'completed')).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: 'Arsip' }));

  expect(screen.getByText('Kopi Mobile')).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: /Kopi Mobile/ })).not.toBeInTheDocument();
});
