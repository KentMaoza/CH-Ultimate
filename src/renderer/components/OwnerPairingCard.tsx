import { useState } from 'react';

import {
  CORE_OWNER_ACCESS_REQUIRED_MESSAGE,
  type ChCoreBridge,
} from '../../electron/core-bridge-contract';
import type {
  OwnerPairing,
  OwnerPairingStatus,
} from '../../electron/core-owner-pairing-main';

type OwnerPairingBridge = Pick<
  ChCoreBridge,
  'createOwnerPairing' | 'getOwnerPairing' | 'approveOwnerPairing'
>;

export interface OwnerPairingCardProps {
  bridge: OwnerPairingBridge;
}

const genericFailure = 'Pemasangan belum dapat diproses. Coba lagi.';

function publicError(caught: unknown): string {
  if (
    caught instanceof Error &&
    caught.message.includes(CORE_OWNER_ACCESS_REQUIRED_MESSAGE)
  ) {
    return CORE_OWNER_ACCESS_REQUIRED_MESSAGE;
  }
  return genericFailure;
}

function formatExpiry(value: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Makassar',
  }).format(new Date(value));
}

function statusCopy(status: OwnerPairingStatus): string {
  switch (status.state) {
    case 'available':
      return 'Belum ada perangkat yang memakai kode ini.';
    case 'pending':
      return 'Pastikan nama dan platform sesuai dengan perangkat di depan Anda.';
    case 'approved':
      return 'Perangkat disetujui. Minta perangkat memilih Periksa persetujuan.';
    case 'consumed':
      return 'Pemasangan dengan kode ini sudah selesai.';
    case 'expired':
      return 'Kode pemasangan sudah kedaluwarsa.';
  }
}

export function OwnerPairingCard({ bridge }: OwnerPairingCardProps) {
  const [pairing, setPairing] = useState<OwnerPairing>();
  const [status, setStatus] = useState<OwnerPairingStatus>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await operation();
    } catch (caught) {
      setMessage(publicError(caught));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const created = await bridge.createOwnerPairing();
      setPairing(created);
      setStatus(undefined);
      setMessage('Kode berlaku 10 menit dan hanya dapat digunakan satu kali.');
    });

  const inspect = () => {
    if (!pairing) return;
    void run(async () => {
      const inspected = await bridge.getOwnerPairing(pairing.pairingId);
      setStatus(inspected);
      setMessage(statusCopy(inspected));
    });
  };

  const approve = () => {
    if (
      !pairing ||
      status?.state !== 'pending' ||
      !status.requestedDevice
    ) {
      return;
    }
    void run(async () => {
      await bridge.approveOwnerPairing(pairing.pairingId);
      const approved: OwnerPairingStatus = {
        ...status,
        state: 'approved',
      };
      setStatus(approved);
      setMessage(statusCopy(approved));
    });
  };

  const terminal = status?.state === 'expired' || status?.state === 'consumed';

  return (
    <section className="settings-card owner-pairing-card">
      <span>PEMASANGAN PERANGKAT</span>
      <h2>Hubungkan perangkat baru</h2>
      <p>
        Buat kode sementara, periksa nama perangkat yang memakainya, lalu
        setujui secara manual.
      </p>

      {pairing && !terminal ? (
        <div className="owner-pairing-code" aria-label="Kode pemasangan aktif">
          <small>KODE PEMASANGAN</small>
          <strong>{pairing.code}</strong>
          <span>Berlaku 10 menit · berakhir {formatExpiry(pairing.expiresAt)} WITA</span>
        </div>
      ) : null}

      {status?.requestedDevice ? (
        <dl className="owner-pairing-device">
          <div>
            <dt>Nama perangkat</dt>
            <dd>{status.requestedDevice.displayName}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>{status.requestedDevice.platform}</dd>
          </div>
        </dl>
      ) : null}

      {message ? <p className="notice" role="status">{message}</p> : null}

      <div className="owner-pairing-actions">
        {!pairing || terminal ? (
          <button className="button primary" disabled={busy} onClick={() => void create()}>
            {pairing ? 'Buat kode baru' : 'Buat kode pemasangan'}
          </button>
        ) : (
          <button className="button secondary" disabled={busy} onClick={inspect}>
            Periksa permintaan
          </button>
        )}
        {status?.state === 'pending' && status.requestedDevice ? (
          <button className="button primary" disabled={busy} onClick={approve}>
            Setujui perangkat
          </button>
        ) : null}
        {status?.state === 'approved' ? (
          <button className="button secondary" disabled={busy} onClick={() => void create()}>
            Buat kode baru
          </button>
        ) : null}
      </div>
    </section>
  );
}
