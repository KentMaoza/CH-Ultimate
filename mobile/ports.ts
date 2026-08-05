import type { Sku, SkuPriceChange } from '../src/domain/types';

export interface BarcodeScanResult {
  rawValue: string;
  format: string | number;
}

export interface BarcodeScannerPort {
  scan(): Promise<BarcodeScanResult | null>;
}

export type AppBackButtonHandler = () => boolean;

export interface AppBackButtonPort {
  dispose(): Promise<void>;
  setHandler(handler: AppBackButtonHandler): () => void;
}

export interface LocalNotificationPort {
  ensurePermission(): Promise<'granted' | 'denied'>;
  notifyPriceChange(change: SkuPriceChange, sku: Sku): Promise<void>;
  listenForPriceChangeActions(listener: (skuId: string) => void): Promise<() => Promise<void>>;
}

export interface PdfSharePayload {
  blob: Blob;
  fileName: string;
  title: string;
  shareText?: string;
}

export interface PdfSharePort {
  sharePdf(payload: PdfSharePayload): Promise<void>;
}

export const browserBarcodeScanner: BarcodeScannerPort = {
  scan: async () => null,
};

export const browserAppBackButton: AppBackButtonPort = {
  dispose: async () => undefined,
  setHandler: () => () => undefined,
};

export const browserLocalNotifications: LocalNotificationPort = {
  ensurePermission: async () => 'denied',
  notifyPriceChange: async () => undefined,
  listenForPriceChangeActions: async () => async () => undefined,
};

export const browserPdfShare: PdfSharePort = {
  async sharePdf({ blob, fileName, title, shareText = 'DATA DEMO · SESSION ONLY' }) {
    if (!navigator.share) throw new Error('Menu berbagi tidak tersedia di browser ini.');
    const file = new File([blob], fileName, { type: 'application/pdf' });
    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
      throw new Error('Berbagi file PDF tidak tersedia di browser ini.');
    }
    await navigator.share({
      files: [file],
      title,
      text: shareText,
    });
  },
};

export type RecommendationPdfSharePayload = PdfSharePayload;
export type RecommendationPdfSharePort = PdfSharePort;
export const browserRecommendationPdfShare = browserPdfShare;
