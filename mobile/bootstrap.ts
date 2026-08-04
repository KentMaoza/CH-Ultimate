import { createNativeBarcodeScanner, createNativeLocalNotifications, createNativePdfShare } from './native-adapters';
import {
  createNativeCoreApiBridge,
  type MobileCoreBridge,
} from './core-api-native';
import {
  browserBarcodeScanner,
  browserLocalNotifications,
  browserPdfShare,
  type BarcodeScannerPort,
  type LocalNotificationPort,
  type PdfSharePort,
} from './ports';

export interface MobilePorts {
  scanner: BarcodeScannerPort;
  notifications: LocalNotificationPort;
  share: PdfSharePort;
}

export interface MobileRuntime {
  ports: MobilePorts;
  bridge?: MobileCoreBridge;
}

export function createMobilePorts(isNativePlatform: boolean): MobilePorts {
  if (!isNativePlatform) {
    return { scanner: browserBarcodeScanner, notifications: browserLocalNotifications, share: browserPdfShare };
  }
  return {
    scanner: createNativeBarcodeScanner(),
    notifications: createNativeLocalNotifications(),
    share: createNativePdfShare(),
  };
}

export function createMobileRuntime(
  isNativePlatform: boolean,
  bridgeFactory: () => MobileCoreBridge = createNativeCoreApiBridge,
): MobileRuntime {
  const ports = createMobilePorts(isNativePlatform);
  if (!isNativePlatform) return { ports };
  return { ports, bridge: bridgeFactory() };
}
