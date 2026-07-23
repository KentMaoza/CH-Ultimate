import { createNativeBarcodeScanner, createNativeLocalNotifications, createNativeRecommendationPdfShare } from './native-adapters';
import {
  browserBarcodeScanner,
  browserLocalNotifications,
  browserRecommendationPdfShare,
  type BarcodeScannerPort,
  type LocalNotificationPort,
  type RecommendationPdfSharePort,
} from './ports';

export interface MobilePorts {
  scanner: BarcodeScannerPort;
  notifications: LocalNotificationPort;
  share: RecommendationPdfSharePort;
}

export function createMobilePorts(isNativePlatform: boolean): MobilePorts {
  if (!isNativePlatform) {
    return { scanner: browserBarcodeScanner, notifications: browserLocalNotifications, share: browserRecommendationPdfShare };
  }
  return {
    scanner: createNativeBarcodeScanner(),
    notifications: createNativeLocalNotifications(),
    share: createNativeRecommendationPdfShare(),
  };
}
