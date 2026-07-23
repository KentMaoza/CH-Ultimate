import { createNativeBarcodeScanner, createNativeLocalNotifications, createNativeSkuShare } from './native-adapters';
import {
  browserBarcodeScanner,
  browserLocalNotifications,
  browserSkuShare,
  type BarcodeScannerPort,
  type LocalNotificationPort,
  type SkuSharePort,
} from './ports';

export interface MobilePorts {
  scanner: BarcodeScannerPort;
  notifications: LocalNotificationPort;
  share: SkuSharePort;
}

export function createMobilePorts(isNativePlatform: boolean): MobilePorts {
  if (!isNativePlatform) {
    return { scanner: browserBarcodeScanner, notifications: browserLocalNotifications, share: browserSkuShare };
  }
  return {
    scanner: createNativeBarcodeScanner(),
    notifications: createNativeLocalNotifications(),
    share: createNativeSkuShare(),
  };
}
