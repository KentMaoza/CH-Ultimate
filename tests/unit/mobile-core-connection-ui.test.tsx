import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MobileApp } from '../../mobile/MobileApp';
import { CoreConnectionScreen } from '../../mobile/components/CoreConnectionScreen';
import { OperationsSyncStatus } from '../../mobile/components/OperationsSyncStatus';
import type { MobileCoreBridge } from '../../mobile/core-api-native';
import {
  browserBarcodeScanner,
  browserLocalNotifications,
  browserRecommendationPdfShare,
} from '../../mobile/ports';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import type { SyncPhase } from '../../src/gateway/operations-gateway-contract';

afterEach(cleanup);

function bridge(): MobileCoreBridge {
  return {
    request: vi.fn(),
    credentialStatus: vi.fn(),
    claimPairing: vi.fn().mockResolvedValue({
      status: 'pending',
      pairingId: '33333333-3333-4333-8333-333333333333',
    }),
    completePairing: vi.fn().mockResolvedValue({
      status: 'paired',
      deviceId: '11111111-1111-4111-8111-111111111111',
    }),
    rotateToken: vi.fn(),
  };
}

describe('mobile connection screen', () => {
  it('shows missing native configuration as a full-screen fail-closed state', () => {
    const onRetry = vi.fn();

    render(
      <CoreConnectionScreen
        status={{
          production: true,
          configuration: 'missing',
          credential: 'unpaired',
          message: 'Konfigurasi CH Core Android belum tersedia.',
        }}
        onRetry={onRetry}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Tidak terhubung' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Konfigurasi CH Core Android belum tersedia.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument();
  });

  it('claims pairing through the narrow native bridge without secret inputs', async () => {
    const chCore = bridge();
    const onRetry = vi.fn();

    render(
      <CoreConnectionScreen
        bridge={chCore}
        status={{
          production: true,
          configuration: 'ready',
          credential: 'unpaired',
        }}
        onRetry={onRetry}
      />,
    );

    fireEvent.change(screen.getByLabelText('Kode pemasangan 8 angka'), {
      target: { value: '12345678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pasangkan' }));

    expect(chCore.claimPairing).toHaveBeenCalledWith({
      code: '12345678',
      displayName: 'Perangkat Gudang',
    });
    expect(await screen.findByText('Menghubungkan ke CH Core.')).toBeInTheDocument();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain('deviceToken');
    expect(document.body.textContent).not.toContain('claimSecret');
  });

  it('completes an approved pending pairing without exposing native secrets', async () => {
    const chCore = bridge();

    render(
      <CoreConnectionScreen
        bridge={chCore}
        status={{
          production: true,
          configuration: 'ready',
          credential: 'pending',
          pairingId: '33333333-3333-4333-8333-333333333333',
        }}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Periksa persetujuan' }),
    );

    expect(await screen.findByText('Menghubungkan ke CH Core.')).toBeInTheDocument();
    expect(chCore.completePairing).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain('deviceToken');
    expect(document.body.textContent).not.toContain('claimSecret');
  });
});

describe('mobile synchronization status', () => {
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

  it('keeps the browser path visibly marked as demo', () => {
    render(
      <MobileApp
        gateway={new MockOperationsGateway()}
        notifications={browserLocalNotifications}
        scanner={browserBarcodeScanner}
        share={browserRecommendationPdfShare}
      />,
    );

    expect(screen.getByText('Demo lokal')).toBeInTheDocument();
  });
});
