import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import { MobileApp } from '../../mobile/MobileApp';
import type { BarcodeScannerPort, LocalNotificationPort, RecommendationPdfSharePort } from '../../mobile/ports';
import { createMobileDemoState } from '../../src/domain/mobile-demo-state';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

vi.mock('../../src/renderer/nota/nota-voice', () => ({
  createNotaVoicePlayer: () => ({ speak: vi.fn(), cancel: vi.fn(), dispose: vi.fn(), test: vi.fn() }),
}));

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

test('demo mobile archive shows only archived completed notes with local-session copy', async () => {
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
  expect(
    screen.getByText('Arsip hanya tersedia pada sesi demo lokal ini'),
  ).toBeInTheDocument();
});

test('archived note details open inline below the customer and close when tapped again', async () => {
  const gateway = new MockOperationsGateway(createMobileDemoState);
  const amelia = await createCompleted(gateway, 'Amelia', 'archive');
  render(<MobileApp gateway={gateway} scanner={scanner} notifications={notifications} share={share} />);

  fireEvent.click(screen.getByRole('button', { name: 'Arsip' }));

  const ameliaButton = screen.getByRole('button', { name: /Amelia/ });
  expect(ameliaButton).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('region', { name: `Nota arsip ${amelia.baseNumber}` })).not.toBeInTheDocument();

  fireEvent.click(ameliaButton);

  const ameliaDetail = screen.getByRole('region', { name: `Nota arsip ${amelia.baseNumber}` });
  expect(ameliaButton).toHaveAttribute('aria-expanded', 'true');
  expect(ameliaButton.parentElement).toContainElement(ameliaDetail);

  fireEvent.click(ameliaButton);

  expect(ameliaButton).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('region', { name: `Nota arsip ${amelia.baseNumber}` })).not.toBeInTheDocument();
});

test('opening another archived customer closes the current detail', async () => {
  const gateway = new MockOperationsGateway(createMobileDemoState);
  const amelia = await createCompleted(gateway, 'Amelia', 'archive');
  const ferdian = await createCompleted(gateway, 'Ferdian', 'archive');
  render(<MobileApp gateway={gateway} scanner={scanner} notifications={notifications} share={share} />);

  fireEvent.click(screen.getByRole('button', { name: 'Arsip' }));

  const ameliaButton = screen.getByRole('button', { name: /Amelia/ });
  const ferdianButton = screen.getByRole('button', { name: /Ferdian/ });
  fireEvent.click(ameliaButton);
  fireEvent.click(ferdianButton);

  expect(ameliaButton).toHaveAttribute('aria-expanded', 'false');
  expect(ferdianButton).toHaveAttribute('aria-expanded', 'true');
  expect(screen.queryByRole('region', { name: `Nota arsip ${amelia.baseNumber}` })).not.toBeInTheDocument();
  expect(ferdianButton.parentElement).toContainElement(screen.getByRole('region', { name: `Nota arsip ${ferdian.baseNumber}` }));
});

test('a note completed in the mobile editor can be reopened for editing', async () => {
  const gateway = new MockOperationsGateway(createMobileDemoState);
  render(<MobileApp gateway={gateway} scanner={scanner} notifications={notifications} share={share} />);
  fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
  await screen.findByRole('heading', { name: 'Nota Barang' });
  fireEvent.click(screen.getByRole('button', { name: 'Tambah barang tanpa barcode' }));
  fireEvent.change(screen.getByLabelText('Nama barang manual'), { target: { value: 'Kopi Mobile' } });
  fireEvent.change(screen.getByLabelText('Jumlah barang manual'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Harga PCS barang manual'), { target: { value: '12000' } });
  fireEvent.change(screen.getByLabelText('Harga Lusin barang manual'), { target: { value: '144000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan barang' }));
  await screen.findByRole('region', { name: /Kopi Mobile/ });
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  await act(async () => {
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Selesaikan nota mobile?' })).getByRole('button', { name: 'Simpan ke Arsip' }));
  });
  await waitFor(() => expect(gateway.getSnapshot().notaTransactions.some((item) => item.status === 'completed')).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: 'Arsip' }));
  fireEvent.click(screen.getByRole('button', { name: /Tanpa pelanggan/ }));

  expect(screen.getByText('Kopi Mobile')).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: /Kopi Mobile/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit nota' }));

  expect(await screen.findByRole('heading', { name: 'Nota Barang' })).toBeInTheDocument();
  expect(screen.getByLabelText('Nama barang 1A')).toHaveValue('Kopi Mobile');
  expect(gateway.getSnapshot().notaTransactions.find((item) => item.customerName === '')?.status).toBe('reopened');
});
