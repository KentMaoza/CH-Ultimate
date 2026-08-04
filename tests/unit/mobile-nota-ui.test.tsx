import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';
import type { BarcodeScannerPort } from '../../mobile/ports';
import { MobileNotaView } from '../../mobile/components/MobileNotaView';
import { createMobileDemoState } from '../../src/domain/mobile-demo-state';
import type { DemoState } from '../../src/domain/types';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

const voice = vi.hoisted(() => ({ speak: vi.fn(), cancel: vi.fn(), dispose: vi.fn(), test: vi.fn() }));
vi.mock('../../src/renderer/nota/nota-voice', () => ({
  createNotaVoicePlayer: () => voice,
}));

beforeEach(() => {
  voice.speak.mockClear();
  voice.cancel.mockClear();
  voice.dispose.mockClear();
});

function renderNota(
  scanner: BarcodeScannerPort = { scan: async () => null },
  seedFactory: () => DemoState = createMobileDemoState,
  gateway = new MockOperationsGateway(seedFactory),
  coreBacked = false,
) {
  render(
    <MobileNotaView
      coreBacked={coreBacked}
      gateway={gateway}
      scanner={scanner}
    />,
  );
  return gateway;
}

class AsyncAddNotaPageGateway extends MockOperationsGateway {
  override async addNotaPage(transactionId: string) {
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    return super.addNotaPage(transactionId);
  }
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

test('mobile disables synced Nota completion offline', async () => {
  renderNota(
    undefined,
    createMobileDemoState,
    new SyncedOfflineLifecycleGateway(createMobileDemoState),
    true,
  );

  expect(
    await screen.findByRole('button', { name: 'Selesaikan nota' }),
  ).toBeDisabled();
});

async function addManual(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Tambah barang tanpa barcode' }));
  fireEvent.change(screen.getByLabelText('Nama barang manual'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Jenis barang manual'), { target: { value: 'Bebas' } });
  fireEvent.change(screen.getByLabelText('Jumlah barang manual'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Harga PCS barang manual'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Harga Lusin barang manual'), { target: { value: '12000' } });
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

test('manual entry starts in the selected B section and previews its next note number', async () => {
  renderNota();
  await screen.findByRole('heading', { name: 'Nota Barang' });
  fireEvent.click(screen.getByRole('button', { name: 'Tambah Bagian B' }));
  await screen.findByRole('button', { name: 'Bagian B' });

  fireEvent.click(screen.getByRole('button', { name: 'Tambah barang tanpa barcode' }));
  const manual = screen.getByRole('region', { name: 'Barang tanpa barcode' });
  expect(within(manual).getByText('1B')).toBeInTheDocument();
  fireEvent.change(within(manual).getByLabelText('Nama barang manual'), { target: { value: 'Barang Bagian B' } });
  fireEvent.change(within(manual).getByLabelText('Jenis barang manual'), { target: { value: 'Bebas' } });
  fireEvent.change(within(manual).getByLabelText('Jumlah barang manual'), { target: { value: '3' } });
  fireEvent.change(within(manual).getByLabelText('Harga PCS barang manual'), { target: { value: '12500' } });
  fireEvent.change(within(manual).getByLabelText('Harga Lusin barang manual'), { target: { value: '150000' } });
  fireEvent.click(within(manual).getByRole('button', { name: 'Simpan barang' }));

  const row = await screen.findByRole('region', { name: /Barang Bagian B/ });
  expect(row).toHaveTextContent('1B');
  expect(screen.queryByRole('region', { name: /Barang 1A: Barang Bagian B/ })).not.toBeInTheDocument();
  expect(voice.speak).toHaveBeenCalledWith({
    rowNumber: 1,
    suffix: 'B',
    quantity: 3,
    unit: 'pcs',
    price: 12_500,
  });
});

test('manual entry stores independent PCS and LSN prices and speaks the selected unit price', async () => {
  const gateway = renderNota();
  await screen.findByRole('heading', { name: 'Nota Barang' });
  fireEvent.click(screen.getByRole('button', { name: 'Tambah barang tanpa barcode' }));
  const manual = screen.getByRole('region', { name: 'Barang tanpa barcode' });
  fireEvent.change(within(manual).getByLabelText('Nama barang manual'), { target: { value: 'Kopi Lusin' } });
  fireEvent.change(within(manual).getByLabelText('Jenis barang manual'), { target: { value: 'Minuman' } });
  fireEvent.change(within(manual).getByLabelText('Jumlah barang manual'), { target: { value: '3' } });
  fireEvent.change(within(manual).getByLabelText('Unit barang manual'), { target: { value: 'lsn' } });
  fireEvent.change(within(manual).getByLabelText('Harga PCS barang manual'), { target: { value: '12500' } });
  fireEvent.change(within(manual).getByLabelText('Harga Lusin barang manual'), { target: { value: '145000' } });
  fireEvent.click(within(manual).getByRole('button', { name: 'Simpan barang' }));

  const row = await screen.findByRole('region', { name: /Kopi Lusin/ });
  const savedLine = gateway.getSnapshot().notaTransactions[0]?.pages[0]?.lines[0];
  expect(savedLine).toMatchObject({
    quantity: 3,
    unit: 'lsn',
    pcsPrice: 12_500,
    lsnPrice: 145_000,
  });
  expect(row).toHaveTextContent('Rp435.000');
  expect(voice.speak).toHaveBeenLastCalledWith({
    rowNumber: 1,
    suffix: 'A',
    quantity: 3,
    unit: 'lsn',
    price: 145_000,
  });
});

test('manual entry rejects an invalid PCS or LSN price', async () => {
  renderNota();
  await screen.findByRole('heading', { name: 'Nota Barang' });
  fireEvent.click(screen.getByRole('button', { name: 'Tambah barang tanpa barcode' }));
  const manual = screen.getByRole('region', { name: 'Barang tanpa barcode' });
  fireEvent.change(within(manual).getByLabelText('Nama barang manual'), { target: { value: 'Harga Salah' } });
  fireEvent.change(within(manual).getByLabelText('Jumlah barang manual'), { target: { value: '1' } });
  fireEvent.change(within(manual).getByLabelText('Harga PCS barang manual'), { target: { value: '1000' } });
  fireEvent.change(within(manual).getByLabelText('Harga Lusin barang manual'), { target: { value: '-1' } });
  fireEvent.click(within(manual).getByRole('button', { name: 'Simpan barang' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Harga PCS dan Lusin harus bilangan bulat nol atau lebih.');
});

test('barcode aliases fill a row, duplicate scans increment it, and failures explain why', async () => {
  const codes = ['BRS-108', 'BERAS-HITAM-1KG', 'MINUMAN-COKELAT', 'TIDAK-ADA'];
  renderNota({ scan: async () => ({ rawValue: codes.shift()!, format: 'CODE_128' }) });
  await screen.findByRole('heading', { name: 'Nota Barang' });

  fireEvent.click(screen.getByRole('button', { name: 'Scan barcode' }));
  const row = await screen.findByRole('region', { name: /Beras Hitam Premium/ });
  expect(within(row).getByLabelText('Jumlah barang 1A')).toHaveValue(1);
  expect(voice.speak).toHaveBeenLastCalledWith({
    rowNumber: 1,
    suffix: 'A',
    quantity: 1,
    unit: 'pcs',
    price: 42_000,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Scan barcode' }));
  await waitFor(() => expect(within(row).getByLabelText('Jumlah barang 1A')).toHaveValue(2));
  expect(voice.speak).toHaveBeenLastCalledWith({
    rowNumber: 1,
    suffix: 'A',
    quantity: 2,
    unit: 'pcs',
    price: 42_000,
  });

  fireEvent.click(screen.getByRole('button', { name: 'Scan barcode' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('SKU sudah diarsipkan');
  fireEvent.click(screen.getByRole('button', { name: 'Scan barcode' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Kode tidak dikenal: TIDAK-ADA');
  expect(voice.speak).toHaveBeenCalledTimes(2);
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

test('demo mobile completion stays local and never claims synchronization', async () => {
  const gateway = renderNota();
  await screen.findByRole('heading', { name: 'Nota Barang' });
  await addManual('Barang Demo');
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  const dialog = screen.getByRole('dialog', { name: 'Selesaikan nota mobile?' });
  expect(within(dialog).getAllByRole('button')).toHaveLength(2);
  expect(dialog).toHaveTextContent(
    'Nota disimpan ke Arsip pada sesi demo lokal ini.',
  );
  expect(dialog).not.toHaveTextContent(/semua perangkat|sinkronisasi/i);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan ke Arsip' }));

  expect(await screen.findByRole('status')).toHaveTextContent(
    'Nota tersimpan di Arsip sesi demo lokal.',
  );
  expect(screen.getByRole('status')).not.toHaveTextContent(
    /semua perangkat|sinkronisasi/i,
  );
  expect(gateway.getSnapshot().notaTransactions.find((item) => item.status === 'completed')).toMatchObject({
    completionDestination: 'archive',
  });
});

test('Core mobile completion describes the shared archived Nota', async () => {
  renderNota(undefined, createMobileDemoState, undefined, true);
  await screen.findByRole('heading', { name: 'Nota Barang' });
  await addManual('Barang Core');
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  const dialog = screen.getByRole('dialog', {
    name: 'Selesaikan nota mobile?',
  });
  expect(dialog).toHaveTextContent(
    'Nota disimpan ke Arsip dan tersedia di semua perangkat setelah sinkronisasi.',
  );
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Simpan ke Arsip' }),
  );

  expect(await screen.findByRole('status')).toHaveTextContent(
    'Nota tersimpan di Arsip dan tersedia di semua perangkat.',
  );
});

test('mobile completion labels central stock and omzet as pending while offline', async () => {
  const gateway = new MockOperationsGateway(createMobileDemoState);
  gateway.getSyncSnapshot = () => ({
    phase: 'offline',
    serverRevision: '7',
    pendingCount: 1,
    conflictCount: 0,
  });
  renderNota(undefined, createMobileDemoState, gateway, true);
  await screen.findByRole('heading', { name: 'Nota Barang' });
  await addManual('Barang Offline');
  fireEvent.click(screen.getByRole('button', { name: 'Selesaikan nota' }));
  fireEvent.click(
    within(
      screen.getByRole('dialog', { name: 'Selesaikan nota mobile?' }),
    ).getByRole('button', { name: 'Simpan ke Arsip' }),
  );

  expect(await screen.findByRole('status')).toHaveTextContent(
    'Menunggu sinkronisasi — stok dan omzet pusat belum berubah.',
  );
});

test('SKU picker adds the selected product to the active B section and keeps the picker open', async () => {
  const gateway = renderNota(undefined, createMobileDemoState, new AsyncAddNotaPageGateway(createMobileDemoState));
  await screen.findByRole('heading', { name: 'Nota Barang' });
  fireEvent.click(screen.getByRole('button', { name: 'Tambah Bagian B' }));
  const sectionB = await screen.findByRole('button', { name: 'Bagian B' });
  expect(sectionB).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Tambah barang dengan SKU' }));

  const picker = screen.getByRole('region', { name: 'Tambah barang dengan SKU' });
  expect(within(picker).getByText('PCS · Rp42.000')).toBeInTheDocument();
  fireEvent.click(within(picker).getByRole('button', { name: 'Tambah Beras Hitam Premium 1 kg (BRS-108-BLK)' }));

  const row = await screen.findByRole('region', { name: /Beras Hitam Premium 1 kg/ });
  expect(row).toHaveTextContent('1B');
  expect(gateway.getSnapshot().notaTransactions[0]?.pages[1]?.lines[0]).toMatchObject({
    skuId: 'sku-1',
    quantity: 1,
    unit: 'pcs',
    pcsPrice: 42_000,
    lsnPrice: 504_000,
  });
  expect(screen.getByRole('region', { name: 'Tambah barang dengan SKU' })).toBeInTheDocument();
  expect(voice.speak).toHaveBeenLastCalledWith({
    rowNumber: 1,
    suffix: 'B',
    quantity: 1,
    unit: 'pcs',
    price: 42_000,
  });
});

test('selecting the same SKU twice increments its existing row and rereads the updated quantity', async () => {
  const gateway = renderNota();
  await screen.findByRole('heading', { name: 'Nota Barang' });
  fireEvent.click(screen.getByRole('button', { name: 'Tambah barang dengan SKU' }));
  const picker = screen.getByRole('region', { name: 'Tambah barang dengan SKU' });
  const skuButton = within(picker).getByRole('button', { name: 'Tambah Beras Hitam Premium 1 kg (BRS-108-BLK)' });

  fireEvent.click(skuButton);
  await screen.findByRole('region', { name: /Beras Hitam Premium 1 kg/ });
  fireEvent.click(skuButton);

  await waitFor(() => expect(gateway.getSnapshot().notaTransactions[0]?.pages[0]?.lines[0]?.quantity).toBe(2));
  expect(screen.getAllByRole('region', { name: /Beras Hitam Premium 1 kg/ })).toHaveLength(1);
  expect(voice.speak).toHaveBeenLastCalledWith({
    rowNumber: 1,
    suffix: 'A',
    quantity: 2,
    unit: 'pcs',
    price: 42_000,
  });
});

test('SKU picker toggles inline, filters active demo SKUs, and is mutually exclusive with manual entry', async () => {
  renderNota();
  await screen.findByRole('heading', { name: 'Nota Barang' });

  fireEvent.click(screen.getByRole('button', { name: 'Tambah barang dengan SKU' }));
  const picker = screen.getByRole('region', { name: 'Tambah barang dengan SKU' });
  expect(within(picker).getByText('Target nomor 1A')).toBeInTheDocument();
  expect(within(picker).getByText('5 SKU aktif')).toBeInTheDocument();
  expect(within(picker).queryByText('Minuman Serbuk Cokelat')).not.toBeInTheDocument();

  fireEvent.change(within(picker).getByRole('searchbox', { name: 'Cari SKU untuk nota' }), {
    target: { value: 'DRESS-MERAH' },
  });
  expect(within(picker).getByText('Dress Katun Merah')).toBeInTheDocument();
  expect(within(picker).queryByText('Beras Hitam Premium 1 kg')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Tambah barang tanpa barcode' }));
  expect(screen.queryByRole('region', { name: 'Tambah barang dengan SKU' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Barang tanpa barcode' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Tambah barang dengan SKU' }));
  expect(screen.queryByRole('region', { name: 'Barang tanpa barcode' })).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('region', { name: 'Tambah barang dengan SKU' })).getByRole('button', { name: 'Lipat daftar SKU' }));
  expect(screen.queryByRole('region', { name: 'Tambah barang dengan SKU' })).not.toBeInTheDocument();
});
