import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { App } from '../../src/renderer/App';
import { createInitialState } from '../../src/domain/operations';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import {
  MemoryStorage,
  ScriptedTransport,
  TestClock,
  populatedBootstrap,
} from './core-gateway-test-support';

test('desktop keyboard wedge opens a rapid Enter-terminated scan without handling keys from form fields', () => {
  render(<App gateway={new MockOperationsGateway()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cek Stok' }));

  fireEvent.keyDown(document.body, { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
  for (const key of 'BRS') fireEvent.keyDown(document.body, { key, shiftKey: true });
  fireEvent.keyUp(document.body, { key: 'Shift', code: 'ShiftLeft' });
  fireEvent.keyDown(document.body, { key: 'CapsLock', code: 'CapsLock' });
  for (const key of '-108-') fireEvent.keyDown(document.body, { key });
  fireEvent.keyDown(document.body, { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
  for (const key of 'BLK') fireEvent.keyDown(document.body, { key, shiftKey: true });
  fireEvent.keyUp(document.body, { key: 'Shift', code: 'ShiftLeft' });
  fireEvent.keyDown(document.body, { key: 'Enter' });
  expect(screen.getByRole('heading', { name: 'Beras Hitam Premium 1 kg' })).toBeInTheDocument();

  const count = screen.getByRole('spinbutton', { name: 'Jumlah hasil hitung (PCS)' });
  count.focus();
  for (const key of 'MNM-002') fireEvent.keyDown(count, { key });
  fireEvent.keyDown(count, { key: 'Enter' });
  expect(screen.getByRole('heading', { name: 'Beras Hitam Premium 1 kg' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Minuman Serbuk Cokelat' })).not.toBeInTheDocument();
});

test('desktop keyboard wedge resolves one- and two-character registered identifiers', () => {
  const state = createInitialState();
  state.skus[0]!.identifiers.push({
    id: 'short-one', skuId: state.skus[0]!.id, value: 'X', kind: 'other', createdAt: '',
  });
  state.skus[1]!.identifiers.push({
    id: 'short-two', skuId: state.skus[1]!.id, value: 'Q2', kind: 'other', createdAt: '',
  });
  render(<App gateway={new MockOperationsGateway(() => state)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cek Stok' }));

  fireEvent.keyDown(document.body, { key: 'X' });
  fireEvent.keyDown(document.body, { key: 'Enter' });
  expect(screen.getByRole('heading', { name: state.skus[0]!.name })).toBeInTheDocument();

  for (const key of 'Q2') fireEvent.keyDown(document.body, { key });
  fireEvent.keyDown(document.body, { key: 'Enter' });
  expect(screen.getByRole('heading', { name: state.skus[1]!.name })).toBeInTheDocument();
});

test('only an owner desktop sees package-barcode removal and reassignment controls', async () => {
  const seed = () => {
    const state = createInitialState();
    const source = state.skus[0]!;
    return {
      ...state,
      skus: state.skus.map((sku) => sku.id === source.id ? {
        ...sku,
        identifiers: [{
          id: 'package-1', skuId: source.id, value: '899000010', kind: 'package_barcode' as const, createdAt: '',
        }],
        aliases: ['899000010'],
      } : sku),
    };
  };
  const clientGateway = new MockOperationsGateway(seed);
  const { unmount } = render(<App gateway={clientGateway} coreBacked />);
  fireEvent.click(screen.getByRole('button', { name: 'Cek Stok' }));
  expect(screen.queryByRole('region', { name: 'Kelola barcode kemasan' })).not.toBeInTheDocument();
  unmount();

  const ownerGateway = new MockOperationsGateway(seed);
  ownerGateway.capabilities.canManagePackageBarcodes = true;
  const reassign = vi.spyOn(ownerGateway, 'reassignPackageBarcode');
  const remove = vi.spyOn(ownerGateway, 'removePackageBarcode');
  render(<App gateway={ownerGateway} coreBacked />);
  fireEvent.click(screen.getByRole('button', { name: 'Cek Stok' }));
  const management = screen.getByRole('region', { name: 'Kelola barcode kemasan' });
  const row = within(management).getByRole('group', { name: 'Barcode 899000010' });
  fireEvent.change(within(row).getByRole('combobox', { name: 'Pindahkan 899000010 ke SKU' }), {
    target: { value: 'sku-4' },
  });
  fireEvent.click(within(row).getByRole('button', { name: 'Tinjau pindah 899000010' }));
  fireEvent.click(within(row).getByRole('button', { name: 'Konfirmasi pindahkan 899000010' }));
  await waitFor(() => expect(reassign).toHaveBeenCalledWith('package-1', 'sku-4'));

  const movedRow = within(management).getByRole('group', { name: 'Barcode 899000010' });
  fireEvent.click(within(movedRow).getByRole('button', { name: 'Hapus 899000010' }));
  fireEvent.click(within(movedRow).getByRole('button', { name: 'Konfirmasi hapus 899000010' }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith('package-1'));
});

test('owner package-barcode controls disappear immediately after authentication revocation', async () => {
  const transport = new ScriptedTransport();
  transport.enqueue({ status: 200, body: populatedBootstrap('1') });
  const gateway = createCoreOperationsGateway(
    transport,
    new MemoryStorage(),
    new TestClock(),
  );
  await act(async () => gateway.initialize());
  render(<App gateway={gateway} coreBacked />);
  fireEvent.click(screen.getByRole('button', { name: 'Cek Stok' }));
  expect(screen.getByRole('region', { name: 'Kelola barcode kemasan' })).toBeInTheDocument();

  transport.enqueue({ status: 401, body: { code: 'UNAUTHORIZED' } });
  await act(async () => gateway.retryPending());

  expect(gateway.getSyncSnapshot().phase).toBe('revoked');
  expect(screen.queryByRole('region', { name: 'Kelola barcode kemasan' })).not.toBeInTheDocument();
});
