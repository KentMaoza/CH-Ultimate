import { createNativeBarcodeScanner, createNativeLocalNotifications } from './native-adapters';
import {
  browserBarcodeScanner,
  browserLocalNotifications,
  type BarcodeScannerPort,
  type LocalNotificationPort,
} from './ports';

export interface MobilePorts {
  scanner: BarcodeScannerPort;
  notifications: LocalNotificationPort;
}

export function createMobilePorts(isNativePlatform: boolean): MobilePorts {
  if (!isNativePlatform) {
    return { scanner: browserBarcodeScanner, notifications: browserLocalNotifications };
  }
  return {
    scanner: createNativeBarcodeScanner(),
    notifications: createNativeLocalNotifications(),
  };
}
