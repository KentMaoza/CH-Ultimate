import type { Sku, SkuPriceChange } from '../src/domain/types';

export interface BarcodeScanResult {
  rawValue: string;
  format: string;
}

export interface BarcodeScannerPort {
  scan(): Promise<BarcodeScanResult | null>;
}

export interface LocalNotificationPort {
  ensurePermission(): Promise<'granted' | 'denied'>;
  notifyPriceChange(change: SkuPriceChange, sku: Sku): Promise<void>;
}

export const browserBarcodeScanner: BarcodeScannerPort = {
  scan: async () => null,
};

export const browserLocalNotifications: LocalNotificationPort = {
  ensurePermission: async () => 'denied',
  notifyPriceChange: async () => undefined,
};
