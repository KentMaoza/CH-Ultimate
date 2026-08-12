import { useMemo, useState } from 'react';

import {
  buildOperationalPdfPlan,
  createOperationalPdfBlob,
  type OperationalDataset,
  type OperationalFilters,
} from '../../src/domain/operational-exports';
import type { OperationsGateway } from '../../src/gateway/operations-gateway';
import {
  createOperationalPdfThumbnail,
  hydrateOperationalPdfImages,
} from '../../src/renderer/operational-pdf-images';
import { useOperationsSnapshot } from '../../src/renderer/use-operations-snapshot';
import type { PdfSharePort } from '../ports';
import { BackIcon, ShareIcon } from './Icons';

function witaToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function OperationalExportView({ gateway, share, coreBacked = false, syncLabel, onBack }: {
  gateway: OperationsGateway;
  share: PdfSharePort;
  coreBacked?: boolean;
  syncLabel?: string;
  onBack: () => void;
}) {
  const snapshot = useOperationsSnapshot(gateway);
  const [dataset, setDataset] = useState<OperationalDataset>('sku-stock');
  const [filters, setFilters] = useState<OperationalFilters>({ query: '', from: '', to: '', status: 'active' });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const plan = useMemo(
    () => buildOperationalPdfPlan(snapshot, dataset, filters, witaToday()),
    [dataset, filters, snapshot],
  );

  function update<Key extends keyof OperationalFilters>(key: Key, value: OperationalFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setStatus('');
  }

  async function sharePdf() {
    setBusy(true);
    setStatus(plan.dataset === 'sku-stock'
      ? `Memproses gambar 0/${plan.rows.length}…`
      : 'Membuat PDF…');
    try {
      const hydrated = await hydrateOperationalPdfImages(plan, snapshot.skus, gateway, {
        thumbnail: createOperationalPdfThumbnail,
        onProgress: (completed, total) => {
          setStatus(`Memproses gambar ${completed}/${total}…`);
        },
      });
      await share.sharePdf({
        blob: await createOperationalPdfBlob(hydrated),
        fileName: plan.fileName,
        title: 'Ekspor Data CHU',
        shareText: coreBacked ? `CH Core · Data · ${syncLabel ?? 'Tidak terhubung'}` : 'DATA DEMO · SESSION ONLY',
      });
      setStatus('PDF data operasional siap dibagikan.');
    } catch {
      setStatus('PDF data operasional belum dapat dibagikan.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="page-view mobile-operational-export">
    <button className="back-button" onClick={onBack}><BackIcon />Kembali</button>
    <h1 data-page-heading tabIndex={-1}>Ekspor Data</h1>
    <p>Pilih satu dataset untuk PDF. Filter tanggal dihitung inklusif dalam WITA.</p>
    <div className="mobile-operational-filters">
      <label><span>Dataset</span><select aria-label="Dataset PDF mobile" value={dataset} onChange={(event) => setDataset(event.target.value as OperationalDataset)}><option value="sku-stock">SKU dan Stok Saat Ini</option><option value="stock-history">Riwayat Stok</option><option value="price-history">Riwayat Harga</option><option value="stock-checks">Cek Stok</option></select></label>
      <label><span>Cari</span><input aria-label="Cari data operasional mobile" value={filters.query} onChange={(event) => update('query', event.target.value)} /></label>
      <div><label><span>Dari WITA</span><input aria-label="Dari tanggal data operasional mobile" type="date" value={filters.from} onChange={(event) => update('from', event.target.value)} /></label><label><span>Sampai WITA</span><input aria-label="Sampai tanggal data operasional mobile" type="date" value={filters.to} onChange={(event) => update('to', event.target.value)} /></label></div>
      <label><span>Status SKU</span><select aria-label="Status SKU data operasional mobile" value={filters.status} onChange={(event) => update('status', event.target.value as OperationalFilters['status'])}><option value="active">Aktif</option><option value="archived">Diarsipkan</option><option value="all">Semua</option></select></label>
    </div>
    <div className="share-summary"><span>PDF DATA</span><strong>{plan.totalMatched} cocok · {plan.totalIncluded} masuk PDF</strong><small>Maksimum 300 baris dengan urutan deterministik.</small></div>
    <button className="primary-action" aria-label="Bagikan PDF data operasional" disabled={busy || plan.totalIncluded === 0} onClick={() => void sharePdf()}><ShareIcon />{busy ? 'Membuat PDF…' : 'Bagikan PDF'}</button>
    {status ? <p className="action-status" role="status">{status}</p> : null}
  </section>;
}
