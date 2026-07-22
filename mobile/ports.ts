import type { Sku, SkuPriceChange } from '../src/domain/types';

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

export const browserBarcodeScanner: BarcodeScannerPort = {
  scan: async () => null,
};

export const browserLocalNotifications: LocalNotificationPort = {
  ensurePermission: async () => 'denied',
  notifyPriceChange: async () => undefined,
  listenForPriceChangeActions: async () => async () => undefined,
};
