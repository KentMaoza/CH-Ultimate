import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CoreCredentialStatus } from '../../src/electron/core-bridge-contract';
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
});

describe('desktop operations synchronization status', () => {
  const labels: Array<[SyncPhase, string]> = [
    ['connecting', 'Menghubungkan'],
    ['online', 'Terhubung'],
    ['syncing', 'Menyinkronkan'],
    ['offline', 'Tidak terhubung'],
    ['conflict', 'Konflik data'],
    ['revoked', 'Akses dicabut'],
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
});
