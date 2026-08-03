import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChCoreBridge } from '../../src/electron/core-bridge-contract';
import { OwnerPairingCard } from '../../src/renderer/components/OwnerPairingCard';

const pairingId = '33333333-3333-4333-8333-333333333333';
const expiresAt = '2026-08-03T04:10:00.000Z';

type OwnerBridge = Pick<
  ChCoreBridge,
  'createOwnerPairing' | 'getOwnerPairing' | 'approveOwnerPairing'
>;

function bridge(overrides: Partial<OwnerBridge> = {}): OwnerBridge {
  return {
    createOwnerPairing: vi.fn().mockResolvedValue({
      pairingId,
      code: '12345678',
      expiresAt,
    }),
    getOwnerPairing: vi.fn().mockResolvedValue({
      pairingId,
      state: 'pending',
      expiresAt,
      requestedDevice: { displayName: 'HP Gudang', platform: 'android' },
    }),
    approveOwnerPairing: vi.fn().mockResolvedValue({ status: 'approved' }),
    ...overrides,
  };
}

afterEach(cleanup);

describe('Windows owner pairing card', () => {
  it('generates, verifies, and explicitly approves the claimed device', async () => {
    const owner = bridge();
    render(<OwnerPairingCard bridge={owner} />);

    expect(
      screen.queryByRole('button', { name: 'Setujui perangkat' }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Buat kode pemasangan' }),
    );
    expect(await screen.findByText('12345678')).toBeVisible();
    expect(
      within(screen.getByLabelText('Kode pemasangan aktif')).getByText(
        /10 menit/,
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Setujui perangkat' }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Periksa permintaan' }),
    );
    expect(await screen.findByText('HP Gudang')).toBeVisible();
    expect(screen.getByText('android')).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Setujui perangkat' }),
    );

    expect(
      await screen.findByText(/Periksa persetujuan/),
    ).toBeVisible();
    expect(owner.getOwnerPairing).toHaveBeenCalledWith(pairingId);
    expect(owner.approveOwnerPairing).toHaveBeenCalledWith(pairingId);
  });

  it('does not offer approval until a device has claimed the code', async () => {
    const owner = bridge({
      getOwnerPairing: vi.fn().mockResolvedValue({
        pairingId,
        state: 'available',
        expiresAt,
      }),
    });
    render(<OwnerPairingCard bridge={owner} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Buat kode pemasangan' }),
    );
    await screen.findByText('12345678');
    fireEvent.click(
      screen.getByRole('button', { name: 'Periksa permintaan' }),
    );

    expect(
      await screen.findByText('Belum ada perangkat yang memakai kode ini.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Setujui perangkat' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['expired', 'Kode pemasangan sudah kedaluwarsa.'],
    ['consumed', 'Pemasangan dengan kode ini sudah selesai.'],
  ] as const)('offers a new code after the %s state', async (state, copy) => {
    const owner = bridge({
      getOwnerPairing: vi.fn().mockResolvedValue({
        pairingId,
        state,
        expiresAt,
      }),
    });
    render(<OwnerPairingCard bridge={owner} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Buat kode pemasangan' }),
    );
    await screen.findByText('12345678');
    fireEvent.click(
      screen.getByRole('button', { name: 'Periksa permintaan' }),
    );

    expect(await screen.findByText(copy)).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Buat kode baru' }),
    ).toBeEnabled();
  });

  it('shows fixed owner-only copy without exposing a private server error', async () => {
    const privateFailure = 'FORBIDDEN token=private-token';
    const owner = bridge({
      createOwnerPairing: vi.fn().mockRejectedValue(
        new Error(
          `Error invoking remote method 'ch-core:create-owner-pairing': Error: Hanya perangkat pemilik yang dapat mengatur pemasangan. ${privateFailure}`,
        ),
      ),
    });
    render(<OwnerPairingCard bridge={owner} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Buat kode pemasangan' }),
    );

    expect(
      await screen.findByText(
        'Hanya perangkat pemilik yang dapat mengatur pemasangan.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(privateFailure)).not.toBeInTheDocument();
  });

  it('disables the initiating action while a request is pending', () => {
    const createOwnerPairing = vi.fn(
      () => new Promise<never>(() => undefined),
    );
    render(
      <OwnerPairingCard bridge={bridge({ createOwnerPairing })} />,
    );

    const button = screen.getByRole('button', {
      name: 'Buat kode pemasangan',
    });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(createOwnerPairing).toHaveBeenCalledTimes(1);
  });
});
