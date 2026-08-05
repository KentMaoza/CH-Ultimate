import type { SyncPhase } from './operations-gateway-contract';

export const CORE_UPGRADE_REQUIRED_MESSAGE =
  'Versi CH Core tidak kompatibel. Perbarui CH Core, lalu coba hubungkan kembali.';

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
