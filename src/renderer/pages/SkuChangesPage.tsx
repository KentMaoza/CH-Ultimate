import { useMemo, useState } from 'react';
import type { Sku, SkuPriceChange, StockAdjustment } from '../../domain/types';
import { formatRupiah } from '../format';
import { useOperations } from '../operations-context';
import { GatewaySkuImage } from '../components/GatewaySkuImage';
import { useOutput } from '../output-context';

type ChangeTab = 'price' | 'quantity';

function witaDate(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function formatWita(value: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Makassar', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
}

function inRange(createdAt: string, from: string, to: string): boolean {
  const date = witaDate(createdAt);
  return (!from || date >= from) && (!to || date <= to);
}

function csvCell(value: string | number): string {
  const raw = String(value);
  const text = typeof value === 'string' && /^[\t\r ]*[=+\-@]/.test(raw)
    ? `'${raw}`
    : raw;
  return /[;"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function priceChangesCsv(changes: SkuPriceChange[], skus: Sku[]): string {
  const skuById = new Map(skus.map((sku) => [sku.id, sku]));
  const rows = changes.map((change) => {
    const sku = skuById.get(change.skuId);
    return [formatWita(change.createdAt), sku?.skuNumber ?? change.skuId, sku?.name ?? 'SKU tidak ditemukan', change.before, change.after].map(csvCell).join(';');
  });
  return ['Tanggal WITA;Nomor SKU;Nama SKU;Harga Sebelumnya;Harga Sesudahnya', ...rows].join('\n');
}

const adjustmentSource: Record<StockAdjustment['source'], string> = { manual: 'Manual', nota: 'Nota', reversal: 'Pembalikan Nota', 'stock-check': 'Cek Stok', other: 'Lainnya' };

export function SkuChangesPage({ coreBacked = false }: { coreBacked?: boolean }) {
  const { state, gateway } = useOperations();
  const output = useOutput();
  const [tab, setTab] = useState<ChangeTab>('price');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [notice, setNotice] = useState('');
  const skuById = useMemo(() => new Map(state.skus.map((sku) => [sku.id, sku])), [state.skus]);
  const prices = useMemo(() => state.priceChanges.filter((change) => inRange(change.createdAt, from, to)).slice().reverse(), [from, state.priceChanges, to]);
  const quantities = useMemo(() => state.adjustments.filter((change) => inRange(change.createdAt, from, to)).slice().reverse(), [from, state.adjustments, to]);

  async function exportPrices() {
    setNotice('');
    try {
      const result = await output.saveCsv({
        fileName: `perubahan-harga-sku-${witaDate(new Date().toISOString())}.csv`,
        bytes: new TextEncoder().encode(`\uFEFF${priceChangesCsv(prices, state.skus)}`),
      });
      setNotice(result.status === 'saved'
        ? 'CSV perubahan harga berhasil disimpan.'
        : 'Penyimpanan CSV dibatalkan.');
    } catch {
      setNotice('CSV perubahan harga belum dapat disimpan.');
    }
  }

  return <div className="feature-page sku-changes-page">
    <div className="feature-toolbar">
      <div><strong>Riwayat perubahan SKU</strong><span>{coreBacked ? 'Catatan terpusat harga dan jumlah stok · WITA' : 'Catatan sesi harga dan jumlah stok · WITA'}</span></div>
      {tab === 'price' && <button className="button primary" disabled={!prices.length || output.busy} aria-label="Ekspor perubahan harga CSV" onClick={() => void exportPrices()}>Ekspor CSV</button>}
    </div>
    {notice ? <p className="action-status" role="status">{notice}</p> : null}
    <div className="change-tabs" role="tablist" aria-label="Jenis perubahan SKU">
      <button role="tab" aria-selected={tab === 'price'} onClick={() => setTab('price')}>Perubahan harga</button>
      <button role="tab" aria-selected={tab === 'quantity'} onClick={() => setTab('quantity')}>Perubahan jumlah</button>
    </div>
    <div className="change-date-filters">
      <label><span>Dari tanggal</span><input type="date" aria-label="Dari tanggal perubahan" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label><span>Sampai tanggal</span><input type="date" aria-label="Sampai tanggal perubahan" value={to} onChange={(event) => setTo(event.target.value)} /></label>
    </div>
    <div className="table-frame change-table">
      {tab === 'price' ? <table><thead><tr><th>Gambar</th><th>Tanggal WITA</th><th>Nomor SKU</th><th>Nama SKU</th><th>Harga Sebelumnya</th><th>Harga Sesudahnya</th></tr></thead><tbody>{prices.map((change) => {
        const sku = skuById.get(change.skuId);
        return <tr key={change.id}><td>{sku ? <GatewaySkuImage gateway={gateway} sku={sku} className="sku-image image-placeholder" alt={`Gambar ${sku.skuNumber}`} /> : <span className="image-placeholder">CHU</span>}</td><td>{formatWita(change.createdAt)}</td><td className="sku-number">{sku?.skuNumber ?? change.skuId}</td><td>{sku?.name ?? 'SKU tidak ditemukan'}</td><td>{formatRupiah(change.before)}</td><td><strong>{formatRupiah(change.after)}</strong></td></tr>;
      })}</tbody></table> : <table><thead><tr><th>Gambar</th><th>Tanggal WITA</th><th>Nomor SKU</th><th>Nama SKU</th><th>Sumber</th><th>Sebelum</th><th>Perubahan</th><th>Sesudah</th></tr></thead><tbody>{quantities.map((change) => {
        const sku = skuById.get(change.skuId);
        return <tr key={change.id}><td>{sku ? <GatewaySkuImage gateway={gateway} sku={sku} className="sku-image image-placeholder" alt={`Gambar ${sku.skuNumber}`} /> : <span className="image-placeholder">CHU</span>}</td><td>{formatWita(change.createdAt)}</td><td className="sku-number">{sku?.skuNumber ?? change.skuId}</td><td>{sku?.name ?? 'SKU tidak ditemukan'}</td><td>{adjustmentSource[change.source]}</td><td>{change.before}</td><td className={change.quantity < 0 ? 'change-negative' : 'change-positive'}>{change.quantity > 0 ? '+' : ''}{change.quantity}</td><td><strong>{change.after}</strong></td></tr>;
      })}</tbody></table>}
      {tab === 'price' && !prices.length && <div className="empty-state">Belum ada perubahan harga pada rentang tanggal ini.</div>}
      {tab === 'quantity' && !quantities.length && <div className="empty-state">Belum ada perubahan jumlah pada rentang tanggal ini.</div>}
    </div>
  </div>;
}
