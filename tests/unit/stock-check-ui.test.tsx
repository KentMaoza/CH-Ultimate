import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { StockCheckView } from '../../src/renderer/stock-check/StockCheckView';
import type { DemoState, Sku, StockCheck } from '../../src/domain/types';
import { createInitialState } from '../../src/domain/operations';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

function sku(id: string, skuNumber: string, patch: Partial<Sku> = {}): Sku {
  return {
    id,
    skuNumber,
    aliases: [],
    identifiers: [],
    name: `Produk ${skuNumber}`,
    referencePrice: 10_000,
    stock: 10,
    tracked: true,
    note: '',
    imageUrl: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    archived: false,
    ...patch,
  };
}

function audit(patch: Partial<StockCheck> = {}): StockCheck {
  return {
    id: 'audit-1',
    skuId: 'older',
    observedQuantityPcs: 10,
    countedQuantityPcs: 8,
    serverQuantityBeforePcs: 7,
    appliedDeltaPcs: 1,
    forcedOffline: true,
    countedAt: '2026-08-04T01:15:00.000Z',
    appliedAt: '2026-08-04T02:30:00.000Z',
    deviceId: 'device-1',
    deviceDisplayName: 'HP Gudang',
    note: 'Rak utara',
    ...patch,
  };
}

function stockState(): DemoState {
  return {
    ...createInitialState(),
    skus: [
      sku('never', 'CH002'),
      sku('older', 'CH010', {
        lastStockCheckedAt: '2026-08-04T01:15:00.000Z',
        identifiers: [
          { id: 'package-1', skuId: 'older', value: '899000010', kind: 'package_barcode', createdAt: '' },
        ],
      }),
      sku('newer', 'CH009', { lastStockCheckedAt: '2026-08-04T03:00:00.000Z' }),
      sku('archived', 'CH001', { archived: true }),
    ],
    stockChecks: [
      audit(),
      audit({ id: 'audit-2', skuId: 'newer', countedAt: '2026-08-04T03:00:00.000Z', appliedAt: '2026-08-04T03:01:00.000Z', forcedOffline: false }),
    ],
  };
}

test('renders sorted active SKU, resolves a package barcode, and exposes physical versus applied audit times', () => {
  const gateway = new MockOperationsGateway(stockState);
  render(<StockCheckView gateway={gateway} mode="desktop" />);

  const list = screen.getByRole('list', { name: 'Daftar SKU cek stok' });
  expect(within(list).getAllByRole('button').map((button) => button.textContent)).toEqual([
    expect.stringContaining('CH002'),
    expect.stringContaining('CH010'),
    expect.stringContaining('CH009'),
  ]);
  expect(list).not.toHaveTextContent('CH001');
  expect(list).toHaveTextContent('Belum pernah');
  expect(list).toHaveTextContent('09:15 WITA');

  fireEvent.change(screen.getByRole('textbox', { name: 'Kode SKU atau barcode' }), {
    target: { value: '899000010' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cari kode' }));

  expect(screen.getByRole('heading', { name: 'Produk CH010' })).toBeInTheDocument();
  fireEvent.click(screen.getByText(/DIPAKSA OFFLINE/));
  const detail = screen.getByRole('group', { name: /Audit cek stok/ });
  expect(detail).toHaveTextContent('Stok server sebelum diterapkan7 PCS');
  expect(detail).toHaveTextContent('Diterapkan04 Agu 2026, 10:30 WITA');
  expect(detail).toHaveTextContent('Dipaksa offlineYa');
});

test('requires a review that shows observed, counted, difference, trimmed note, and supports unchanged counts', async () => {
  const gateway = new MockOperationsGateway(stockState);
  const checkStock = vi.spyOn(gateway, 'checkStock');
  render(<StockCheckView gateway={gateway} mode="desktop" />);

  fireEvent.click(screen.getByRole('button', { name: 'Cek stok Produk CH002' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Jumlah hasil hitung (PCS)' }), {
    target: { value: '10' },
  });
  const noteInput = screen.getByRole('textbox', { name: 'Catatan cek stok (opsional)' });
  expect(noteInput).toHaveAttribute('maxlength', '512');
  fireEvent.change(noteInput, {
    target: { value: '  Sama persis  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tinjau cek stok' }));

  const confirmation = screen.getByRole('region', { name: 'Konfirmasi cek stok Produk CH002' });
  expect(confirmation).toHaveTextContent('Stok teramati10 PCS');
  expect(confirmation).toHaveTextContent('Hasil hitung10 PCS');
  expect(confirmation).toHaveTextContent('Selisih0 PCS');
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Konfirmasi cek stok' }));

  await waitFor(() => expect(checkStock).toHaveBeenCalledWith('never', 10, 'Sama persis'));
  expect(await screen.findByRole('status')).toHaveTextContent('Cek stok tersimpan');
});

test('stale online rejection refreshes the observed stock and requires confirmation again', async () => {
  const gateway = new MockOperationsGateway(stockState);
  const originalCheck = gateway.checkStock.bind(gateway);
  vi.spyOn(gateway, 'checkStock')
    .mockImplementationOnce(async () => {
      await gateway.updateSku('never', { stock: 12 });
      throw new Error('Perubahan ditolak oleh CH Core (STOCK_CHECK_STALE).');
    })
    .mockImplementation(originalCheck);
  const retry = vi.spyOn(gateway, 'retryPending');
  render(<StockCheckView gateway={gateway} mode="desktop" />);

  fireEvent.click(screen.getByRole('button', { name: 'Cek stok Produk CH002' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Jumlah hasil hitung (PCS)' }), {
    target: { value: '8' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tinjau cek stok' }));
  fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi cek stok' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Stok berubah di CH Core');
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.queryByRole('region', { name: /Konfirmasi cek stok/ })).not.toBeInTheDocument();
  expect(screen.getByText('Stok teramati: 12 PCS')).toBeInTheDocument();
});

test('offline confirmation warns that reconnect overwrites central stock', async () => {
  const gateway = new MockOperationsGateway(stockState);
  gateway.getSyncSnapshot = () => ({
    phase: 'offline',
    serverRevision: '1',
    pendingCount: 0,
    conflictCount: 0,
  });
  render(<StockCheckView gateway={gateway} mode="desktop" />);

  fireEvent.click(screen.getByRole('button', { name: 'Cek stok Produk CH002' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Jumlah hasil hitung (PCS)' }), {
    target: { value: '8' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tinjau cek stok' }));

  expect(screen.getByRole('alert')).toHaveTextContent('Saat tersambung kembali, hasil hitung ini akan menimpa stok pusat');
});

test('unknown code registration is online-only and requires target then exact-code confirmation', async () => {
  const gateway = new MockOperationsGateway(stockState);
  const register = vi.spyOn(gateway, 'registerPackageBarcode');
  render(<StockCheckView gateway={gateway} mode="desktop" />);

  fireEvent.change(screen.getByRole('textbox', { name: 'Kode SKU atau barcode' }), {
    target: { value: 'PKG-BARU-001' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cari kode' }));
  expect(screen.getByRole('heading', { name: 'Daftarkan barcode kemasan' })).toBeInTheDocument();

  fireEvent.change(screen.getByRole('combobox', { name: 'Target SKU barcode kemasan' }), {
    target: { value: 'never' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan ke konfirmasi kode' }));
  const confirm = screen.getByRole('button', { name: 'Daftarkan barcode kemasan' });
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Ketik ulang kode barcode persis' }), {
    target: { value: 'pkg-baru-001' },
  });
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Ketik ulang kode barcode persis' }), {
    target: { value: 'PKG-BARU-001' },
  });
  fireEvent.click(confirm);

  await waitFor(() => expect(register).toHaveBeenCalledWith('never', 'PKG-BARU-001'));
  expect(await screen.findByRole('status')).toHaveTextContent('Barcode kemasan terdaftar');
});

test('unknown barcode cannot be registered while offline', () => {
  const gateway = new MockOperationsGateway(stockState);
  gateway.getSyncSnapshot = () => ({
    phase: 'offline', serverRevision: '1', pendingCount: 0, conflictCount: 0,
  });
  render(<StockCheckView gateway={gateway} mode="desktop" />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Kode SKU atau barcode' }), {
    target: { value: 'PKG-OFFLINE' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cari kode' }));

  expect(screen.getByRole('alert')).toHaveTextContent('Barcode baru hanya dapat didaftarkan saat terhubung');
  expect(screen.queryByRole('heading', { name: 'Daftarkan barcode kemasan' })).not.toBeInTheDocument();
});
