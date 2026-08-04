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
  createNativePdfShare,
} from '../../mobile/native-adapters';
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

test('native scanner maps its result and gives haptic plus sound feedback after a successful decode', async () => {
  const scanBarcode = vi.fn(async () => ({
    ScanResult: '  SKU-001\n',
    format: CapacitorBarcodeScannerTypeHint.CODE_128,
  }));
  const impact = vi.fn(async () => undefined);
  const playSuccessSound = vi.fn(async () => { throw new Error('audio unavailable'); });
  const scanner = createNativeBarcodeScanner({ scanBarcode }, { impact }, playSuccessSound);

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
  expect(playSuccessSound).toHaveBeenCalledOnce();
});

test('native scanner returns null without success feedback for cancellation, empty results, and plugin errors', async () => {
  const impact = vi.fn(async () => undefined);
  const playSuccessSound = vi.fn(async () => undefined);
  const cancelled = createNativeBarcodeScanner(
    { scanBarcode: vi.fn(async () => ({ ScanResult: '', format: CapacitorBarcodeScannerTypeHint.ALL })) },
    { impact },
    playSuccessSound,
  );
  const failed = createNativeBarcodeScanner(
    { scanBarcode: vi.fn(async () => { throw new Error('camera unavailable'); }) },
    { impact },
    playSuccessSound,
  );

  await expect(cancelled.scan()).resolves.toBeNull();
  await expect(failed.scan()).resolves.toBeNull();
  expect(impact).not.toHaveBeenCalled();
  expect(playSuccessSound).not.toHaveBeenCalled();
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
  const change = { id: 'price-native-1', skuId: sku.id, before: 42_000, after: 43_000, createdAt: new Date().toISOString(), source: 'manual' as const };

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

test('native PDF share writes one PDF to cache, opens Android Share, and removes the file', async () => {
  const share = vi.fn(async () => ({ activityType: 'whatsapp' }));
  const writeFile = vi.fn(async () => ({ uri: 'file:///cache/CHU-Rekomendasi-Harian-2026-07-23.pdf' }));
  const deleteFile = vi.fn(async () => undefined);
  const toBase64 = vi.fn(async () => 'JVBERi0=');
  const adapter = createNativePdfShare({ share }, { writeFile, deleteFile }, toBase64);
  const blob = new Blob(['%PDF-1.3'], { type: 'application/pdf' });

  await adapter.sharePdf({
    blob,
    fileName: 'CHU-Rekomendasi-Harian-2026-07-23.pdf',
    title: 'Rekomendasi Harian',
    shareText: 'CH Core · Data tersinkronisasi melalui NAS lokal',
  });

  expect(toBase64).toHaveBeenCalledWith(blob);
  expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({
    path: 'CHU-Rekomendasi-Harian-2026-07-23.pdf',
    data: 'JVBERi0=',
  }));
  expect(share).toHaveBeenCalledOnce();
  expect(share).toHaveBeenCalledWith({
    title: 'Rekomendasi Harian',
    text: 'CH Core · Data tersinkronisasi melalui NAS lokal',
    files: ['file:///cache/CHU-Rekomendasi-Harian-2026-07-23.pdf'],
    dialogTitle: 'Bagikan PDF',
  });
  expect(deleteFile).toHaveBeenCalledWith(expect.objectContaining({
    path: 'CHU-Rekomendasi-Harian-2026-07-23.pdf',
  }));
});

test('native PDF share removes its cache PDF when the share sheet rejects', async () => {
  const share = vi.fn(async () => { throw new Error('share cancelled'); });
  const writeFile = vi.fn(async () => ({ uri: 'file:///cache/CHU-SKU-Urgent-2026-07-23.pdf' }));
  const deleteFile = vi.fn(async () => undefined);
  const adapter = createNativePdfShare(
    { share },
    { writeFile, deleteFile },
    async () => 'JVBERi0=',
  );

  await expect(adapter.sharePdf({
    blob: new Blob(['%PDF-1.3'], { type: 'application/pdf' }),
    fileName: 'CHU-SKU-Urgent-2026-07-23.pdf',
    title: 'SKU Urgent',
  })).rejects.toThrow('share cancelled');
  expect(deleteFile).toHaveBeenCalledOnce();
});
