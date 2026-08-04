import { useState, type FormEvent } from 'react';

import type {
  MobileCoreBridge,
  MobileCredentialStatus,
} from '../core-api-native';

export interface CoreConnectionScreenProps {
  status: MobileCredentialStatus;
  bridge?: MobileCoreBridge;
  onRetry(): void | Promise<void>;
}

export function CoreConnectionScreen(
  { status, bridge, onRetry }: CoreConnectionScreenProps,
) {
  const [displayName, setDisplayName] = useState('Perangkat Gudang');
  const [pairingCode, setPairingCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const pending =
    status.configuration === 'ready' && status.credential === 'pending';

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setFeedback('');
    try {
      await operation();
      setFeedback('Menghubungkan ke CH Core.');
      await onRetry();
    } catch {
      setFeedback('CH Core belum dapat dihubungkan. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  const claimPairing = (event: FormEvent) => {
    event.preventDefault();
    if (!bridge) return;
    void run(() =>
      bridge.claimPairing({
        code: pairingCode,
        displayName,
      }),
    );
  };

  return (
    <main className="mobile-core-connection">
      <section className="mobile-core-connection__card">
        <div className="mobile-core-connection__mark">CHU</div>
        <span className="mobile-core-connection__eyebrow">
          CH ULTIMATE / CH CORE
        </span>
        <h1>{pending ? 'Menghubungkan' : 'Tidak terhubung'}</h1>
        <p>
          {status.message ??
            (pending
              ? 'Menunggu persetujuan perangkat dari pemilik.'
              : 'Hubungkan perangkat ini ke CH Core untuk membuka data bersama.')}
        </p>
        {status.pairingId && (
          <p className="mobile-core-connection__public-id">
            ID pemasangan <strong>{status.pairingId}</strong>
          </p>
        )}
        {feedback && (
          <p className="mobile-core-connection__feedback">{feedback}</p>
        )}

        {status.configuration === 'ready' &&
          status.credential === 'unpaired' &&
          bridge && (
            <form
              className="mobile-core-connection__form"
              onSubmit={claimPairing}
            >
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
                  inputMode="numeric"
                  maxLength={8}
                  value={pairingCode}
                  onChange={(event) => setPairingCode(event.target.value)}
                />
              </label>
              <button disabled={busy} type="submit">
                Pasangkan
              </button>
            </form>
          )}

        {pending && bridge ? (
          <button
            disabled={busy}
            onClick={() => void run(() => bridge.completePairing())}
          >
            Periksa persetujuan
          </button>
        ) : status.credential !== 'unpaired' || !bridge ? (
          <button disabled={busy} onClick={() => void onRetry()}>
            Coba lagi
          </button>
        ) : null}
      </section>
    </main>
  );
}
