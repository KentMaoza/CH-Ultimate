import { createMobilePorts } from '../../mobile/bootstrap';
import { browserBarcodeScanner, browserLocalNotifications, browserSkuShare } from '../../mobile/ports';

test('mobile bootstrap selects native adapters only for a native Capacitor platform', () => {
  expect(createMobilePorts(false)).toEqual({
    scanner: browserBarcodeScanner,
    notifications: browserLocalNotifications,
    share: browserSkuShare,
  });

  const native = createMobilePorts(true);
  expect(native.scanner).not.toBe(browserBarcodeScanner);
  expect(native.notifications).not.toBe(browserLocalNotifications);
  expect(native.share).not.toBe(browserSkuShare);
});
