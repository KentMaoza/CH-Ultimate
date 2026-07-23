import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint,
  type CapacitorBarcodeScannerPlugin,
} from '@capacitor/barcode-scanner';
import { Haptics, ImpactStyle, type HapticsPlugin } from '@capacitor/haptics';
import { LocalNotifications, type LocalNotificationsPlugin } from '@capacitor/local-notifications';
import { Directory, Filesystem, type FilesystemPlugin } from '@capacitor/filesystem';
import { Share, type SharePlugin } from '@capacitor/share';
import type { Sku } from '../src/domain/types';
import { formatRupiah } from './format';
import { formatSkuShareText, type BarcodeScannerPort, type LocalNotificationPort, type SkuSharePort } from './ports';

type ScannerPlugin = Pick<CapacitorBarcodeScannerPlugin, 'scanBarcode'>;
type HapticPlugin = Pick<HapticsPlugin, 'impact'>;
type NotificationPlugin = Pick<LocalNotificationsPlugin,
  'addListener' | 'checkPermissions' | 'createChannel' | 'requestPermissions' | 'schedule'>;
type NativeSharePlugin = Pick<SharePlugin, 'share'>;
type NativeFilesystemPlugin = Pick<FilesystemPlugin, 'deleteFile' | 'writeFile'>;
type LoadedShareImage = { data: string; extension: string };
type ShareImageLoader = (url: string) => Promise<LoadedShareImage>;

function notificationId(value: string): number {
  let hash = 0;
  for (const character of value) hash = ((hash * 31) + character.charCodeAt(0)) | 0;
  return hash || 1;
}

function shareFileName(sku: Sku, extension: string): string {
  const safeSkuNumber = sku.skuNumber.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'sku';
  return `chu-share-${safeSkuNumber}.${extension}`;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('svg')) return 'svg';
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  return 'jpg';
}

async function loadShareImage(url: string): Promise<LoadedShareImage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Gambar produk tidak dapat dimuat.');
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gambar produk tidak dapat dibaca.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
  const separator = dataUrl.indexOf(',');
  if (separator < 0) throw new Error('Format gambar produk tidak didukung.');
  return {
    data: dataUrl.slice(separator + 1),
    extension: extensionForMimeType(blob.type),
  };
}

export function createNativeSkuShare(
  sharePlugin: NativeSharePlugin = Share,
  filesystem: NativeFilesystemPlugin = Filesystem,
  imageLoader: ShareImageLoader = loadShareImage,
): SkuSharePort {
  return {
    async shareSku(sku) {
      const common = {
        title: sku.name,
        text: formatSkuShareText(sku),
        dialogTitle: 'Bagikan SKU',
      };
      if (!sku.imageUrl) {
        await sharePlugin.share(common);
        return;
      }

      let image: LoadedShareImage;
      try {
        image = await imageLoader(sku.imageUrl);
      } catch {
        await sharePlugin.share(common);
        return;
      }

      const path = shareFileName(sku, image.extension);
      let written: Awaited<ReturnType<NativeFilesystemPlugin['writeFile']>>;
      try {
        written = await filesystem.writeFile({
          path,
          data: image.data,
          directory: Directory.Cache,
        });
      } catch {
        await sharePlugin.share(common);
        return;
      }

      try {
        await sharePlugin.share({ ...common, files: [written.uri] });
      } finally {
        await filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
      }
    },
  };
}

export function createNativeBarcodeScanner(
  plugin: ScannerPlugin = CapacitorBarcodeScanner,
  haptics: HapticPlugin = Haptics,
): BarcodeScannerPort {
  return {
    async scan() {
      try {
        const result = await plugin.scanBarcode({
          hint: CapacitorBarcodeScannerTypeHint.ALL,
          cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
          scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
          cancelButtonAccessibilityLabel: 'Batalkan pemindaian',
          torchButtonOnAccessibilityLabel: 'Matikan lampu pemindai',
          torchButtonOffAccessibilityLabel: 'Nyalakan lampu pemindai',
        });
        if (!result.ScanResult) return null;
        try {
          await haptics.impact({ style: ImpactStyle.Medium });
        } catch {
          // A decoded barcode remains usable if device haptics are unavailable.
        }
        return { rawValue: result.ScanResult, format: result.format };
      } catch {
        return null;
      }
    },
  };
}

export function createNativeLocalNotifications(
  plugin: NotificationPlugin = LocalNotifications,
): LocalNotificationPort {
  return {
    async ensurePermission() {
      const current = await plugin.checkPermissions();
      if (current.display === 'granted') return 'granted';
      const requested = await plugin.requestPermissions();
      return requested.display === 'granted' ? 'granted' : 'denied';
    },

    async notifyPriceChange(change, sku) {
      await plugin.createChannel({
        id: 'price-changes',
        name: 'Perubahan harga SKU',
        description: 'Pemberitahuan perubahan harga referensi SKU',
        importance: 3,
      });
      await plugin.schedule({
        notifications: [{
          id: notificationId(change.id),
          title: 'Perubahan harga SKU',
          body: `SKU ${sku.skuNumber}: ${formatRupiah(change.before)} → ${formatRupiah(change.after)}`,
          channelId: 'price-changes',
          autoCancel: true,
          extra: { skuId: sku.id },
        }],
      });
    },

    async listenForPriceChangeActions(listener) {
      const handle = await plugin.addListener('localNotificationActionPerformed', (action) => {
        const skuId = action.notification.extra?.skuId;
        if (typeof skuId === 'string' && skuId.length > 0) listener(skuId);
      });
      return () => handle.remove();
    },
  };
}
