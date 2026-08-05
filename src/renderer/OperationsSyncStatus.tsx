import { useEffect, useState } from 'react';

import type { OperationsGateway } from '../gateway/operations-gateway';
import type { SyncSnapshot } from '../gateway/operations-gateway-contract';
import { presentSyncStatus } from '../gateway/sync-presentation';

export function OperationsSyncStatus({
  gateway,
}: {
  gateway: OperationsGateway;
}) {
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(() =>
    gateway.getSyncSnapshot(),
  );
  const conflicts = gateway.getConflicts();
  const blockedOperations = gateway.getBlockedOperations();
  const presentation = presentSyncStatus(snapshot.phase);

  useEffect(() => {
    setSnapshot(gateway.getSyncSnapshot());
    return gateway.subscribeSync(() => setSnapshot(gateway.getSyncSnapshot()));
  }, [gateway]);

  return (
    <div className={`sync-status sync-status--${snapshot.phase}`}>
      <span>{presentation.label}</span>
      {snapshot.pendingCount > 0 && (
        <small>{snapshot.pendingCount} menunggu</small>
      )}
      {(snapshot.quarantinedCount ?? 0) > 0 && (
        <small>{snapshot.quarantinedCount} dikarantina</small>
      )}
      {(presentation.message ?? snapshot.message) && (
        <small>{presentation.message ?? snapshot.message}</small>
      )}
      {snapshot.imagePrefetch && (
        <small>{`Gambar ${snapshot.imagePrefetch.cached}/${snapshot.imagePrefetch.serverAvailable} tersimpan · ${snapshot.imagePrefetch.failed} gagal · ${snapshot.imagePrefetch.total} SKU`}</small>
      )}
      {snapshot.imagePrefetch?.phase === 'running' && (
        <button onClick={() => gateway.pauseImagePrefetch()}>Jeda gambar</button>
      )}
      {snapshot.imagePrefetch && (snapshot.imagePrefetch.failed > 0 || snapshot.imagePrefetch.phase === 'paused') && (
        <button onClick={() => gateway.retryImagePrefetch()}>Coba lagi gambar</button>
      )}
      {snapshot.phase === 'offline' && (
        <button onClick={() => void gateway.retryPending()}>Coba lagi</button>
      )}
      {blockedOperations.map((operation) => (
        <section key={operation.id} aria-label="Perubahan ditolak CH Core">
          <p>{`${operation.kind} ditolak: ${operation.errorCode}`}</p>
          <button
            onClick={() => void gateway.retryBlockedOperation(operation.id)}
          >
            {`Coba lagi perubahan ${operation.kind}`}
          </button>
          <button
            onClick={() => {
              if (
                window.confirm(
                  `Buang perubahan ${operation.kind} yang ditolak CH Core? Tindakan ini tidak dapat dibatalkan.`,
                )
              ) {
                void gateway.discardBlockedOperation(operation.id);
              }
            }}
          >
            {`Buang perubahan ${operation.kind}`}
          </button>
        </section>
      ))}
      {snapshot.phase === 'conflict' && conflicts.map((conflict) => (
        <section key={conflict.id} aria-label="Detail konflik data">
          <p>Dasar: {displayConflictValue(conflict.base)}</p>
          <p>Saya: {displayConflictValue(conflict.mine)}</p>
          <p>Server: {displayConflictValue(conflict.server)}</p>
          <button onClick={() => void gateway.resolveConflict(conflict.id, 'mine')}>
            Versi saya
          </button>
          <button onClick={() => void gateway.resolveConflict(conflict.id, 'server')}>
            Versi server
          </button>
        </section>
      ))}
    </div>
  );
}

function displayConflictValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
