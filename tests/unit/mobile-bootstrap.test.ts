import { createMobilePorts } from '../../mobile/bootstrap';
import { browserBarcodeScanner, browserLocalNotifications } from '../../mobile/ports';

test('mobile bootstrap selects native adapters only for a native Capacitor platform', () => {
  expect(createMobilePorts(false)).toEqual({
    scanner: browserBarcodeScanner,
    notifications: browserLocalNotifications,
  });

  const native = createMobilePorts(true);
  expect(native.scanner).not.toBe(browserBarcodeScanner);
  expect(native.notifications).not.toBe(browserLocalNotifications);
});
