import type {
  SyncPhase,
  SyncSnapshot,
} from './operations-gateway-contract';

export const CORE_UPGRADE_REQUIRED_MESSAGE =
  'Versi CH Core tidak kompatibel. Perbarui CH Core, lalu coba hubungkan kembali.';
export const CORE_BOOTSTRAP_REQUIRED_MESSAGE =
  'Data CH Core belum siap. Hubungkan ke jaringan CH Core, lalu coba lagi.';

export interface SyncPresentation {
  label: string;
  message?: string;
}

const labels: Record<SyncPhase, string> = {
  demo: 'Demo lokal',
  unpaired: 'Tidak terhubung',
  connecting: 'Menghubungkan',
  online: 'Tersinkronisasi',
  offline: 'Offline',
  syncing: 'Menyinkronkan',
  conflict: 'Konflik perlu diselesaikan',
  revoked: 'Akses perangkat dicabut',
  'upgrade-required': 'Perlu pembaruan',
};

export function presentSyncStatus(phase: SyncPhase): SyncPresentation {
  return {
    label: labels[phase],
    message:
      phase === 'upgrade-required' ? CORE_UPGRADE_REQUIRED_MESSAGE : undefined,
  };
}

export function presentCoreBlockingState(
  sync: Pick<SyncSnapshot, 'phase' | 'trustedV2Bootstrap'>,
): SyncPresentation | undefined {
  if (sync.phase === 'upgrade-required') {
    return presentSyncStatus(sync.phase);
  }
  if (!sync.trustedV2Bootstrap) {
    return {
      label: 'Memuat CH Core',
      message: CORE_BOOTSTRAP_REQUIRED_MESSAGE,
    };
  }
  return undefined;
}
