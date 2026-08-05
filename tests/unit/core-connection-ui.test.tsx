import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ChCoreBridge,
  CoreCredentialStatus,
} from '../../src/electron/core-bridge-contract';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import type { SyncPhase } from '../../src/gateway/operations-gateway-contract';
import { CoreConnectionScreen } from '../../src/renderer/CoreConnectionScreen';
import { OperationsSyncStatus } from '../../src/renderer/OperationsSyncStatus';

afterEach(cleanup);

describe('desktop connection screen', () => {
  it('shows fail-closed setup state and an actionable retry', () => {
    const onRetry = vi.fn();
    const status: CoreCredentialStatus = {
      production: true,
      configuration: 'missing',
      credential: 'unpaired',
      message: 'Konfigurasi CH Core belum tersedia.',
    };

    render(<CoreConnectionScreen status={status} onRetry={onRetry} />);

    expect(
      screen.getByRole('heading', { name: 'Tidak terhubung' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Konfigurasi CH Core belum tersedia.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows pending pairing as connecting without exposing secrets', () => {
    const status: CoreCredentialStatus = {
      production: true,
      configuration: 'ready',
      credential: 'pending',
      pairingId: '33333333-3333-4333-8333-333333333333',
    };

    const { container } = render(
      <CoreConnectionScreen status={status} onRetry={vi.fn()} />,
    );

    expect(
      screen.getByRole('heading', { name: 'Menghubungkan' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('33333333-3333-4333-8333-333333333333'),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain('claimSecret');
    expect(container.textContent).not.toContain('deviceToken');
  });

  it('uses a neutral device name and preserves the safe-storage enrollment error', async () => {
    const safeStorageMessage =
      'Penyimpanan aman tidak tersedia. Perangkat tidak dapat dipasangkan.';
    const bridge = {
      request: vi.fn(),
      installationId: vi.fn(),
      credentialStatus: vi.fn(),
      enrollOwner: vi.fn(),
      claimPairing: vi.fn().mockRejectedValue(
        new Error(
          `Error invoking remote method 'ch-core:claim-pairing': Error: ${safeStorageMessage}`,
        ),
      ),
      completePairing: vi.fn(),
      createOwnerPairing: vi.fn(),
      getOwnerPairing: vi.fn(),
      approveOwnerPairing: vi.fn(),
      rotateToken: vi.fn(),
    } as ChCoreBridge;
    const status: CoreCredentialStatus = {
      production: true,
      configuration: 'ready',
      credential: 'unpaired',
    };

    render(
      <CoreConnectionScreen
        status={status}
        bridge={bridge}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Nama perangkat')).toHaveValue(
      'Perangkat Gudang',
    );
    fireEvent.change(screen.getByLabelText('Kode pemasangan 8 angka'), {
      target: { value: '12345678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pasangkan' }));

    expect(await screen.findByText(safeStorageMessage)).toBeInTheDocument();
    expect(bridge.claimPairing).toHaveBeenCalledWith({
      code: '12345678',
      displayName: 'Perangkat Gudang',
    });
  });

  it('does not echo arbitrary main-process errors into the renderer', async () => {
    const privateFailure = 'server gagal dengan token rahasia-123';
    const bridge = {
      request: vi.fn(),
      installationId: vi.fn(),
      credentialStatus: vi.fn(),
      enrollOwner: vi.fn(),
      claimPairing: vi.fn().mockRejectedValue(new Error(privateFailure)),
      completePairing: vi.fn(),
      createOwnerPairing: vi.fn(),
      getOwnerPairing: vi.fn(),
      approveOwnerPairing: vi.fn(),
      rotateToken: vi.fn(),
    } as ChCoreBridge;

    render(
      <CoreConnectionScreen
        status={{
          production: true,
          configuration: 'ready',
          credential: 'unpaired',
        }}
        bridge={bridge}
        onRetry={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Kode pemasangan 8 angka'), {
      target: { value: '12345678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pasangkan' }));

    expect(
      await screen.findByText('CH Core belum dapat dihubungkan. Coba lagi.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(privateFailure)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('rahasia-123');
  });
});

describe('desktop operations synchronization status', () => {
  const labels: Array<[SyncPhase, string]> = [
    ['connecting', 'Menghubungkan'],
    ['online', 'Tersinkronisasi'],
    ['syncing', 'Menyinkronkan'],
    ['offline', 'Offline'],
    ['conflict', 'Konflik perlu diselesaikan'],
    ['revoked', 'Akses perangkat dicabut'],
    ['upgrade-required', 'Perlu pembaruan'],
  ];

  it.each(labels)('maps %s to %s', (phase, label) => {
    const gateway = new MockOperationsGateway();
    gateway.getSyncSnapshot = () => ({
      phase,
      serverRevision: '7',
      pendingCount: phase === 'syncing' ? 2 : 0,
      conflictCount: phase === 'conflict' ? 1 : 0,
    });

    render(<OperationsSyncStatus gateway={gateway} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('offers retry only for an actionable offline state', () => {
    const gateway = new MockOperationsGateway();
    gateway.getSyncSnapshot = () => ({
      phase: 'offline',
      serverRevision: '7',
      pendingCount: 1,
      conflictCount: 0,
    });
    gateway.retryPending = vi.fn().mockResolvedValue(undefined);

    render(<OperationsSyncStatus gateway={gateway} />);

    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(gateway.retryPending).toHaveBeenCalledTimes(1);
  });

  it('shows pending central effects and quarantined queue counts explicitly', () => {
    const gateway = new MockOperationsGateway();
    gateway.getSyncSnapshot = () => ({
      phase: 'revoked',
      serverRevision: '7',
      pendingCount: 2,
      conflictCount: 0,
      quarantinedCount: 2,
      message: 'Antrean offline tidak akan dikirim sebelum persetujuan ulang.',
    });

    render(<OperationsSyncStatus gateway={gateway} />);

    expect(screen.getByText('2 dikarantina')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Antrean offline tidak akan dikirim sebelum persetujuan ulang.',
      ),
    ).toBeInTheDocument();
  });

  it('shows an ordinary blocked operation with explicit retry and confirmed discard actions', () => {
    const retryBlockedOperation = vi.fn().mockResolvedValue(undefined);
    const discardBlockedOperation = vi.fn().mockResolvedValue(undefined);
    const gateway = Object.assign(new MockOperationsGateway(), {
      getSyncSnapshot: () => ({
        phase: 'online' as const,
        serverRevision: '7',
        pendingCount: 1,
        conflictCount: 0,
        blockedCount: 1,
        message: '1 perubahan ditolak CH Core.',
      }),
      getBlockedOperations: () => [{
        id: '20202020-2020-4020-8020-202020202020',
        kind: 'Nota' as const,
        errorCode: 'INVALID_NOTA',
      }],
      retryBlockedOperation,
      discardBlockedOperation,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<OperationsSyncStatus gateway={gateway} />);

    expect(screen.getByText('Nota ditolak: INVALID_NOTA')).toBeInTheDocument();
    expect(screen.queryByText('Versi saya')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Coba lagi perubahan Nota' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Buang perubahan Nota' }),
    );
    expect(retryBlockedOperation).toHaveBeenCalledWith(
      '20202020-2020-4020-8020-202020202020',
    );
    expect(discardBlockedOperation).toHaveBeenCalledWith(
      '20202020-2020-4020-8020-202020202020',
    );
  });

  it('shows image progress with explicit pause and retry controls', () => {
    const gateway = new MockOperationsGateway();
    gateway.getSyncSnapshot = () => ({
      phase: 'online',
      serverRevision: '7',
      pendingCount: 0,
      conflictCount: 0,
      imagePrefetch: {
        phase: 'running', total: 100, serverAvailable: 80, cached: 40, failed: 2,
      },
    });
    gateway.pauseImagePrefetch = vi.fn();
    gateway.retryImagePrefetch = vi.fn();

    render(<OperationsSyncStatus gateway={gateway} />);

    expect(screen.getByText('Gambar 40/80 tersimpan · 2 gagal · 100 SKU')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Jeda gambar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi gambar' }));
    expect(gateway.pauseImagePrefetch).toHaveBeenCalledOnce();
    expect(gateway.retryImagePrefetch).toHaveBeenCalledOnce();
  });
});
