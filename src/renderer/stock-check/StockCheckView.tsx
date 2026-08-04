import { useEffect, useMemo, useRef, useState } from 'react';

import type { OperationsGateway } from '../../gateway/operations-gateway';
import type { Sku } from '../../domain/types';
import {
  formatStockCheckWita,
  resolveSkuByIdentifier,
  selectStockCheckSkus,
} from '../../domain/stock-checks';
import {
  useOperationsSnapshot,
  useOperationsSyncSnapshot,
} from '../use-operations-snapshot';
import './stock-check.css';

interface Review {
  observed: number;
  counted: number;
  note: string;
}

interface Registration {
  code: string;
  stage: 'target' | 'confirm';
  targetSkuId: string;
  repeatedCode: string;
}

interface ManagementAction {
  kind: 'remove' | 'reassign';
  identifierId: string;
  targetSkuId?: string;
}

export function StockCheckView({
  gateway,
  mode,
  onCameraScan,
}: {
  gateway: OperationsGateway;
  mode: 'desktop' | 'mobile';
  onCameraScan?: () => Promise<string | null>;
}) {
  const snapshot = useOperationsSnapshot(gateway);
  const sync = useOperationsSyncSnapshot(gateway);
  const rows = useMemo(
    () => selectStockCheckSkus(snapshot.skus, snapshot.stockChecks),
    [snapshot.skus, snapshot.stockChecks],
  );
  const activeSkus = useMemo(() => rows.map(({ sku }) => sku), [rows]);
  const [selectedSkuId, setSelectedSkuId] = useState('');
  const [observedStock, setObservedStock] = useState(0);
  const [countedValue, setCountedValue] = useState('');
  const [note, setNote] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [managementTargets, setManagementTargets] = useState<Record<string, string>>({});
  const [managementAction, setManagementAction] = useState<ManagementAction | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'alert' | 'status'; text: string } | null>(null);
  const [staleRefreshRequired, setStaleRefreshRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const selectedSku = activeSkus.find((sku) => sku.id === selectedSkuId) ?? null;
  const audits = snapshot.stockChecks
    .filter((check) => check.skuId === selectedSkuId)
    .sort((left, right) => Date.parse(right.appliedAt) - Date.parse(left.appliedAt));
  const registrationOnline = ['demo', 'online', 'syncing', 'conflict'].includes(sync.phase);
  const packageIdentifiers = activeSkus.flatMap((sku) => sku.identifiers
    .filter((identifier) => identifier.kind === 'package_barcode')
    .map((identifier) => ({ identifier, sku })));
  const canManagePackages = mode === 'desktop' && gateway.capabilities.canManagePackageBarcodes;
  const resolveCodeRef = useRef<(code: string) => void>(() => undefined);

  function selectSku(sku: Sku) {
    setSelectedSkuId(sku.id);
    setObservedStock(sku.stock);
    setCountedValue(String(sku.stock));
    setNote('');
    setReview(null);
    setRegistration(null);
    setStaleRefreshRequired(false);
    setFeedback(null);
  }

  function resolveCode(rawCode: string) {
    const code = rawCode.trim();
    const sku = resolveSkuByIdentifier(activeSkus, code);
    if (sku) {
      selectSku(sku);
      return;
    }
    if (!code) {
      setFeedback({ kind: 'alert', text: 'Masukkan kode SKU atau barcode.' });
      return;
    }
    if (!registrationOnline) {
      setRegistration(null);
      setFeedback({
        kind: 'alert',
        text: 'Kode tidak ditemukan. Barcode baru hanya dapat didaftarkan saat terhubung ke CH Core.',
      });
      return;
    }
    setRegistration({ code, stage: 'target', targetSkuId: '', repeatedCode: '' });
    setFeedback({ kind: 'alert', text: `Kode tidak ditemukan: ${code}. Periksa kode atau daftarkan sebagai barcode kemasan.` });
  }
  resolveCodeRef.current = resolveCode;

  useEffect(() => {
    if (mode !== 'desktop') return;
    let buffer = '';
    let lastKeyAt = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.matches('input, textarea, select, button') || target.isContentEditable
      )) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Enter') {
        const code = buffer.trim();
        buffer = '';
        lastKeyAt = 0;
        if (code) {
          setManualCode(code);
          resolveCodeRef.current(code);
          event.preventDefault();
        }
        return;
      }
      if (event.key.length !== 1) return;
      if (lastKeyAt && event.timeStamp - lastKeyAt > 80) buffer = '';
      buffer += event.key;
      lastKeyAt = event.timeStamp;
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mode]);

  async function scanWithCamera() {
    if (!onCameraScan) return;
    setBusy(true);
    setFeedback(null);
    try {
      const code = await onCameraScan();
      if (code) {
        setManualCode(code);
        resolveCode(code);
      } else {
        setFeedback({ kind: 'alert', text: 'Scan dibatalkan. Masukkan kode secara manual.' });
      }
    } catch {
      setFeedback({ kind: 'alert', text: 'Kamera tidak tersedia. Masukkan kode secara manual.' });
    } finally {
      setBusy(false);
    }
  }

  function prepareReview() {
    if (staleRefreshRequired) {
      setFeedback({
        kind: 'alert',
        text: 'Stok terbaru belum dapat dimuat. Coba muat ulang sebelum mengonfirmasi.',
      });
      return;
    }
    if (!countedValue.trim()) {
      setFeedback({ kind: 'alert', text: 'Jumlah hasil hitung wajib diisi.' });
      return;
    }
    const counted = Number(countedValue);
    if (!Number.isSafeInteger(counted)) {
      setFeedback({ kind: 'alert', text: 'Hasil hitung wajib berupa bilangan bulat aman.' });
      return;
    }
    const trimmedNote = note.trim();
    if (trimmedNote.length > 512) {
      setFeedback({ kind: 'alert', text: 'Catatan cek stok maksimal 512 karakter.' });
      return;
    }
    setReview({ observed: observedStock, counted, note: trimmedNote });
    setFeedback(null);
  }

  async function refreshStaleStock(skuId: string): Promise<void> {
    try {
      await gateway.retryPending();
      const refreshedSync = gateway.getSyncSnapshot();
      const refreshed = gateway.getSnapshot().skus.find((sku) => sku.id === skuId);
      if (refreshedSync.phase !== 'online' || !refreshed || refreshed.archived) {
        throw new Error('authoritative stock unavailable');
      }
      setObservedStock(refreshed.stock);
      setStaleRefreshRequired(false);
      setFeedback({
        kind: 'status',
        text: 'Stok berubah di CH Core. Data terbaru dimuat; tinjau dan konfirmasi ulang.',
      });
    } catch {
      setStaleRefreshRequired(true);
      setFeedback({
        kind: 'alert',
        text: 'Stok terbaru belum dapat dimuat. Hubungkan kembali ke CH Core, lalu coba muat ulang sebelum mengonfirmasi.',
      });
    }
  }

  async function retryStaleRefresh() {
    if (!selectedSku || busy) return;
    setBusy(true);
    try {
      await refreshStaleStock(selectedSku.id);
    } finally {
      setBusy(false);
    }
  }

  async function confirmCount() {
    if (!selectedSku || !review || busy) return;
    const current = gateway.getSnapshot().skus.find((sku) => sku.id === selectedSku.id);
    if (!current || current.archived) {
      setReview(null);
      setFeedback({ kind: 'alert', text: 'SKU sudah tidak aktif. Pilih SKU aktif lain.' });
      return;
    }
    if (current.stock !== review.observed) {
      setObservedStock(current.stock);
      setReview(null);
      setFeedback({ kind: 'alert', text: 'Stok berubah. Tinjau hasil hitung dan konfirmasi ulang.' });
      return;
    }
    setBusy(true);
    try {
      await gateway.checkStock(selectedSku.id, review.counted, review.note || undefined);
      setObservedStock(review.counted);
      setCountedValue(String(review.counted));
      setReview(null);
      setFeedback({
        kind: 'status',
        text: sync.phase === 'offline'
          ? 'Cek stok disimpan di antrean offline. Audit akan ditandai dipaksa offline setelah tersambung.'
          : 'Cek stok tersimpan.',
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('STOCK_CHECK_STALE')) {
        setReview(null);
        setStaleRefreshRequired(true);
        await refreshStaleStock(selectedSku.id);
      } else {
        setFeedback({
          kind: 'alert',
          text: error instanceof Error ? error.message : 'Cek stok gagal disimpan.',
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmRegistration() {
    if (!registration || registration.stage !== 'confirm' || busy) return;
    if (registration.repeatedCode !== registration.code) return;
    setBusy(true);
    try {
      await gateway.registerPackageBarcode(registration.targetSkuId, registration.code);
      const target = gateway.getSnapshot().skus.find((sku) => sku.id === registration.targetSkuId);
      if (target) selectSku(target);
      setRegistration(null);
      setFeedback({ kind: 'status', text: `Barcode kemasan terdaftar: ${registration.code}.` });
    } catch (error) {
      setFeedback({
        kind: 'alert',
        text: error instanceof Error ? error.message : 'Barcode kemasan gagal didaftarkan.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function applyManagementAction() {
    if (!managementAction || busy) return;
    setBusy(true);
    try {
      if (managementAction.kind === 'remove') {
        await gateway.removePackageBarcode(managementAction.identifierId);
        setFeedback({ kind: 'status', text: 'Barcode kemasan dihapus.' });
      } else if (managementAction.targetSkuId) {
        await gateway.reassignPackageBarcode(
          managementAction.identifierId,
          managementAction.targetSkuId,
        );
        setFeedback({ kind: 'status', text: 'Barcode kemasan dipindahkan ke SKU baru.' });
      }
      setManagementAction(null);
    } catch (error) {
      setFeedback({
        kind: 'alert',
        text: error instanceof Error ? error.message : 'Barcode kemasan gagal dikelola.',
      });
    } finally {
      setBusy(false);
    }
  }

  return <section className={`stock-check stock-check--${mode}`} aria-label="Cek Stok">
    <div className="stock-check__scan">
      <div>
        <strong>SCAN ATAU CARI</strong>
        <span>{mode === 'desktop' ? 'Scanner USB, keyboard wedge, atau kode manual' : 'Kamera atau kode manual'}</span>
      </div>
      {onCameraScan ? <button type="button" disabled={busy} onClick={() => void scanWithCamera()}>Scan dengan kamera</button> : null}
      <form onSubmit={(event) => { event.preventDefault(); resolveCode(manualCode); }}>
        <label htmlFor={`stock-scan-${mode}`}>Kode SKU atau barcode</label>
        <input id={`stock-scan-${mode}`} value={manualCode} onChange={(event) => setManualCode(event.target.value)} autoComplete="off" />
        <button type="submit">Cari kode</button>
      </form>
    </div>

    {feedback ? <p className="stock-check__feedback" role={feedback.kind}>{feedback.text}</p> : null}

    {registration ? <section className="stock-check__registration" aria-label="Pendaftaran barcode kemasan">
      <h2>Daftarkan barcode kemasan</h2>
      <p>Barcode <code>{registration.code}</code> belum dikenal. Pendaftaran ini disimpan ke CH Core.</p>
      {registration.stage === 'target' ? <>
        <label htmlFor={`package-target-${mode}`}>Target SKU barcode kemasan</label>
        <select
          id={`package-target-${mode}`}
          value={registration.targetSkuId}
          onChange={(event) => setRegistration({ ...registration, targetSkuId: event.target.value })}
        >
          <option value="">Pilih SKU aktif</option>
          {activeSkus.map((sku) => <option value={sku.id} key={sku.id}>{sku.skuNumber} · {sku.name}</option>)}
        </select>
        <button
          type="button"
          disabled={!registration.targetSkuId}
          onClick={() => setRegistration({ ...registration, stage: 'confirm' })}
        >Lanjutkan ke konfirmasi kode</button>
      </> : <>
        <p>Target: <strong>{activeSkus.find((sku) => sku.id === registration.targetSkuId)?.skuNumber}</strong></p>
        <label htmlFor={`package-confirm-${mode}`}>Ketik ulang kode barcode persis</label>
        <input
          id={`package-confirm-${mode}`}
          value={registration.repeatedCode}
          onChange={(event) => setRegistration({ ...registration, repeatedCode: event.target.value })}
          autoComplete="off"
        />
        <div className="stock-check__actions">
          <button type="button" onClick={() => setRegistration({ ...registration, stage: 'target', repeatedCode: '' })}>Kembali</button>
          <button
            type="button"
            disabled={busy || registration.repeatedCode !== registration.code}
            onClick={() => void confirmRegistration()}
          >Daftarkan barcode kemasan</button>
        </div>
      </>}
    </section> : null}

    <div className="stock-check__layout">
      <section className="stock-check__list-panel">
        <header><strong>SKU AKTIF</strong><span>{rows.length} SKU</span></header>
        <ul aria-label="Daftar SKU cek stok" className="stock-check__list">
          {rows.map(({ sku, lastCountedAt }) => <li key={sku.id}><button
            type="button"
            aria-label={`Cek stok ${sku.name}`}
            aria-current={selectedSkuId === sku.id ? 'true' : undefined}
            onClick={() => selectSku(sku)}
          >
            <span><strong>{sku.name}</strong><small>{sku.skuNumber}</small></span>
            <span><b>{sku.stock} PCS</b><small>Terakhir cek stok: {lastCountedAt ? formatStockCheckWita(lastCountedAt) : 'Belum pernah'}</small></span>
          </button></li>)}
        </ul>
      </section>

      <section className="stock-check__workspace">
        {!selectedSku ? <div className="stock-check__empty"><strong>Pilih atau scan SKU</strong><p>Hasil hitung akan dikonfirmasi sebelum stok berubah.</p></div> : <>
          <header>
            <span>{selectedSku.skuNumber}</span>
            <h2>{selectedSku.name}</h2>
            <p>Stok teramati: {observedStock} PCS</p>
          </header>
          <div className="stock-check__form">
            <label htmlFor={`counted-${mode}`}>Jumlah hasil hitung (PCS)</label>
            <input
              id={`counted-${mode}`}
              type="number"
              inputMode="numeric"
              step="1"
              value={countedValue}
              onChange={(event) => { setCountedValue(event.target.value); setReview(null); }}
            />
            <label htmlFor={`stock-note-${mode}`}>Catatan cek stok (opsional)</label>
            <textarea
              id={`stock-note-${mode}`}
              maxLength={512}
              value={note}
              onChange={(event) => { setNote(event.target.value); setReview(null); }}
            />
            <small>{note.length}/512 karakter</small>
            <button type="button" disabled={busy || staleRefreshRequired} onClick={prepareReview}>Tinjau cek stok</button>
            {staleRefreshRequired ? <button type="button" disabled={busy} onClick={() => void retryStaleRefresh()}>Coba muat ulang stok</button> : null}
          </div>

          {review ? <section className="stock-check__confirmation" role="region" aria-label={`Konfirmasi cek stok ${selectedSku.name}`}>
            <h3>Konfirmasi cek stok</h3>
            <dl>
              <div><dt>Stok teramati</dt><dd>{review.observed} PCS</dd></div>
              <div><dt>Hasil hitung</dt><dd>{review.counted} PCS</dd></div>
              <div><dt>Selisih</dt><dd>{review.counted - review.observed > 0 ? '+' : ''}{review.counted - review.observed} PCS</dd></div>
            </dl>
            {review.note ? <p>Catatan: {review.note}</p> : null}
            {sync.phase === 'offline' ? <p role="alert" className="stock-check__warning">PERINGATAN: Saat tersambung kembali, hasil hitung ini akan menimpa stok pusat dengan jumlah absolut {review.counted} PCS.</p> : null}
            <div className="stock-check__actions">
              <button type="button" onClick={() => setReview(null)}>Ubah hasil</button>
              <button type="button" disabled={busy} onClick={() => void confirmCount()}>Konfirmasi cek stok</button>
            </div>
          </section> : null}

          <section className="stock-check__audit" aria-label="Riwayat audit cek stok">
            <h3>Riwayat cek stok</h3>
            {!audits.length ? <p>Belum ada audit cek stok.</p> : audits.map((check) => <details role="group" aria-label={`Audit cek stok ${formatStockCheckWita(check.countedAt)}`} key={check.id}>
              <summary>
                <span>{formatStockCheckWita(check.countedAt)} · {check.countedQuantityPcs} PCS</span>
                {check.forcedOffline ? <b>DIPAKSA OFFLINE</b> : null}
              </summary>
              <dl>
                <div><dt>Dihitung fisik</dt><dd>{formatStockCheckWita(check.countedAt)}</dd></div>
                <div><dt>Diterapkan</dt><dd>{formatStockCheckWita(check.appliedAt)}</dd></div>
                <div><dt>Stok teramati</dt><dd>{check.observedQuantityPcs} PCS</dd></div>
                <div><dt>Stok server sebelum diterapkan</dt><dd>{check.serverQuantityBeforePcs} PCS</dd></div>
                <div><dt>Selisih diterapkan</dt><dd>{check.appliedDeltaPcs > 0 ? '+' : ''}{check.appliedDeltaPcs} PCS</dd></div>
                <div><dt>Dipaksa offline</dt><dd>{check.forcedOffline ? 'Ya' : 'Tidak'}</dd></div>
                <div><dt>Perangkat</dt><dd>{check.deviceDisplayName}</dd></div>
                {check.note ? <div><dt>Catatan</dt><dd>{check.note}</dd></div> : null}
              </dl>
            </details>)}
          </section>
        </>}
      </section>
    </div>
    {canManagePackages ? <section className="stock-check__management" role="region" aria-label="Kelola barcode kemasan">
      <header><span>KHUSUS OWNER DESKTOP</span><h2>Kelola barcode kemasan</h2></header>
      {!packageIdentifiers.length ? <p>Belum ada barcode kemasan terdaftar.</p> : packageIdentifiers.map(({ identifier, sku }) => {
        const targetSkuId = managementTargets[identifier.id] ?? '';
        const action = managementAction?.identifierId === identifier.id ? managementAction : null;
        return <div className="stock-check__management-row" role="group" aria-label={`Barcode ${identifier.value}`} key={identifier.id}>
          <div><strong>{identifier.value}</strong><span>{sku.skuNumber} · {sku.name}</span></div>
          <label htmlFor={`manage-${identifier.id}`}>Pindahkan {identifier.value} ke SKU</label>
          <select
            id={`manage-${identifier.id}`}
            value={targetSkuId}
            onChange={(event) => setManagementTargets({ ...managementTargets, [identifier.id]: event.target.value })}
          >
            <option value="">Pilih SKU tujuan</option>
            {activeSkus.filter((candidate) => candidate.id !== sku.id).map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.skuNumber} · {candidate.name}</option>)}
          </select>
          <div className="stock-check__management-actions">
            <button type="button" disabled={!targetSkuId} aria-label={`Tinjau pindah ${identifier.value}`} onClick={() => setManagementAction({ kind: 'reassign', identifierId: identifier.id, targetSkuId })}>Pindahkan</button>
            <button type="button" aria-label={`Hapus ${identifier.value}`} onClick={() => setManagementAction({ kind: 'remove', identifierId: identifier.id })}>Hapus</button>
          </div>
          {action ? <div className="stock-check__management-confirmation">
            <p>{action.kind === 'remove' ? `Hapus barcode ${identifier.value}?` : `Pindahkan barcode ${identifier.value} ke ${activeSkus.find((candidate) => candidate.id === action.targetSkuId)?.skuNumber}?`}</p>
            <button type="button" onClick={() => setManagementAction(null)}>Batal</button>
            <button type="button" disabled={busy} aria-label={`${action.kind === 'remove' ? 'Konfirmasi hapus' : 'Konfirmasi pindahkan'} ${identifier.value}`} onClick={() => void applyManagementAction()}>{action.kind === 'remove' ? 'Konfirmasi hapus' : 'Konfirmasi pindahkan'}</button>
          </div> : null}
        </div>;
      })}
    </section> : null}
  </section>;
}
