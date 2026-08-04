import { useMemo, useState } from 'react';

import {
  buildOperationalPdfPlan,
  type OperationalDataset,
  type OperationalFilters,
} from '../../domain/operational-exports';
import { hydrateOperationalPdfImages } from '../operational-pdf-images';
import { useOperations } from '../operations-context';
import { useOutput } from '../output-context';

const datasetLabels: Record<OperationalDataset, string> = {
  'sku-stock': 'SKU dan Stok Saat Ini',
  'stock-history': 'Riwayat Stok',
  'price-history': 'Riwayat Harga',
  'stock-checks': 'Cek Stok',
};

function witaToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const initialFilters: OperationalFilters = { query: '', from: '', to: '', status: 'active' };

export function OperationalExportPage() {
  const { state, gateway } = useOperations();
  const output = useOutput();
  const [dataset, setDataset] = useState<OperationalDataset>('sku-stock');
  const [filters, setFilters] = useState<OperationalFilters>(initialFilters);
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | ''>('');
  const [notice, setNotice] = useState('');
  const generatedDate = witaToday();
  const plan = useMemo(
    () => buildOperationalPdfPlan(state, dataset, filters, generatedDate),
    [dataset, filters, generatedDate, state],
  );

  function updateFilter<Key extends keyof OperationalFilters>(key: Key, value: OperationalFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setNotice('');
  }

  async function downloadWorkbook() {
    setBusy('xlsx');
    setNotice('');
    try {
      const { createOperationalWorkbookBuffer } = await import('../../domain/operational-workbook');
      const buffer = await createOperationalWorkbookBuffer(state, filters, generatedDate);
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `CHU-Ekspor-Data-${generatedDate}.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 100);
      setNotice('XLSX seluruh data cocok berhasil dibuat.');
    } catch {
      setNotice('XLSX belum dapat dibuat.');
    } finally {
      setBusy('');
    }
  }

  async function savePdf() {
    setBusy('pdf');
    setNotice('');
    try {
      const hydrated = await hydrateOperationalPdfImages(plan, state.skus, gateway);
      const result = await output.savePdf(hydrated);
      setNotice(result.status === 'saved' ? 'PDF data operasional berhasil disimpan.' : 'Penyimpanan PDF dibatalkan.');
    } catch {
      setNotice('PDF data operasional belum dapat disimpan.');
    } finally {
      setBusy('');
    }
  }

  return <section className="feature-page operational-export-page">
    <div className="feature-toolbar">
      <div><strong>Ekspor data operasional</strong><span>Filter WITA berlaku untuk XLSX dan PDF.</span></div>
      <div className="operational-export-actions">
        <button className="button secondary" aria-label="Ekspor XLSX data operasional" disabled={Boolean(busy)} onClick={() => void downloadWorkbook()}>{busy === 'xlsx' ? 'Membuat XLSX…' : 'Ekspor XLSX'}</button>
        <button className="button primary" aria-label="Simpan PDF data operasional" disabled={Boolean(busy) || plan.totalIncluded === 0} onClick={() => void savePdf()}>{busy === 'pdf' ? 'Membuat PDF…' : 'Simpan PDF'}</button>
      </div>
    </div>
    <div className="operational-export-filters">
      <label><span>Dataset PDF</span><select aria-label="Dataset PDF" value={dataset} onChange={(event) => setDataset(event.target.value as OperationalDataset)}>{Object.entries(datasetLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label><span>Cari</span><input aria-label="Cari data operasional" value={filters.query} onChange={(event) => updateFilter('query', event.target.value)} /></label>
      <label><span>Dari tanggal WITA</span><input aria-label="Dari tanggal data operasional" type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} /></label>
      <label><span>Sampai tanggal WITA</span><input aria-label="Sampai tanggal data operasional" type="date" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} /></label>
      <label><span>Status SKU</span><select aria-label="Status SKU data operasional" value={filters.status} onChange={(event) => updateFilter('status', event.target.value as OperationalFilters['status'])}><option value="active">Aktif</option><option value="archived">Diarsipkan</option><option value="all">Semua</option></select></label>
    </div>
    <div className="operational-export-summary"><strong>{plan.totalMatched} cocok · {plan.totalIncluded} masuk PDF</strong><span>PDF dibatasi 300 baris; XLSX memuat seluruh data yang cocok.</span></div>
    {notice ? <p className="action-status" role="status">{notice}</p> : null}
    <div className="table-frame operational-export-preview">
      <table><thead><tr>{plan.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{plan.rows.slice(0, 50).map((row) => <tr key={row.id}>{row.cells.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody></table>
      {plan.rows.length === 0 ? <div className="empty-state">Tidak ada data yang cocok dengan filter ini.</div> : null}
    </div>
  </section>;
}
