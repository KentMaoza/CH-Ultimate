import { useMemo, useState } from 'react';
import {
  buildRecommendationPdfPlan,
  createRecommendationPdfBlob,
  type RecommendationPdfMode,
} from '../../domain/recommendation-pdf';
import { buildShareRecommendationReport, groupShareRecommendationItems, type ShareRecommendationGroup, type ShareRecommendationItem } from '../../domain/share-recommendations';
import type { Sku } from '../../domain/types';
import { formatDate, formatRupiah } from '../format';
import { useOperations } from '../operations-context';
import { GatewaySkuImage } from '../components/GatewaySkuImage';
import { hydrateRecommendationPdfImages } from '../recommendation-pdf-images';

type RecommendationTab = RecommendationPdfMode;
const reasonLabels = {
  'new-sku': 'SKU Baru',
  'price-updated': 'Harga diperbarui',
  restocked: 'Baru Restock',
  idle: 'Stok lama',
} as const;

function witaDateToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function recommendationDate(value: string): Date {
  return new Date(`${value}T04:00:00.000Z`);
}

function RecommendationRow({ item, gateway }: { item: ShareRecommendationItem; gateway: ReturnType<typeof useOperations>['gateway'] }) {
  return <article className="share-recommendation__item">
    <GatewaySkuImage gateway={gateway} sku={item.sku} className="share-recommendation__image image-placeholder" alt="" />
    <div className="share-recommendation__identity"><strong>{item.sku.name}</strong><span>{item.sku.skuNumber}</span></div>
    <div className="share-recommendation__stock"><span>Stok</span><strong>{item.sku.stock}</strong></div>
    <div className="share-recommendation__price"><span>Harga</span><strong>{formatRupiah(item.sku.referencePrice)}</strong></div>
    <div className="share-recommendation__movement"><span>Terakhir keluar / dibuat</span><strong>{formatDate(item.lastOutAt)}</strong><small>{item.idleDays.toLocaleString('id-ID')} hari tidak keluar</small></div>
    <div className="share-recommendation__priority">
      {item.reasons.map((reason) => <b className="share-recommendation__reason" key={reason}>{reasonLabels[reason]}</b>)}
      {item.urgent ? <b className="share-recommendation__urgent">URGENT</b> : null}
    </div>
  </article>;
}

function RecommendationGroups({ groups, gateway }: { groups: ShareRecommendationGroup[]; gateway: ReturnType<typeof useOperations>['gateway'] }) {
  return <div className="share-recommendation__groups">{groups.map((group) => {
    const label = group.supplierCode ?? 'Tanpa kode supplier';
    return <section className="share-recommendation__group" role="region" aria-label={`Grup supplier ${label}`} key={label}>
      <header><div><span>SUPPLIER</span><h2>{label}</h2></div><strong>{group.items.length} SKU</strong></header>
      <div>{group.items.map((item) => <RecommendationRow item={item} gateway={gateway} key={item.sku.id} />)}</div>
    </section>;
  })}</div>;
}

export function ShareRecommendationsPage({ coreBacked = false }: { coreBacked?: boolean }) {
  const { state, gateway } = useOperations();
  const [tab, setTab] = useState<RecommendationTab>('daily');
  const [date, setDate] = useState(witaDateToday);
  const [message, setMessage] = useState('');
  const [downloading, setDownloading] = useState(false);
  const report = useMemo(() => buildShareRecommendationReport(state, recommendationDate(date)), [date, state]);
  const groups = tab === 'daily' ? report.groups : groupShareRecommendationItems(report.urgent);
  const pdfPlan = useMemo(() => buildRecommendationPdfPlan(report, tab, coreBacked), [coreBacked, report, tab]);

  async function downloadPdf() {
    setDownloading(true);
    setMessage('');
    try {
      const blob = await createRecommendationPdfBlob(
        await hydrateRecommendationPdfImages(pdfPlan, state.skus, gateway),
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = pdfPlan.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage(`PDF ${pdfPlan.title} berhasil diunduh.`);
    } catch {
      setMessage('PDF belum dapat dibuat. Coba lagi.');
    } finally {
      setDownloading(false);
    }
  }

  return <div className="feature-page share-recommendation">
    <div className="feature-toolbar">
      <div><strong>Rekomendasi share harian</strong><span>Rotasi harga baru, restock, stok lama, dan supplier.</span></div>
      <div className="share-recommendation__actions">
        <label><span>Tanggal rekomendasi</span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setMessage(''); }} /></label>
        <button
          className="button primary share-recommendation__pdf"
          disabled={downloading || pdfPlan.totalIncluded === 0}
          onClick={() => void downloadPdf()}
        >
          {downloading ? 'Membuat PDF…' : `Download PDF ${tab === 'daily' ? 'Harian' : 'Urgent'}`}
        </button>
      </div>
    </div>
    {message && <p className="notice" role="status">{message}</p>}
    <div className="change-tabs" role="tablist" aria-label="Bagian rekomendasi share">
      <button role="tab" aria-selected={tab === 'daily'} onClick={() => { setTab('daily'); setMessage(''); }}>Rekomendasi Harian</button>
      <button role="tab" aria-selected={tab === 'urgent'} onClick={() => { setTab('urgent'); setMessage(''); }}>SKU Urgent</button>
    </div>
    <div className="share-recommendation__summary">
      <div><span>{tab === 'daily' ? 'DAFTAR HARIAN' : 'PRIORITAS URGENT'}</span><strong>{tab === 'daily' ? `${report.daily.length} dari ${report.totalEligible} SKU dipilih untuk hari ini` : `${pdfPlan.totalIncluded} dari ${pdfPlan.totalAvailable} SKU urgent dimasukkan ke PDF`}</strong></div>
      <small>{tab === 'daily' ? 'Daftar berganti secara deterministik menurut tanggal WITA dan kode supplier.' : 'Urgent dihitung dengan ambang kalender, bukan perkiraan jumlah hari.'}</small>
    </div>
    {groups.length ? <RecommendationGroups groups={groups} gateway={gateway} /> : <p className="empty-state">Tidak ada SKU yang memenuhi rekomendasi pada tanggal ini.</p>}
  </div>;
}
