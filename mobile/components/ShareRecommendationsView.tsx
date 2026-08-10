import { useMemo, useState } from 'react';
import {
  buildRecommendationPdfPlan,
  createRecommendationPdfBlob,
  type RecommendationPdfMode,
} from '../../src/domain/recommendation-pdf';
import {
  buildShareRecommendationReport,
  groupShareRecommendationItems,
  type ShareRecommendationItem,
} from '../../src/domain/share-recommendations';
import type { DemoState, Sku } from '../../src/domain/types';
import type { OperationsGateway } from '../../src/gateway/operations-gateway';
import type { PdfSharePort } from '../ports';
import { formatRupiah, formatWita } from '../format';
import { BackIcon, ShareIcon } from './Icons';
import { ProductImage } from './ProductImage';
import { hydrateRecommendationPdfImages } from '../../src/renderer/recommendation-pdf-images';

type RecommendationTab = RecommendationPdfMode;

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
  gateway,
  onOpenSku,
}: {
  item: ShareRecommendationItem;
  gateway: OperationsGateway;
  onOpenSku: (sku: Sku) => void;
}) {
  return <article className="share-item">
    <div className="share-item__product">
      <ProductImage gateway={gateway} sku={item.sku} />
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
    </div>
  </article>;
}

export function ShareRecommendationsView({
  snapshot,
  gateway,
  onBack,
  onOpenSku,
  onSharePdf,
  coreBacked = false,
  syncLabel,
}: {
  snapshot: DemoState;
  gateway: OperationsGateway;
  onBack: () => void;
  onOpenSku: (sku: Sku) => void;
  onSharePdf: PdfSharePort['sharePdf'];
  coreBacked?: boolean;
  syncLabel?: string;
}) {
  const [tab, setTab] = useState<RecommendationTab>('daily');
  const [date, setDate] = useState(witaToday);
  const [sharingPdf, setSharingPdf] = useState(false);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const report = useMemo(() => buildShareRecommendationReport(snapshot, recommendationDate(date)), [date, snapshot]);
  const groups = tab === 'daily' ? report.groups : groupShareRecommendationItems(report.urgent);
  const pdfPlan = useMemo(() => buildRecommendationPdfPlan(report, tab, coreBacked), [coreBacked, report, tab]);

  async function sharePdf() {
    setSharingPdf(true);
    setStatus(null);
    try {
      const blob = await createRecommendationPdfBlob(
        await hydrateRecommendationPdfImages(pdfPlan, snapshot.skus, gateway),
      );
      await onSharePdf({
        blob,
        fileName: pdfPlan.fileName,
        title: pdfPlan.title,
        shareText: coreBacked
          ? `CH Core · Data · ${syncLabel ?? 'Tidak terhubung'}`
          : 'DATA DEMO · SESSION ONLY',
      });
      setStatus({ kind: 'success', message: `PDF ${pdfPlan.title} siap dibagikan.` });
    } catch {
      setStatus({ kind: 'error', message: 'PDF belum dibagikan. Coba lagi.' });
    } finally {
      setSharingPdf(false);
    }
  }

  return <section className="page-view share-view">
    <button className="back-button" onClick={onBack}><BackIcon />Kembali</button>
    <h1 data-page-heading tabIndex={-1}>Rekomendasi Share</h1>
    <p>Buat satu katalog PDF dari seluruh rekomendasi pada tanggal terpilih.</p>

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
      <button aria-selected={tab === 'daily'} onClick={() => { setTab('daily'); setStatus(null); }} role="tab">Rekomendasi Harian</button>
      <button aria-selected={tab === 'urgent'} onClick={() => { setTab('urgent'); setStatus(null); }} role="tab">SKU Urgent</button>
    </div>

    <button
      className="primary-action share-pdf-action"
      disabled={sharingPdf || pdfPlan.totalIncluded === 0}
      onClick={() => void sharePdf()}
    >
      <ShareIcon />{sharingPdf ? 'Membuat PDF…' : `Bagikan PDF ${tab === 'daily' ? 'Harian' : 'Urgent'}`}
    </button>

    <div className="share-summary">
      <span>{tab === 'daily' ? 'DAFTAR HARIAN' : 'PRIORITAS URGENT'}</span>
      <strong>
        {tab === 'daily'
          ? `${report.daily.length} dari ${report.totalEligible} SKU dipilih`
          : `${pdfPlan.totalIncluded} dari ${pdfPlan.totalAvailable} SKU urgent dimasukkan ke PDF`}
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
          gateway={gateway}
          key={item.sku.id}
          onOpenSku={onOpenSku}
        />)}</div>
      </section>;
    })}</div> : <p className="empty-state">Tidak ada SKU yang memenuhi rekomendasi pada tanggal ini.</p>}
  </section>;
}
