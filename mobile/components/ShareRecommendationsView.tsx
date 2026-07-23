import { useMemo, useState } from 'react';
import {
  buildShareRecommendationReport,
  groupShareRecommendationItems,
  type ShareRecommendationItem,
} from '../../src/domain/share-recommendations';
import type { DemoState, Sku } from '../../src/domain/types';
import { formatRupiah, formatWita } from '../format';
import { BackIcon, ShareIcon } from './Icons';
import { ProductImage } from './ProductImage';

type RecommendationTab = 'daily' | 'urgent';

function witaToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function recommendationDate(value: string): Date {
  return new Date(`${value}T04:00:00.000Z`);
}

function RecommendationItem({
  item,
  pending,
  onOpenSku,
  onShareSku,
}: {
  item: ShareRecommendationItem;
  pending: boolean;
  onOpenSku: (sku: Sku) => void;
  onShareSku: (sku: Sku) => void;
}) {
  return <article className="share-item">
    <div className="share-item__product">
      <ProductImage sku={item.sku} />
      <div>
        <strong>{item.sku.name}</strong>
        <span>SKU: {item.sku.skuNumber}</span>
        <b>{formatRupiah(item.sku.referencePrice)}</b>
      </div>
    </div>
    <dl className="share-item__facts">
      <div><dt>Stok</dt><dd>{item.sku.stock.toLocaleString('id-ID')}</dd></div>
      <div><dt>Terakhir keluar / dibuat</dt><dd>{formatWita(item.lastOutAt)}</dd></div>
      <div><dt>Tidak keluar</dt><dd>{item.idleDays.toLocaleString('id-ID')} hari</dd></div>
    </dl>
    {item.urgent ? <strong className="share-urgent">URGENT</strong> : null}
    <div className="share-item__actions">
      <button
        aria-label={`Buka detail ${item.sku.name}`}
        className="secondary-action"
        onClick={() => onOpenSku(item.sku)}
      >
        Detail
      </button>
      <button
        aria-label={`Bagikan SKU ${item.sku.name}`}
        className="primary-action"
        disabled={pending}
        onClick={() => onShareSku(item.sku)}
      >
        <ShareIcon />{pending ? 'Membuka…' : 'Bagikan SKU'}
      </button>
    </div>
  </article>;
}

export function ShareRecommendationsView({
  snapshot,
  onBack,
  onOpenSku,
  onShareSku,
}: {
  snapshot: DemoState;
  onBack: () => void;
  onOpenSku: (sku: Sku) => void;
  onShareSku: (sku: Sku) => Promise<void>;
}) {
  const [tab, setTab] = useState<RecommendationTab>('daily');
  const [date, setDate] = useState(witaToday);
  const [pendingSkuId, setPendingSkuId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const report = useMemo(() => buildShareRecommendationReport(snapshot, recommendationDate(date)), [date, snapshot]);
  const groups = tab === 'daily' ? report.groups : groupShareRecommendationItems(report.urgent);

  async function shareSku(sku: Sku) {
    setPendingSkuId(sku.id);
    setStatus(null);
    try {
      await onShareSku(sku);
      setStatus({ kind: 'success', message: `${sku.name} siap dibagikan.` });
    } catch {
      setStatus({ kind: 'error', message: `${sku.name} belum dibagikan. Coba lagi.` });
    } finally {
      setPendingSkuId(null);
    }
  }

  return <section className="page-view share-view">
    <button className="back-button" onClick={onBack}><BackIcon />Kembali</button>
    <h1 data-page-heading tabIndex={-1}>Rekomendasi Share</h1>
    <p>Pilih satu SKU, lalu bagikan gambar dan informasi produknya.</p>

    <label className="share-date">
      <span>Tanggal rekomendasi</span>
      <input
        aria-label="Tanggal rekomendasi"
        type="date"
        value={date}
        onChange={(event) => {
          setDate(event.target.value);
          setStatus(null);
        }}
      />
    </label>

    <div aria-label="Bagian rekomendasi share" className="share-tabs" role="tablist">
      <button aria-selected={tab === 'daily'} onClick={() => setTab('daily')} role="tab">Rekomendasi Harian</button>
      <button aria-selected={tab === 'urgent'} onClick={() => setTab('urgent')} role="tab">SKU Urgent</button>
    </div>

    <div className="share-summary">
      <span>{tab === 'daily' ? 'DAFTAR HARIAN' : 'PRIORITAS URGENT'}</span>
      <strong>
        {tab === 'daily'
          ? `${report.daily.length} dari ${report.totalEligible} SKU dipilih`
          : `${report.urgent.length} SKU tidak keluar lebih dari 8 bulan`}
      </strong>
      <small>
        {tab === 'daily'
          ? 'Paling lama tidak keluar ditampilkan lebih dulu.'
          : 'Urgent memakai ambang delapan bulan kalender.'}
      </small>
    </div>

    {status ? <p className="action-status" role={status.kind === 'error' ? 'alert' : 'status'}>{status.message}</p> : null}

    {groups.length > 0 ? <div className="share-groups">{groups.map((group) => {
      const label = group.supplierCode ?? 'Tanpa kode supplier';
      return <section aria-label={`Grup supplier ${label}`} className="share-group" key={label}>
        <header><span><small>SUPPLIER</small><strong>{label}</strong></span><b>{group.items.length} SKU</b></header>
        <div>{group.items.map((item) => <RecommendationItem
          item={item}
          key={item.sku.id}
          onOpenSku={onOpenSku}
          onShareSku={(sku) => void shareSku(sku)}
          pending={pendingSkuId === item.sku.id}
        />)}</div>
      </section>;
    })}</div> : <p className="empty-state">Tidak ada SKU yang memenuhi rekomendasi pada tanggal ini.</p>}
  </section>;
}
