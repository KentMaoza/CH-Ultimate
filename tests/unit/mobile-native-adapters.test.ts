import {
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint,
} from '@capacitor/barcode-scanner';
import { ImpactStyle } from '@capacitor/haptics';
import type { ActionPerformed } from '@capacitor/local-notifications';
import {
  createNativeBarcodeScanner,
  createNativeLocalNotifications,
  createNativeSkuShare,
} from '../../mobile/native-adapters';
import { formatSkuShareText } from '../../mobile/ports';
import { createMobileDemoState } from '../../src/domain/mobile-demo-state';

function createNotificationPlugin(display: 'granted' | 'denied' | 'prompt' = 'granted') {
  let actionListener: ((action: ActionPerformed) => void) | undefined;
  const remove = vi.fn(async () => undefined);
  return {
    plugin: {
      checkPermissions: vi.fn(async () => ({ display })),
      requestPermissions: vi.fn(async () => ({ display })),
      createChannel: vi.fn(async () => undefined),
      schedule: vi.fn(async (options) => ({
        notifications: options.notifications.map((notification: { id: number }) => ({ id: notification.id })),
      })),
      addListener: vi.fn(async (_eventName, listener) => {
        actionListener = listener;
        return { remove };
      }),
    },
    getActionListener: () => actionListener,
    remove,
  };
}

test('native scanner maps ALL formats, back camera, adaptive orientation, result, and haptic feedback', async () => {
  const scanBarcode = vi.fn(async () => ({
    ScanResult: '  SKU-001\n',
    format: CapacitorBarcodeScannerTypeHint.CODE_128,
  }));
  const impact = vi.fn(async () => undefined);
  const scanner = createNativeBarcodeScanner({ scanBarcode }, { impact });

  await expect(scanner.scan()).resolves.toEqual({
    rawValue: '  SKU-001\n',
    format: CapacitorBarcodeScannerTypeHint.CODE_128,
  });
  expect(scanBarcode).toHaveBeenCalledWith(expect.objectContaining({
    hint: CapacitorBarcodeScannerTypeHint.ALL,
    cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
    scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
  }));
  expect(impact).toHaveBeenCalledWith({ style: ImpactStyle.Medium });
});

test('native scanner returns null for cancellation, empty results, and plugin errors', async () => {
  const impact = vi.fn(async () => undefined);
  const cancelled = createNativeBarcodeScanner(
    { scanBarcode: vi.fn(async () => ({ ScanResult: '', format: CapacitorBarcodeScannerTypeHint.ALL })) },
    { impact },
  );
  const failed = createNativeBarcodeScanner(
    { scanBarcode: vi.fn(async () => { throw new Error('camera unavailable'); }) },
    { impact },
  );

  await expect(cancelled.scan()).resolves.toBeNull();
  await expect(failed.scan()).resolves.toBeNull();
  expect(impact).not.toHaveBeenCalled();
});

test('native notifications use an existing grant or request Android display permission', async () => {
  const granted = createNotificationPlugin('granted');
  const prompt = createNotificationPlugin('prompt');
  prompt.plugin.requestPermissions.mockResolvedValue({ display: 'denied' });

  await expect(createNativeLocalNotifications(granted.plugin).ensurePermission()).resolves.toBe('granted');
  expect(granted.plugin.requestPermissions).not.toHaveBeenCalled();
  await expect(createNativeLocalNotifications(prompt.plugin).ensurePermission()).resolves.toBe('denied');
  expect(prompt.plugin.requestPermissions).toHaveBeenCalledOnce();
});

test('native notifications create the price channel before scheduling the SKU price body and route data', async () => {
  const native = createNotificationPlugin();
  const notifications = createNativeLocalNotifications(native.plugin);
  const state = createMobileDemoState();
  const sku = state.skus[0]!;
  const change = { id: 'price-native-1', skuId: sku.id, before: 42_000, after: 43_000, createdAt: new Date().toISOString() };

  await notifications.notifyPriceChange(change, sku);

  expect(native.plugin.createChannel).toHaveBeenCalledWith(expect.objectContaining({
    id: 'price-changes',
    name: 'Perubahan harga SKU',
  }));
  expect(native.plugin.schedule).toHaveBeenCalledWith({
    notifications: [expect.objectContaining({
      title: 'Perubahan harga SKU',
      body: 'SKU BRS-108-BLK: Rp42.000 → Rp43.000',
      channelId: 'price-changes',
      extra: { skuId: 'sku-1' },
    })],
  });
  expect(native.plugin.createChannel.mock.invocationCallOrder[0])
    .toBeLessThan(native.plugin.schedule.mock.invocationCallOrder[0]!);
});

test('native notification actions forward only a valid skuId and expose listener cleanup', async () => {
  const native = createNotificationPlugin();
  const notifications = createNativeLocalNotifications(native.plugin);
  const onSku = vi.fn();

  const remove = await notifications.listenForPriceChangeActions(onSku);
  native.getActionListener()!({
    actionId: 'tap',
    notification: { id: 1, title: 'Perubahan harga SKU', body: 'Harga berubah', extra: { skuId: 'sku-2' } },
  });
  native.getActionListener()!({
    actionId: 'tap',
    notification: { id: 2, title: 'Lainnya', body: 'Tanpa SKU', extra: {} },
  });
  await remove();

  expect(native.plugin.addListener).toHaveBeenCalledWith('localNotificationActionPerformed', expect.any(Function));
  expect(onSku).toHaveBeenCalledOnce();
  expect(onSku).toHaveBeenCalledWith('sku-2');
  expect(native.remove).toHaveBeenCalledOnce();
});

test('SKU share text contains public product fields without warehouse stock', () => {
  const sku = createMobileDemoState().skus[0]!;

  expect(formatSkuShareText(sku)).toBe(
    'Beras Hitam Premium 1 kg\nSKU: BRS-108-BLK\nHarga referensi: Rp42.000',
  );
  expect(formatSkuShareText(sku)).not.toContain('Stok');
  expect(formatSkuShareText(sku)).not.toContain(String(sku.stock));
});

test('native SKU share writes one product image to cache, shares one SKU, and removes the cache file', async () => {
  const sku = createMobileDemoState().skus[0]!;
  const share = vi.fn(async () => ({ activityType: 'whatsapp' }));
  const writeFile = vi.fn(async () => ({ uri: 'file:///cache/chu-share-BRS-108-BLK.svg' }));
  const deleteFile = vi.fn(async () => undefined);
  const loadImage = vi.fn(async () => ({ data: 'PHN2Zz4=', extension: 'svg' }));
  const adapter = createNativeSkuShare({ share }, { writeFile, deleteFile }, loadImage);

  await adapter.shareSku(sku);

  expect(loadImage).toHaveBeenCalledWith('/assets/mobile/beras-hitam-premium.svg');
  expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({
    path: 'chu-share-BRS-108-BLK.svg',
    data: 'PHN2Zz4=',
  }));
  expect(share).toHaveBeenCalledOnce();
  expect(share).toHaveBeenCalledWith({
    title: 'Beras Hitam Premium 1 kg',
    text: 'Beras Hitam Premium 1 kg\nSKU: BRS-108-BLK\nHarga referensi: Rp42.000',
    files: ['file:///cache/chu-share-BRS-108-BLK.svg'],
    dialogTitle: 'Bagikan SKU',
  });
  expect(deleteFile).toHaveBeenCalledWith(expect.objectContaining({
    path: 'chu-share-BRS-108-BLK.svg',
  }));
});

test('native SKU share falls back to text when the image cannot be prepared', async () => {
  const sku = createMobileDemoState().skus[0]!;
  const share = vi.fn(async () => ({ activityType: '' }));
  const writeFile = vi.fn(async () => ({ uri: 'file:///cache/unexpected.svg' }));
  const deleteFile = vi.fn(async () => undefined);
  const loadImage = vi.fn(async () => { throw new Error('image unavailable'); });

  await createNativeSkuShare({ share }, { writeFile, deleteFile }, loadImage).shareSku(sku);

  expect(share).toHaveBeenCalledWith({
    title: sku.name,
    text: formatSkuShareText(sku),
    dialogTitle: 'Bagikan SKU',
  });
  expect(writeFile).not.toHaveBeenCalled();
  expect(deleteFile).not.toHaveBeenCalled();
});

test('native SKU share falls back to text when the cache image cannot be written', async () => {
  const sku = createMobileDemoState().skus[0]!;
  const share = vi.fn(async () => ({ activityType: '' }));
  const writeFile = vi.fn(async () => { throw new Error('cache unavailable'); });
  const deleteFile = vi.fn(async () => undefined);
  const loadImage = vi.fn(async () => ({ data: 'PHN2Zz4=', extension: 'svg' }));

  await createNativeSkuShare({ share }, { writeFile, deleteFile }, loadImage).shareSku(sku);

  expect(share).toHaveBeenCalledWith({
    title: sku.name,
    text: formatSkuShareText(sku),
    dialogTitle: 'Bagikan SKU',
  });
  expect(deleteFile).not.toHaveBeenCalled();
});

test('native SKU share removes its cache file even when the share sheet rejects', async () => {
  const sku = createMobileDemoState().skus[0]!;
  const share = vi.fn(async () => { throw new Error('share cancelled'); });
  const writeFile = vi.fn(async () => ({ uri: 'file:///cache/chu-share-BRS-108-BLK.svg' }));
  const deleteFile = vi.fn(async () => undefined);
  const loadImage = vi.fn(async () => ({ data: 'PHN2Zz4=', extension: 'svg' }));
  const adapter = createNativeSkuShare({ share }, { writeFile, deleteFile }, loadImage);

  await expect(adapter.shareSku(sku)).rejects.toThrow('share cancelled');
  expect(deleteFile).toHaveBeenCalledOnce();
});
