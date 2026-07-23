import type { Sku, SkuPriceChange } from '../src/domain/types';
import { formatSkuShareText } from '../src/domain/sku-share';

export { formatSkuShareText } from '../src/domain/sku-share';

export interface BarcodeScanResult {
  rawValue: string;
  format: string | number;
}

export interface BarcodeScannerPort {
  scan(): Promise<BarcodeScanResult | null>;
}

export interface LocalNotificationPort {
  ensurePermission(): Promise<'granted' | 'denied'>;
  notifyPriceChange(change: SkuPriceChange, sku: Sku): Promise<void>;
  listenForPriceChangeActions(listener: (skuId: string) => void): Promise<() => Promise<void>>;
}

export interface SkuSharePort {
  shareSku(sku: Sku): Promise<void>;
}

export const browserBarcodeScanner: BarcodeScannerPort = {
  scan: async () => null,
};

export const browserLocalNotifications: LocalNotificationPort = {
  ensurePermission: async () => 'denied',
  notifyPriceChange: async () => undefined,
  listenForPriceChangeActions: async () => async () => undefined,
};

export const browserSkuShare: SkuSharePort = {
  async shareSku(sku) {
    if (!navigator.share) throw new Error('Menu berbagi tidak tersedia di browser ini.');
    await navigator.share({
      title: sku.name,
      text: formatSkuShareText(sku),
    });
  },
};
