import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { NotaCompletionDestination } from '../../src/domain/types';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { App } from '../../src/renderer/App';

function openNota(gateway: MockOperationsGateway, coreBacked = false) {
  render(<App gateway={gateway} coreBacked={coreBacked} />);
  fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
}

class SyncedOfflineLifecycleGateway extends MockOperationsGateway {
  override getSyncSnapshot = () => ({
    phase: 'offline' as const,
    serverRevision: '7',
    pendingCount: 0,
    conflictCount: 0,
  });
  override isNotaLifecycleOnlineOnly = () => true;
}

test('desktop disables synced Nota transaction lifecycle controls offline', () => {
  const gateway = new SyncedOfflineLifecycleGateway();
  openNota(gateway, true);

  expect(screen.getByRole('button', { name: 'Selesaikan nota' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Batalkan transaksi' })).toBeDisabled();
});

async function chooseCompletion(destination: NotaCompletionDestination) {
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  const dialog = screen.getByRole('dialog', { name: 'Selesaikan nota?' });
  const label = destination === 'finished'
    ? '1. Barang dikirim sekarang'
    : '2. Barang dikirim nanti';
  fireEvent.click(within(dialog).getByRole('button', { name: label }));
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Nota berhasil disimpan' })).toBeInTheDocument());
}

test.each([
  ['finished' as const, 'Selesai', 'Nota berhasil disimpan di Selesai.'],
  ['archive' as const, 'Arsip', 'Nota berhasil disimpan di Arsip.'],
])('completion to %s names the destination and opens its archive bucket', async (destination, tab, message) => {
  const gateway = new MockOperationsGateway();
  openNota(gateway);

  await chooseCompletion(destination);

  const success = screen.getByRole('dialog', { name: 'Nota berhasil disimpan' });
  expect(within(success).getByText(message)).toBeInTheDocument();
  expect(gateway.getSnapshot().notaTransactions[0]).toMatchObject({
    status: 'completed',
    completionDestination: destination,
  });
  fireEvent.click(within(success).getByRole('button', { name: `Lihat ${tab}` }));
  expect(screen.getByRole('heading', { name: 'Arsip Nota' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
});

test('offline desktop completion keeps central stock and omzet visibly pending', async () => {
  const gateway = new MockOperationsGateway();
  gateway.getSyncSnapshot = () => ({
    phase: 'offline',
    serverRevision: '7',
    pendingCount: 1,
    conflictCount: 0,
  });
  openNota(gateway);

  await chooseCompletion('archive');

  expect(
    within(
      screen.getByRole('dialog', { name: 'Nota berhasil disimpan' }),
    ).getByText(
      'Menunggu sinkronisasi — stok dan omzet pusat belum berubah.',
    ),
  ).toBeInTheDocument();
});

class RejectingCompletionGateway extends MockOperationsGateway {
  override async completeNotaTransaction(_transactionId: string, _destination?: NotaCompletionDestination) {
    throw new Error('Stok demo tidak dapat diperbarui.');
  }
}

test('a failed completion keeps its exact reason in the dialog and can retry', async () => {
  const gateway = new RejectingCompletionGateway();
  openNota(gateway);
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  const choice = screen.getByRole('dialog', { name: 'Selesaikan nota?' });
  fireEvent.click(within(choice).getByRole('button', { name: '1. Barang dikirim sekarang' }));

  const failure = await screen.findByRole('dialog', { name: 'Nota gagal disimpan' });
  expect(within(failure).getByText('Stok demo tidak dapat diperbarui.')).toBeInTheDocument();
  expect(within(failure).getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  expect(gateway.getSnapshot().notaTransactions[0]?.status).toBe('draft');
});

test('archive tabs are ordered Arsip, Selesai, Sampah and finished notes stay out of Arsip', async () => {
  const gateway = new MockOperationsGateway();
  const transaction = gateway.getSnapshot().notaTransactions[0]!;
  await gateway.completeNotaTransaction(transaction.id, 'finished');
  render(<App gateway={gateway} />);
  fireEvent.click(screen.getByRole('button', { name: 'Arsip Nota' }));

  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Arsip', 'Selesai', 'Sampah']);
  expect(screen.getByText('Arsip belum memiliki nota.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Selesai' }));
  expect(screen.getByRole('region', { name: 'Preview selesai nota' })).toBeInTheDocument();
  expect(screen.getByText('SELESAI · BARANG DIKIRIM SEKARANG')).toBeInTheDocument();
});
