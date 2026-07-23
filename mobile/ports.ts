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

export interface RecommendationPdfSharePayload {
  blob: Blob;
  fileName: string;
  title: string;
}

export interface RecommendationPdfSharePort {
  sharePdf(payload: RecommendationPdfSharePayload): Promise<void>;
}

export const browserBarcodeScanner: BarcodeScannerPort = {
  scan: async () => null,
};

export const browserLocalNotifications: LocalNotificationPort = {
  ensurePermission: async () => 'denied',
  notifyPriceChange: async () => undefined,
  listenForPriceChangeActions: async () => async () => undefined,
};

export const browserRecommendationPdfShare: RecommendationPdfSharePort = {
  async sharePdf({ blob, fileName, title }) {
    if (!navigator.share) throw new Error('Menu berbagi tidak tersedia di browser ini.');
    const file = new File([blob], fileName, { type: 'application/pdf' });
    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
      throw new Error('Berbagi file PDF tidak tersedia di browser ini.');
    }
    await navigator.share({
      files: [file],
      title,
      text: 'DATA DEMO · SESSION ONLY',
    });
  },
};
