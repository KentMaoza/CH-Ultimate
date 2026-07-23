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
import { formatRupiah } from './format';
import type {
  BarcodeScannerPort,
  LocalNotificationPort,
  RecommendationPdfSharePort,
} from './ports';

type ScannerPlugin = Pick<CapacitorBarcodeScannerPlugin, 'scanBarcode'>;
type HapticPlugin = Pick<HapticsPlugin, 'impact'>;
type NotificationPlugin = Pick<LocalNotificationsPlugin,
  'addListener' | 'checkPermissions' | 'createChannel' | 'requestPermissions' | 'schedule'>;
type NativeSharePlugin = Pick<SharePlugin, 'share'>;
type NativeFilesystemPlugin = Pick<FilesystemPlugin, 'deleteFile' | 'writeFile'>;
type BlobToBase64 = (blob: Blob) => Promise<string>;

function notificationId(value: string): number {
  let hash = 0;
  for (const character of value) hash = ((hash * 31) + character.charCodeAt(0)) | 0;
  return hash || 1;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('PDF tidak dapat dibaca.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
  const separator = dataUrl.indexOf(',');
  if (separator < 0) throw new Error('Format PDF tidak didukung.');
  return dataUrl.slice(separator + 1);
}

export function createNativeRecommendationPdfShare(
  sharePlugin: NativeSharePlugin = Share,
  filesystem: NativeFilesystemPlugin = Filesystem,
  convertBlob: BlobToBase64 = blobToBase64,
): RecommendationPdfSharePort {
  return {
    async sharePdf({ blob, fileName, title }) {
      const data = await convertBlob(blob);
      const written = await filesystem.writeFile({
        path: fileName,
        data,
        directory: Directory.Cache,
      });

      try {
        await sharePlugin.share({
          title,
          text: 'DATA DEMO · SESSION ONLY',
          files: [written.uri],
          dialogTitle: 'Bagikan PDF',
        });
      } finally {
        await filesystem.deleteFile({ path: fileName, directory: Directory.Cache }).catch(() => undefined);
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
