import { describe, expect, it } from 'vitest';

import {
  presentCoreBlockingState,
  presentSyncStatus,
} from '../../src/gateway/sync-presentation';
import type { SyncPhase } from '../../src/gateway/operations-gateway-contract';

describe('sync presentation', () => {
  it.each<readonly [SyncPhase, string]>([
    ['demo', 'Demo lokal'],
    ['unpaired', 'Tidak terhubung'],
    ['connecting', 'Menghubungkan'],
    ['online', 'Tersinkronisasi'],
    ['offline', 'Offline'],
    ['syncing', 'Menyinkronkan'],
    ['conflict', 'Konflik perlu diselesaikan'],
    ['revoked', 'Akses perangkat dicabut'],
    ['upgrade-required', 'Perlu pembaruan'],
  ])('presents %s truthfully', (phase, label) => {
    const presentation = presentSyncStatus(phase);

    expect(presentation.label).toBe(label);
    expect(presentation.label.includes('Tersinkronisasi')).toBe(
      phase === 'online',
    );
  });

  it('uses the compatibility message only for an upgrade-required Core', () => {
    expect(presentSyncStatus('upgrade-required').message).toBe(
      'Versi CH Core tidak kompatibel. Perbarui CH Core, lalu coba hubungkan kembali.',
    );
    expect(presentSyncStatus('offline').message).toBeUndefined();
  });

  it('presents revoked access before the generic untrusted bootstrap state', () => {
    expect(presentCoreBlockingState({
      phase: 'revoked',
      trustedV2Bootstrap: false,
    })).toEqual({
      label: 'Akses perangkat dicabut',
      message:
        'Akses perangkat dicabut. Minta pemilik menyetujui perangkat ini kembali.',
    });
  });
});
