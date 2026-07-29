import { useState, type FormEvent } from 'react';

import type {
  ChCoreBridge,
  CoreCredentialStatus,
} from '../electron/core-bridge-contract';

export interface CoreConnectionScreenProps {
  status: CoreCredentialStatus;
  bridge?: ChCoreBridge;
  onRetry(): void | Promise<void>;
}

export function CoreConnectionScreen({
  status,
  bridge,
  onRetry,
}: CoreConnectionScreenProps) {
  const [displayName, setDisplayName] = useState('Mac Gudang');
  const [pairingCode, setPairingCode] = useState('');
  const [bootstrapSecret, setBootstrapSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending =
    status.configuration === 'ready' && status.credential === 'pending';

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await operation();
      await onRetry();
    } catch {
      setError('CH Core belum dapat dihubungkan. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  const claimPairing = (event: FormEvent) => {
    event.preventDefault();
    if (!bridge) return;
    void run(() =>
      bridge.claimPairing({ code: pairingCode, displayName }),
    );
  };

  const enrollOwner = (event: FormEvent) => {
    event.preventDefault();
    if (!bridge) return;
    void run(() =>
      bridge.enrollOwner({
        mode: 'bootstrap',
        bootstrapSecret,
        displayName,
      }),
    );
  };

  return (
    <main className="core-connection">
      <section className="core-connection__card">
        <div className="brand-mark dark">CHU</div>
        <span className="eyebrow">CH ULTIMATE / CH CORE</span>
        <h1>{pending ? 'Menghubungkan' : 'Tidak terhubung'}</h1>
        <p>
          {status.message ??
            (pending
              ? 'Menunggu persetujuan perangkat dari pemilik.'
              : 'Hubungkan perangkat ini ke CH Core untuk membuka data bersama.')}
        </p>
        {status.pairingId && (
          <p className="core-connection__public-id">
            ID pemasangan <strong>{status.pairingId}</strong>
          </p>
        )}
        {error && <p className="core-connection__error">{error}</p>}

        {status.configuration === 'ready' &&
          status.credential === 'unpaired' &&
          bridge && (
            <div className="core-connection__forms">
              <form onSubmit={claimPairing}>
                <h2>Pasangkan perangkat</h2>
                <label>
                  <span>Nama perangkat</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </label>
                <label>
                  <span>Kode pemasangan 8 angka</span>
                  <input
                    value={pairingCode}
                    inputMode="numeric"
                    maxLength={8}
                    onChange={(event) => setPairingCode(event.target.value)}
                  />
                </label>
                <button className="button primary" disabled={busy} type="submit">
                  Pasangkan
                </button>
              </form>
              <form onSubmit={enrollOwner}>
                <h2>Siapkan pemilik pertama</h2>
                <label>
                  <span>Kode penyiapan pemilik</span>
                  <input
                    type="password"
                    value={bootstrapSecret}
                    onChange={(event) =>
                      setBootstrapSecret(event.target.value)
                    }
                  />
                </label>
                <button className="button secondary" disabled={busy} type="submit">
                  Siapkan pemilik
                </button>
              </form>
            </div>
          )}

        {pending && bridge ? (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void run(() => bridge.completePairing())}
          >
            Periksa persetujuan
          </button>
        ) : (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void onRetry()}
          >
            Coba lagi
          </button>
        )}
      </section>
    </main>
  );
}
