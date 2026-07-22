import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MobileApp } from '../../mobile/MobileApp';
import type { BarcodeScannerPort, LocalNotificationPort } from '../../mobile/ports';
import { createMobileDemoState } from '../../src/domain/mobile-demo-state';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

function createPorts(): {
  scanner: BarcodeScannerPort;
  notifications: LocalNotificationPort;
} {
  return {
    scanner: { scan: async () => null },
    notifications: {
      ensurePermission: async () => 'denied',
      notifyPriceChange: async () => undefined,
      listenForPriceChangeActions: async () => async () => undefined,
    },
  };
}

function renderMobile(overrides: Partial<ReturnType<typeof createPorts>> = {}) {
  const gateway = new MockOperationsGateway(createMobileDemoState);
  const ports = { ...createPorts(), ...overrides };
  render(<MobileApp gateway={gateway} scanner={ports.scanner} notifications={ports.notifications} />);
  return { gateway, ...ports };
}

test('dashboard renders fixture counts and the two newest price changes', () => {
  renderMobile();

  expect(screen.getByRole('heading', { name: 'CHU Companion Mobile' })).toBeInTheDocument();
  expect(screen.getByText('Mode Demo')).toBeInTheDocument();
  expect(screen.getByText('Data yang ditampilkan adalah contoh.')).toBeInTheDocument();
  expect(screen.getByTestId('active-sku-count')).toHaveTextContent('5');
  expect(screen.getByTestId('low-stock-count')).toHaveTextContent('2');
  const latest = screen.getByTestId('latest-price-changes');
  const rows = within(latest).getAllByRole('button');
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('Dress Katun Merah');
  expect(rows[1]).toHaveTextContent('Beras Hitam Premium 1 kg');
});

test('bottom navigation has exactly three destinations and changes view', () => {
  renderMobile();

  const navigation = screen.getByRole('navigation', { name: 'Navigasi utama' });
  expect(within(navigation).getAllByRole('button').map((button) => button.textContent)).toEqual([
    'Beranda',
    'SKU Gudang',
    'Perubahan Harga',
  ]);

  fireEvent.click(within(navigation).getByRole('button', { name: 'SKU Gudang' }));
  expect(screen.getByRole('heading', { name: 'SKU Gudang' })).toBeInTheDocument();
  fireEvent.click(within(navigation).getByRole('button', { name: 'Perubahan Harga' }));
  expect(screen.getByRole('heading', { name: 'Perubahan Harga' })).toBeInTheDocument();
});

test('SKU list excludes archived products and searches partial name, current number, and alias', () => {
  renderMobile();
  fireEvent.click(screen.getByRole('button', { name: 'SKU Gudang' }));
  const search = screen.getByRole('searchbox', { name: 'Cari SKU' });

  expect(screen.getByText('Beras Hitam Premium 1 kg')).toBeInTheDocument();
  expect(screen.queryByText('Minuman Serbuk Cokelat')).not.toBeInTheDocument();

  fireEvent.change(search, { target: { value: 'linen' } });
  expect(screen.getByText('Kemeja Linen Putih')).toBeInTheDocument();
  expect(screen.queryByText('Beras Hitam Premium 1 kg')).not.toBeInTheDocument();

  fireEvent.change(search, { target: { value: 'ACC-204' } });
  expect(screen.getByText('Aksesori Silver')).toBeInTheDocument();

  fireEvent.change(search, { target: { value: 'dress-mer' } });
  expect(screen.getByText('Dress Katun Merah')).toBeInTheDocument();
});

test('dashboard search action opens the searchable SKU list', () => {
  renderMobile();
  fireEvent.click(screen.getByRole('button', { name: 'Cari SKU' }));

  expect(screen.getByRole('heading', { name: 'SKU Gudang' })).toBeInTheDocument();
  expect(screen.getByRole('searchbox', { name: 'Cari SKU' })).toHaveFocus();
});

test('SKU detail shows aliases and per-SKU price history', () => {
  renderMobile();
  fireEvent.click(screen.getByRole('button', { name: 'SKU Gudang' }));
  fireEvent.click(screen.getByRole('button', { name: /Beras Hitam Premium 1 kg/ }));

  expect(screen.getByRole('heading', { name: 'Beras Hitam Premium 1 kg' })).toBeInTheDocument();
  expect(screen.getByText('BRS-108')).toBeInTheDocument();
  expect(screen.getByText('BERAS-HITAM-1KG')).toBeInTheDocument();
  const history = screen.getByRole('region', { name: 'Riwayat harga SKU' });
  expect(history).toHaveTextContent('Rp39.000');
  expect(history).toHaveTextContent('Rp42.000');
  expect(history).toHaveTextContent('WITA');
});

test('open SKU detail follows the current gateway snapshot', async () => {
  const { gateway } = renderMobile();
  fireEvent.click(screen.getByRole('button', { name: 'SKU Gudang' }));
  fireEvent.click(screen.getByRole('button', { name: /Beras Hitam Premium 1 kg/ }));

  await act(async () => {
    await gateway.updateSku('sku-1', { name: 'Beras Hitam Organik 1 kg', referencePrice: 43_000 });
  });

  expect(screen.getByRole('heading', { name: 'Beras Hitam Organik 1 kg' })).toBeInTheDocument();
  expect(screen.getByText('Rp43.000', { selector: '.detail-hero strong' })).toBeInTheDocument();
});

test('scanner opens active SKU detail for a canonical code', async () => {
  const scanner: BarcodeScannerPort = { scan: vi.fn(async () => ({ rawValue: 'FSH-LINEN-WHT', format: 'QR_CODE' })) };
  renderMobile({ scanner });

  fireEvent.click(screen.getByRole('button', { name: 'Scan Barcode' }));

  expect(await screen.findByRole('heading', { name: 'Kemeja Linen Putih' })).toBeInTheDocument();
  expect(scanner.scan).toHaveBeenCalledOnce();
});

test('manual scan accepts aliases and archived codes with an explicit warning', async () => {
  renderMobile();
  fireEvent.click(screen.getByRole('button', { name: 'Scan Barcode' }));

  const code = await screen.findByRole('textbox', { name: 'Kode barcode atau SKU' });
  fireEvent.change(code, { target: { value: 'brs-108' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cari kode' }));
  expect(screen.getByRole('heading', { name: 'Beras Hitam Premium 1 kg' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Scan kode lain' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Kode barcode atau SKU' }), { target: { value: 'MNM-002' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cari kode' }));
  expect(screen.getByRole('heading', { name: 'Minuman Serbuk Cokelat' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('SKU ini telah diarsipkan');
});

test('unknown manual code stays on scan surface with retry and manual options', async () => {
  renderMobile();
  fireEvent.click(screen.getByRole('button', { name: 'Scan Barcode' }));
  const code = await screen.findByRole('textbox', { name: 'Kode barcode atau SKU' });
  fireEvent.change(code, { target: { value: 'TIDAK-ADA' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cari kode' }));

  expect(screen.getByRole('heading', { name: 'Scan Barcode' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Kode tidak ditemukan');
  expect(screen.getByRole('button', { name: 'Coba scan lagi' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Kode barcode atau SKU' })).toHaveValue('TIDAK-ADA');
});

test('normal price navigation shows the global newest-first history', () => {
  renderMobile();
  fireEvent.click(screen.getByRole('button', { name: 'Perubahan Harga' }));

  const rows = screen.getAllByRole('button', { name: /SKU:/ });
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('Dress Katun Merah');
  expect(rows[1]).toHaveTextContent('Beras Hitam Premium 1 kg');
});

test('price feed and SKU detail expose direction plus old and new price labels', async () => {
  const { gateway } = renderMobile();
  await act(async () => {
    await gateway.updateSku('sku-1', { referencePrice: 40_000 });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Perubahan Harga' }));

  const row = screen.getAllByRole('button', { name: /Beras Hitam Premium 1 kg/ })[0]!;
  expect(row).toHaveAccessibleDescription('Harga turun. Harga lama Rp42.000. Harga baru Rp40.000.');

  fireEvent.click(row);
  const history = screen.getByRole('region', { name: 'Riwayat harga SKU' });
  expect(within(history).getByRole('group', {
    name: 'Harga turun. Harga lama Rp42.000. Harga baru Rp40.000.',
  })).toBeInTheDocument();
});

test('product image switches to a local fallback when loading fails', () => {
  renderMobile();
  fireEvent.click(screen.getByRole('button', { name: 'SKU Gudang' }));
  const image = document.querySelector<HTMLImageElement>('img[src="/assets/mobile/beras-hitam-premium.svg"]');
  expect(image).not.toBeNull();

  fireEvent.error(image!);

  expect(screen.getByTestId('image-fallback-sku-1')).toBeInTheDocument();
});

test('bell opens only unread changes and marks displayed rows read after render', async () => {
  renderMobile();
  fireEvent.click(screen.getByRole('button', { name: 'Notifikasi harga, 2 belum dibaca' }));

  expect(screen.getByRole('heading', { name: 'Notifikasi Harga' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /SKU:/ })).toHaveLength(2);

  await act(async () => undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Beranda' }));
  expect(screen.getByRole('button', { name: 'Notifikasi harga, 0 belum dibaca' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Perubahan Harga' }));
  expect(screen.getAllByRole('button', { name: /SKU:/ })).toHaveLength(2);
});

test('empty price feed distinguishes normal history from unread notifications', () => {
  const gateway = new MockOperationsGateway(() => ({ ...createMobileDemoState(), priceChanges: [] }));
  const ports = createPorts();
  render(<MobileApp gateway={gateway} scanner={ports.scanner} notifications={ports.notifications} />);

  fireEvent.click(screen.getByRole('button', { name: 'Perubahan Harga' }));
  expect(screen.getByText('Belum ada riwayat perubahan harga pada sesi ini.')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Beranda' }));
  fireEvent.click(screen.getByRole('button', { name: 'Notifikasi harga, 0 belum dibaca' }));
  expect(screen.getByText('Tidak ada perubahan harga yang belum dibaca.')).toBeInTheDocument();
});

test('price simulation updates an active SKU and sends a notification when granted', async () => {
  const notifyPriceChange = vi.fn(async () => undefined);
  const notifications: LocalNotificationPort = {
    ensurePermission: vi.fn(async () => 'granted' as const),
    notifyPriceChange,
    listenForPriceChangeActions: async () => async () => undefined,
  };
  const { gateway } = renderMobile({ notifications });
  fireEvent.click(screen.getByRole('button', { name: 'Perubahan Harga' }));

  fireEvent.click(screen.getByRole('button', { name: 'Simulasikan perubahan harga' }));

  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent('Harga Beras Hitam Premium 1 kg diperbarui menjadi Rp43.000');
  expect(gateway.getSnapshot().skus.find((sku) => sku.id === 'sku-1')?.referencePrice).toBe(43_000);
  expect(notifications.ensurePermission).toHaveBeenCalledOnce();
  expect(notifyPriceChange).toHaveBeenCalledOnce();

  fireEvent.click(screen.getByRole('button', { name: 'Beranda' }));
  fireEvent.click(screen.getByRole('button', { name: 'Notifikasi harga, 3 belum dibaca' }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('notification denial does not block the in-app price update', async () => {
  const notifyPriceChange = vi.fn(async () => undefined);
  const notifications: LocalNotificationPort = {
    ensurePermission: vi.fn(async () => 'denied' as const),
    notifyPriceChange,
    listenForPriceChangeActions: async () => async () => undefined,
  };
  const { gateway } = renderMobile({ notifications });
  fireEvent.click(screen.getByRole('button', { name: 'Perubahan Harga' }));

  fireEvent.click(screen.getByRole('button', { name: 'Simulasikan perubahan harga' }));

  await waitFor(() => expect(gateway.getSnapshot().priceChanges).toHaveLength(3));
  expect(gateway.getSnapshot().skus.find((sku) => sku.id === 'sku-1')?.referencePrice).toBe(43_000);
  expect(notifications.ensurePermission).toHaveBeenCalledOnce();
  expect(notifyPriceChange).not.toHaveBeenCalled();
});

test('tapping a price notification opens the current SKU detail', async () => {
  let actionListener: ((skuId: string) => void) | undefined;
  const notifications: LocalNotificationPort = {
    ensurePermission: async () => 'granted',
    notifyPriceChange: async () => undefined,
    listenForPriceChangeActions: async (listener) => {
      actionListener = listener;
      return async () => undefined;
    },
  };
  const { gateway } = renderMobile({ notifications });
  await waitFor(() => expect(actionListener).toBeTypeOf('function'));

  await act(async () => {
    await gateway.updateSku('sku-2', { name: 'Kemeja Linen Putih Terbaru' });
    actionListener!('sku-2');
  });

  expect(screen.getByRole('heading', { name: 'Kemeja Linen Putih Terbaru' })).toBeInTheDocument();
});
