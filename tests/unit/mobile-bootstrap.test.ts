import { vi } from 'vitest';

import {
  createMobilePorts,
  createMobileRuntime,
} from '../../mobile/bootstrap';
import type { MobileCoreBridge } from '../../mobile/core-api-native';
import { browserBarcodeScanner, browserLocalNotifications, browserRecommendationPdfShare } from '../../mobile/ports';

test('mobile bootstrap selects native adapters only for a native Capacitor platform', () => {
  expect(createMobilePorts(false)).toEqual({
    scanner: browserBarcodeScanner,
    notifications: browserLocalNotifications,
    share: browserRecommendationPdfShare,
  });

  const native = createMobilePorts(true);
  expect(native.scanner).not.toBe(browserBarcodeScanner);
  expect(native.notifications).not.toBe(browserLocalNotifications);
  expect(native.share).not.toBe(browserRecommendationPdfShare);
});

test('mobile bootstrap creates the CH Core bridge only for native Capacitor', () => {
  const bridge = {} as MobileCoreBridge;
  const bridgeFactory = vi.fn(() => bridge);

  expect(createMobileRuntime(false, bridgeFactory)).toEqual({
    ports: {
      scanner: browserBarcodeScanner,
      notifications: browserLocalNotifications,
      share: browserRecommendationPdfShare,
    },
  });
  expect(bridgeFactory).not.toHaveBeenCalled();

  const native = createMobileRuntime(true, bridgeFactory);
  expect(native.bridge).toBe(bridge);
  expect(bridgeFactory).toHaveBeenCalledTimes(1);
});
