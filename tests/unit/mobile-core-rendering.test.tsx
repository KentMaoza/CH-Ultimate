import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, test } from 'vitest';

import { MobileApp } from '../../mobile/MobileApp';
import type {
  BarcodeScannerPort,
  LocalNotificationPort,
  RecommendationPdfSharePort,
} from '../../mobile/ports';
import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import {
  MemoryStorage,
  ScriptedTransport,
  TestClock,
  populatedBootstrap,
} from './core-gateway-test-support';

afterEach(cleanup);

const scanner: BarcodeScannerPort = { scan: async () => null };
const notifications: LocalNotificationPort = {
  ensurePermission: async () => 'denied',
  notifyPriceChange: async () => undefined,
  listenForPriceChangeActions: async () => async () => undefined,
};
const share: RecommendationPdfSharePort = {
  sharePdf: async () => undefined,
};

test('renders every Core-backed mobile snapshot consumer without a render loop', async () => {
  const transport = new ScriptedTransport();
  transport.enqueue({ status: 200, body: populatedBootstrap('48') });
  const gateway = createCoreOperationsGateway(
    transport,
    new MemoryStorage(),
    new TestClock(),
  );
  await gateway.initialize();

  render(
    <MobileApp
      coreBacked
      gateway={gateway}
      notifications={notifications}
      scanner={scanner}
      share={share}
    />,
  );

  expect(
    screen.getByRole('heading', { name: 'CHU Companion Mobile' }),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
  expect(
    screen.getByText('CH CORE · NOTA · TERSINKRONISASI'),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Arsip' }));
  expect(screen.getByText('ARSIP CH CORE')).toBeInTheDocument();

  gateway.dispose();
});

test('blocks the mobile business shell after a malformed Core bootstrap', async () => {
  const transport = new ScriptedTransport();
  transport.enqueue({ status: 200, body: { serverRevision: '1', skus: [] } });
  const gateway = createCoreOperationsGateway(
    transport,
    new MemoryStorage(),
    new TestClock(),
  );
  await gateway.initialize();

  render(
    <MobileApp
      coreBacked
      gateway={gateway}
      notifications={notifications}
      scanner={scanner}
      share={share}
    />,
  );

  expect(
    screen.getByText(
      'Versi CH Core tidak kompatibel. Perbarui CH Core, lalu coba hubungkan kembali.',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText('Invalid CH Core bootstrap envelope')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'CHU Companion Mobile' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('active-sku-count')).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Navigasi utama' })).not.toBeInTheDocument();
  gateway.dispose();
});

test('blocks the mobile business shell when the first Core bootstrap cannot reach the network', async () => {
  const transport = new ScriptedTransport();
  transport.enqueue(new Error('wifi down'));
  const gateway = createCoreOperationsGateway(
    transport,
    new MemoryStorage(),
    new TestClock(),
  );
  await gateway.initialize();

  render(
    <MobileApp
      coreBacked
      gateway={gateway}
      notifications={notifications}
      scanner={scanner}
      share={share}
    />,
  );

  expect(
    screen.getByRole('heading', { name: 'Memuat CH Core' }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      'Data CH Core belum siap. Hubungkan ke jaringan CH Core, lalu coba lagi.',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText('wifi down')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'CHU Companion Mobile' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('active-sku-count')).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Navigasi utama' })).not.toBeInTheDocument();
  gateway.dispose();
});
