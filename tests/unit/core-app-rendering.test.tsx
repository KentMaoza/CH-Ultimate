import { act, fireEvent, render, screen } from '@testing-library/react';

import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import { App } from '../../src/renderer/App';
import {
  MemoryStorage,
  ScriptedTransport,
  TestClock,
  populatedBootstrap,
} from './core-gateway-test-support';

test('renders editable Nota fields after a valid v2 bootstrap with stockChecks', async () => {
  const transport = new ScriptedTransport();
  const bootstrap = populatedBootstrap('1');
  bootstrap.skus = bootstrap.skus.map((sku) => ({
    ...sku,
    imageHash: null,
    sourceImageUrl: null,
  }));
  transport.enqueue({ status: 200, body: bootstrap });
  const gateway = createCoreOperationsGateway(
    transport,
    new MemoryStorage(),
    new TestClock(),
  );

  await gateway.initialize();
  await act(async () => {
    render(<App gateway={gateway} coreBacked />);
    await Promise.resolve();
  });

  expect(
    screen.getByRole('heading', { name: 'SKU Gudang' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Tersinkronisasi')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
  expect(screen.getByLabelText('Nama barang baris 1')).not.toBeDisabled();
  expect(screen.getByLabelText('Jenis baris 1')).not.toBeDisabled();
  expect(screen.getByRole('button', { name: 'PCS baris 1' })).not.toBeDisabled();
  expect(screen.getByRole('button', { name: 'LSN baris 1' })).not.toBeDisabled();
  gateway.dispose();
});

test('blocks the desktop business shell after a malformed Core bootstrap', async () => {
  const transport = new ScriptedTransport();
  transport.enqueue({ status: 200, body: { serverRevision: '1', skus: [] } });
  const gateway = createCoreOperationsGateway(
    transport,
    new MemoryStorage(),
    new TestClock(),
  );

  await gateway.initialize();
  render(<App gateway={gateway} coreBacked />);

  expect(
    screen.getByText(
      'Versi CH Core tidak kompatibel. Perbarui CH Core, lalu coba hubungkan kembali.',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText('Invalid CH Core bootstrap envelope')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'SKU Gudang' })).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Modul CH Ultimate' })).not.toBeInTheDocument();
  gateway.dispose();
});

test('blocks the desktop business shell when the first Core bootstrap cannot reach the network', async () => {
  const transport = new ScriptedTransport();
  transport.enqueue(new Error('wifi down'));
  const gateway = createCoreOperationsGateway(
    transport,
    new MemoryStorage(),
    new TestClock(),
  );

  await gateway.initialize();
  render(<App gateway={gateway} coreBacked />);

  expect(
    screen.getByRole('heading', { name: 'Memuat CH Core' }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      'Data CH Core belum siap. Hubungkan ke jaringan CH Core, lalu coba lagi.',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText('wifi down')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'SKU Gudang' })).not.toBeInTheDocument();
  expect(screen.queryByText(/0 SKU aktif/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Modul CH Ultimate' })).not.toBeInTheDocument();
  gateway.dispose();
});
