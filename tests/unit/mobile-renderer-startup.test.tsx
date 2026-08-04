import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

afterEach(() => {
  document.body.innerHTML = '';
  vi.doUnmock('@capacitor/core');
  vi.doUnmock('../../mobile/MobileApp');
  vi.doUnmock('../../mobile/core-api-bootstrap');
  vi.restoreAllMocks();
  vi.resetModules();
});

test('mobile renderer replaces a crash with a safe retry screen', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  const gateway = new MockOperationsGateway();
  const bootstrapMobileGateway = vi.fn().mockResolvedValue({
    kind: 'gateway',
    source: 'demo',
    gateway,
  });
  vi.doMock('@capacitor/core', async () => {
    const actual = await vi.importActual<typeof import('@capacitor/core')>(
      '@capacitor/core',
    );
    return {
      ...actual,
      Capacitor: { ...actual.Capacitor, isNativePlatform: () => false },
    };
  });
  vi.doMock('../../mobile/core-api-bootstrap', async () => {
    const actual = await vi.importActual<
      typeof import('../../mobile/core-api-bootstrap')
    >('../../mobile/core-api-bootstrap');
    return { ...actual, bootstrapMobileGateway };
  });
  vi.doMock('../../mobile/MobileApp', () => ({
    MobileApp: () => {
      throw new Error('mobile renderer exploded');
    },
  }));

  await act(async () => {
    await import('../../mobile/main');
    await Promise.resolve();
  });

  expect(
    screen.getByRole('heading', { name: 'Aplikasi tidak dapat ditampilkan' }),
  ).toBeInTheDocument();
  const initialErrorCount = consoleError.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  await waitFor(() => expect(bootstrapMobileGateway).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(consoleError.mock.calls.length).toBeGreaterThan(initialErrorCount),
  );
});
