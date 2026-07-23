import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MobileApp } from '../../mobile/MobileApp';
import { ProductImage } from '../../mobile/components/ProductImage';
import type { BarcodeScannerPort, LocalNotificationPort, RecommendationPdfSharePort } from '../../mobile/ports';
import { createMobileDemoState } from '../../src/domain/mobile-demo-state';
import type { DemoState } from '../../src/domain/types';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

function createPorts(): {
  scanner: BarcodeScannerPort;
  notifications: LocalNotificationPort;
  share: RecommendationPdfSharePort;
} {
  return {
    scanner: { scan: async () => null },
    notifications: {
      ensurePermission: async () => 'denied',
      notifyPriceChange: async () => undefined,
      listenForPriceChangeActions: async () => async () => undefined,
    },
    share: { sharePdf: async () => undefined },
  };
}

function renderMobile(
  overrides: Partial<ReturnType<typeof createPorts>> = {},
  seedFactory: () => DemoState = createMobileDemoState,
) {
  const gateway = new MockOperationsGateway(seedFactory);
  const ports = { ...createPorts(), ...overrides };
  render(<MobileApp gateway={gateway} scanner={ports.scanner} notifications={ports.notifications} share={ports.share} />);
  return { gateway, ...ports };
}

function createRecommendationState(): DemoState {
  const state = createMobileDemoState();
  return {
    ...state,
    skus: state.skus.map((sku) => {
      if (sku.id === 'sku-1') return { ...sku, imageUrl: '', name: 'Beras Lama CH009', stock: 4, createdAt: '2025-01-10T00:00:00.000Z' };
      if (sku.id === 'sku-2') return { ...sku, imageUrl: '', name: 'Kemeja Lama CH009', stock: 2, createdAt: '2025-06-10T00:00:00.000Z' };
      if (sku.id === 'sku-3') return { ...sku, imageUrl: '', name: 'Aksesori Baru CH010', stock: 8, createdAt: '2026-06-10T00:00:00.000Z' };
      return { ...sku, imageUrl: '', stock: 0 };
    }),
    notaTransactions: [],
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
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

test('bottom navigation has four destinations with recommendations after SKU Gudang', () => {
  renderMobile();

  const navigation = screen.getByRole('navigation', { name: 'Navigasi utama' });
  expect(within(navigation).getAllByRole('button').map((button) => button.textContent)).toEqual([
    'Beranda',
    'SKU Gudang',
    'Rekomendasi',
    'Perubahan Harga',
  ]);

  fireEvent.click(within(navigation).getByRole('button', { name: 'SKU Gudang' }));
  expect(screen.getByRole('heading', { name: 'SKU Gudang' })).toBeInTheDocument();
  fireEvent.click(within(navigation).getByRole('button', { name: 'Rekomendasi' }));
  expect(screen.getByRole('heading', { name: 'Rekomendasi Share' })).toHaveFocus();
  fireEvent.click(within(navigation).getByRole('button', { name: 'Perubahan Harga' }));
  expect(screen.getByRole('heading', { name: 'Perubahan Harga' })).toBeInTheDocument();
});

test('new pages and SKU detail transitions move focus into the routed content', () => {
  renderMobile();

  fireEvent.click(screen.getByRole('button', { name: 'SKU Gudang' }));
  expect(screen.getByRole('searchbox', { name: 'Cari SKU' })).toHaveFocus();

  fireEvent.click(screen.getByRole('button', { name: /Beras Hitam Premium 1 kg/ }));
  expect(screen.getByRole('heading', { name: 'Beras Hitam Premium 1 kg' })).toHaveFocus();

  fireEvent.click(screen.getByRole('button', { name: 'Kembali' }));
  expect(screen.getByRole('searchbox', { name: 'Cari SKU' })).toHaveFocus();

  fireEvent.click(screen.getByRole('button', { name: 'Perubahan Harga' }));
  expect(screen.getByRole('heading', { name: 'Perubahan Harga' })).toHaveFocus();
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

test('dashboard keeps its recommendation shortcut while mobile navigation has four destinations', () => {
  renderMobile({}, createRecommendationState);

  const quickActions = screen.getByRole('region', { name: 'Aksi cepat' });
  fireEvent.click(within(quickActions).getByRole('button', { name: 'Rekomendasi Share' }));
  fireEvent.change(screen.getByLabelText('Tanggal rekomendasi'), { target: { value: '2026-07-23' } });

  expect(screen.getByRole('heading', { name: 'Rekomendasi Share' })).toHaveFocus();
  expect(screen.getByLabelText('Tanggal rekomendasi')).toHaveValue('2026-07-23');
  expect(within(screen.getByRole('navigation', { name: 'Navigasi utama' })).getAllByRole('button')).toHaveLength(4);
});

test('share recommendations use the Windows daily and urgent grouping rules', () => {
  renderMobile({}, createRecommendationState);
  fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));
  fireEvent.change(screen.getByLabelText('Tanggal rekomendasi'), { target: { value: '2026-07-23' } });

  expect(screen.getByRole('tab', { name: 'Rekomendasi Harian' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('3 dari 3 SKU dipilih')).toBeInTheDocument();
  const ch009 = screen.getByRole('region', { name: 'Grup supplier CH009' });
  expect(within(ch009).getByText('Beras Lama CH009')).toBeInTheDocument();
  expect(within(ch009).getByText('Kemeja Lama CH009')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Grup supplier CH010' })).toHaveTextContent('Aksesori Baru CH010');

  fireEvent.click(screen.getByRole('tab', { name: 'SKU Urgent' }));
  expect(screen.getByText('2 dari 2 SKU urgent dimasukkan ke PDF')).toBeInTheDocument();
  expect(screen.getByText('Beras Lama CH009')).toBeInTheDocument();
  expect(screen.getByText('Kemeja Lama CH009')).toBeInTheDocument();
  expect(screen.queryByText('Aksesori Baru CH010')).not.toBeInTheDocument();
});

test('shares one catalogue PDF for the active recommendation tab without per-SKU share actions', async () => {
  const sharePdf = vi.fn(async () => undefined);
  renderMobile({ share: { sharePdf } }, createRecommendationState);
  fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));
  fireEvent.change(screen.getByLabelText('Tanggal rekomendasi'), { target: { value: '2026-07-23' } });

  expect(screen.queryByRole('button', { name: /^Bagikan SKU / })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'SKU Urgent' }));
  fireEvent.click(screen.getByRole('button', { name: 'Bagikan PDF Urgent' }));

  await waitFor(() => expect(sharePdf).toHaveBeenCalledOnce());
  expect(sharePdf).toHaveBeenCalledWith({
    blob: expect.any(Blob),
    fileName: 'CHU-SKU-Urgent-2026-07-23.pdf',
    title: 'SKU Urgent',
  });
  expect(await screen.findByRole('status')).toHaveTextContent('PDF SKU Urgent siap dibagikan.');
});

test('recommendation PDF share failure is non-destructive and can be retried', async () => {
  const sharePdf = vi.fn()
    .mockRejectedValueOnce(new Error('share cancelled'))
    .mockResolvedValueOnce(undefined);
  renderMobile({ share: { sharePdf } }, createRecommendationState);
  fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));
  fireEvent.change(screen.getByLabelText('Tanggal rekomendasi'), { target: { value: '2026-07-23' } });
  const shareButton = screen.getByRole('button', { name: 'Bagikan PDF Harian' });

  fireEvent.click(shareButton);
  expect(await screen.findByRole('alert')).toHaveTextContent('PDF belum dibagikan. Coba lagi.');
  fireEvent.click(shareButton);

  await waitFor(() => expect(sharePdf).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole('status')).toHaveTextContent('PDF Rekomendasi Harian siap dibagikan.');
  expect(screen.getByText('Beras Lama CH009')).toBeInTheDocument();
});

test('recommendation PDF button is full-list action above the product groups', () => {
  renderMobile({}, createRecommendationState);
  fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));
  const shareButton = screen.getByRole('button', { name: 'Bagikan PDF Harian' });
  const summary = screen.getByText('DAFTAR HARIAN').closest('.share-summary');

  expect(shareButton.compareDocumentPosition(summary!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(screen.getAllByRole('button', { name: /^Buka detail / })).toHaveLength(3);
  expect(screen.queryByRole('button', { name: /^Bagikan SKU / })).not.toBeInTheDocument();
  expect(shareButton).toHaveClass('share-pdf-action');
});

test('recommendation row can open the existing SKU detail', () => {
  renderMobile({}, createRecommendationState);
  fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));
  fireEvent.change(screen.getByLabelText('Tanggal rekomendasi'), { target: { value: '2026-07-23' } });

  fireEvent.click(screen.getByRole('button', { name: 'Buka detail Beras Lama CH009' }));

  expect(screen.getByRole('heading', { name: 'Beras Lama CH009' })).toHaveFocus();
  expect(screen.getByText('BRS-108')).toBeInTheDocument();
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

test('late scanner result cannot replace detail opened from a notification action', async () => {
  const deferredScan = createDeferred<Awaited<ReturnType<BarcodeScannerPort['scan']>>>();
  const scanner: BarcodeScannerPort = { scan: vi.fn(() => deferredScan.promise) };
  let actionListener: ((skuId: string) => void) | undefined;
  const notifications: LocalNotificationPort = {
    ensurePermission: async () => 'granted',
    notifyPriceChange: async () => undefined,
    listenForPriceChangeActions: async (listener) => {
      actionListener = listener;
      return async () => undefined;
    },
  };
  renderMobile({ notifications, scanner });
  await waitFor(() => expect(actionListener).toBeTypeOf('function'));

  fireEvent.click(screen.getByRole('button', { name: 'Scan Barcode' }));
  act(() => actionListener!('sku-2'));
  expect(screen.getByRole('heading', { name: 'Kemeja Linen Putih' })).toBeInTheDocument();

  await act(async () => {
    deferredScan.resolve({ rawValue: 'BRS-108', format: 'QR_CODE' });
    await deferredScan.promise;
  });

  expect(screen.getByRole('heading', { name: 'Kemeja Linen Putih' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Beras Hitam Premium 1 kg' })).not.toBeInTheDocument();
});

test('late scanner error cannot replace a page opened through navigation', async () => {
  const deferredScan = createDeferred<Awaited<ReturnType<BarcodeScannerPort['scan']>>>();
  const scanner: BarcodeScannerPort = { scan: vi.fn(() => deferredScan.promise) };
  renderMobile({ scanner });

  fireEvent.click(screen.getByRole('button', { name: 'Scan Barcode' }));
  fireEvent.click(screen.getByRole('button', { name: 'Perubahan Harga' }));
  expect(screen.getByRole('heading', { name: 'Perubahan Harga' })).toBeInTheDocument();

  await act(async () => {
    deferredScan.reject(new Error('camera stopped late'));
    await Promise.resolve();
  });

  expect(screen.getByRole('heading', { name: 'Perubahan Harga' })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

test.each([
  ['SKU changes', { ...createMobileDemoState().skus[0]!, id: 'sku-replacement' }],
  ['image source changes', { ...createMobileDemoState().skus[0]!, imageUrl: '/assets/mobile/replacement.svg' }],
])('product image retries after %s', async (_label, nextSku) => {
  const initialSku = createMobileDemoState().skus[0]!;
  const { container, rerender } = render(<ProductImage sku={initialSku} />);
  fireEvent.error(container.querySelector('img')!);
  expect(screen.getByTestId(`image-fallback-${initialSku.id}`)).toBeInTheDocument();

  rerender(<ProductImage sku={nextSku} />);

  await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', nextSku.imageUrl));
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
  render(<MobileApp gateway={gateway} scanner={ports.scanner} notifications={ports.notifications} share={ports.share} />);

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

test('listener removal rejection during unmount remains non-fatal', async () => {
  const rejectedRemoval = Promise.reject(new Error('remove failed'));
  void rejectedRemoval.catch(() => undefined);
  const catchRejection = vi.spyOn(rejectedRemoval, 'catch');
  const remove = vi.fn(() => rejectedRemoval);
  const listenForPriceChangeActions = vi.fn(async () => remove);
  const notifications: LocalNotificationPort = {
    ensurePermission: async () => 'granted',
    notifyPriceChange: async () => undefined,
    listenForPriceChangeActions,
  };
  const gateway = new MockOperationsGateway(createMobileDemoState);
  const ports = createPorts();
  const { unmount } = render(<MobileApp gateway={gateway} scanner={ports.scanner} notifications={notifications} share={ports.share} />);
  await waitFor(() => expect(listenForPriceChangeActions).toHaveBeenCalledOnce());

  unmount();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(remove).toHaveBeenCalledOnce();
  expect(catchRejection).toHaveBeenCalledOnce();
});

test('late listener removal rejection after unmount remains non-fatal', async () => {
  let resolveListener: ((remove: () => Promise<void>) => void) | undefined;
  const rejectedRemoval = Promise.reject(new Error('late remove failed'));
  void rejectedRemoval.catch(() => undefined);
  const catchRejection = vi.spyOn(rejectedRemoval, 'catch');
  const remove = vi.fn(() => rejectedRemoval);
  const listenForPriceChangeActions = vi.fn(() => new Promise<() => Promise<void>>((resolve) => {
    resolveListener = resolve;
  }));
  const notifications: LocalNotificationPort = {
    ensurePermission: async () => 'granted',
    notifyPriceChange: async () => undefined,
    listenForPriceChangeActions,
  };
  const gateway = new MockOperationsGateway(createMobileDemoState);
  const ports = createPorts();
  const { unmount } = render(<MobileApp gateway={gateway} scanner={ports.scanner} notifications={notifications} share={ports.share} />);
  await waitFor(() => expect(resolveListener).toBeTypeOf('function'));
  unmount();

  await act(async () => {
    resolveListener!(remove);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(remove).toHaveBeenCalledOnce();
  expect(catchRejection).toHaveBeenCalledOnce();
});
