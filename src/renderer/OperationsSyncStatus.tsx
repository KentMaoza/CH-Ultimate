import { useEffect, useState } from 'react';

import type { OperationsGateway } from '../gateway/operations-gateway';
import type {
  SyncPhase,
  SyncSnapshot,
} from '../gateway/operations-gateway-contract';

const labels: Record<SyncPhase, string> = {
  demo: 'Demo lokal',
  unpaired: 'Tidak terhubung',
  connecting: 'Menghubungkan',
  online: 'Terhubung',
  offline: 'Tidak terhubung',
  syncing: 'Menyinkronkan',
  conflict: 'Konflik data',
  revoked: 'Akses dicabut',
  'upgrade-required': 'Perlu pembaruan',
};

export function OperationsSyncStatus({
  gateway,
}: {
  gateway: OperationsGateway;
}) {
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(() =>
    gateway.getSyncSnapshot(),
  );
  const conflict = gateway.getConflicts()[0];

  useEffect(() => {
    setSnapshot(gateway.getSyncSnapshot());
    return gateway.subscribeSync(() => setSnapshot(gateway.getSyncSnapshot()));
  }, [gateway]);

  return (
    <div className={`sync-status sync-status--${snapshot.phase}`}>
      <span>{labels[snapshot.phase]}</span>
      {snapshot.pendingCount > 0 && (
        <small>{snapshot.pendingCount} menunggu</small>
      )}
      {snapshot.phase === 'offline' && (
        <button onClick={() => void gateway.retryPending()}>Coba lagi</button>
      )}
      {snapshot.phase === 'conflict' && conflict && (
        <section aria-label="Detail konflik data">
          <p>Dasar: {displayConflictValue(conflict.base)}</p>
          <p>Saya: {displayConflictValue(conflict.mine)}</p>
          <p>Server: {displayConflictValue(conflict.server)}</p>
          <button onClick={() => void gateway.resolveConflict(conflict.id, 'mine')}>
            Gunakan perubahan saya
          </button>
          <button onClick={() => void gateway.resolveConflict(conflict.id, 'server')}>
            Gunakan versi server
          </button>
        </section>
      )}
    </div>
  );
}

function displayConflictValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
