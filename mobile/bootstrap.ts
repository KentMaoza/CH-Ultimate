import { createNativeBarcodeScanner, createNativeLocalNotifications, createNativeRecommendationPdfShare } from './native-adapters';
import {
  createNativeCoreApiBridge,
  type MobileCoreBridge,
} from './core-api-native';
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

export interface MobileRuntime {
  ports: MobilePorts;
  bridge?: MobileCoreBridge;
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

export function createMobileRuntime(
  isNativePlatform: boolean,
  bridgeFactory: () => MobileCoreBridge = createNativeCoreApiBridge,
): MobileRuntime {
  const ports = createMobilePorts(isNativePlatform);
  if (!isNativePlatform) return { ports };
  return { ports, bridge: bridgeFactory() };
}
