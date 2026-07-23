import { useMemo, useState } from 'react';
import { buildShareRecommendationReport, groupShareRecommendationItems, type ShareRecommendationGroup, type ShareRecommendationItem } from '../../domain/share-recommendations';
import type { Sku } from '../../domain/types';
import { SkuShareDialog } from '../components/SkuShareDialog';
import { formatDate, formatRupiah } from '../format';
import { useOperations } from '../operations-context';
import { shareSkuWithSystem } from '../sku-share';

type RecommendationTab = 'daily' | 'urgent';

function witaDateToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function recommendationDate(value: string): Date {
  return new Date(`${value}T04:00:00.000Z`);
}

function SkuImage({ sku }: { sku: Sku }) {
  const [failed, setFailed] = useState(false);
  return sku.imageUrl && !failed
    ? <img className="share-recommendation__image" src={sku.imageUrl} alt="" onError={() => setFailed(true)} />
    : <div className="share-recommendation__image image-placeholder">CHU</div>;
}

function RecommendationRow({
  item,
  pending,
  onShare,
}: {
  item: ShareRecommendationItem;
  pending: boolean;
  onShare: (sku: Sku) => void;
}) {
  return <article className="share-recommendation__item">
    <SkuImage sku={item.sku} />
    <div className="share-recommendation__identity"><strong>{item.sku.name}</strong><span>{item.sku.skuNumber}</span></div>
    <div className="share-recommendation__stock"><span>Stok</span><strong>{item.sku.stock}</strong></div>
    <div className="share-recommendation__price"><span>Harga</span><strong>{formatRupiah(item.sku.referencePrice)}</strong></div>
    <div className="share-recommendation__movement"><span>Terakhir keluar / dibuat</span><strong>{formatDate(item.lastOutAt)}</strong><small>{item.idleDays.toLocaleString('id-ID')} hari tidak keluar</small></div>
    <div className="share-recommendation__priority">
      {item.urgent ? <b className="share-recommendation__urgent">URGENT</b> : null}
    </div>
    <button
      aria-label={`Bagikan SKU ${item.sku.name}`}
      className="button primary share-recommendation__share"
      disabled={pending}
      onClick={() => onShare(item.sku)}
    >
      {pending ? 'Membuka…' : 'Bagikan SKU'}
    </button>
  </article>;
}

function RecommendationGroups({
  groups,
  pendingSkuId,
  onShare,
}: {
  groups: ShareRecommendationGroup[];
  pendingSkuId: string | null;
  onShare: (sku: Sku) => void;
}) {
  return <div className="share-recommendation__groups">{groups.map((group) => {
    const label = group.supplierCode ?? 'Tanpa kode supplier';
    return <section className="share-recommendation__group" role="region" aria-label={`Grup supplier ${label}`} key={label}>
      <header><div><span>SUPPLIER</span><h2>{label}</h2></div><strong>{group.items.length} SKU</strong></header>
      <div>{group.items.map((item) => <RecommendationRow
        item={item}
        key={item.sku.id}
        onShare={onShare}
        pending={pendingSkuId === item.sku.id}
      />)}</div>
    </section>;
  })}</div>;
}

export function ShareRecommendationsPage() {
  const { state } = useOperations();
  const [tab, setTab] = useState<RecommendationTab>('daily');
  const [date, setDate] = useState(witaDateToday);
  const [message, setMessage] = useState('');
  const [pendingSkuId, setPendingSkuId] = useState<string | null>(null);
  const [fallbackSku, setFallbackSku] = useState<Sku | null>(null);
  const report = useMemo(() => buildShareRecommendationReport(state, recommendationDate(date)), [date, state]);
  const groups = tab === 'daily' ? report.groups : groupShareRecommendationItems(report.urgent);

  async function shareSku(sku: Sku) {
    setPendingSkuId(sku.id);
    setFallbackSku(null);
    setMessage('');
    try {
      const result = await shareSkuWithSystem(sku);
      if (result === 'shared') setMessage(`${sku.name} siap dibagikan.`);
      else if (result === 'cancelled') setMessage('Berbagi dibatalkan.');
      else setFallbackSku(sku);
    } finally {
      setPendingSkuId(null);
    }
  }

  return <div className="feature-page share-recommendation">
    <div className="feature-toolbar">
      <div><strong>Rekomendasi share harian</strong><span>Stok tersedia dengan pergerakan paling lama · maksimal 300 SKU per hari</span></div>
      <div className="share-recommendation__actions"><label><span>Tanggal rekomendasi</span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setMessage(''); setFallbackSku(null); }} /></label></div>
    </div>
    {message && <p className="notice" role="status">{message}</p>}
    <div className="change-tabs" role="tablist" aria-label="Bagian rekomendasi share">
      <button role="tab" aria-selected={tab === 'daily'} onClick={() => setTab('daily')}>Rekomendasi Harian</button>
      <button role="tab" aria-selected={tab === 'urgent'} onClick={() => setTab('urgent')}>SKU Urgent</button>
    </div>
    <div className="share-recommendation__summary">
      <div><span>{tab === 'daily' ? 'DAFTAR HARIAN' : 'PRIORITAS URGENT'}</span><strong>{tab === 'daily' ? `${report.daily.length} dari ${report.totalEligible} SKU dipilih untuk hari ini` : `${report.urgent.length} SKU tidak keluar lebih dari 8 bulan`}</strong></div>
      <small>{tab === 'daily' ? 'Urutan dimulai dari SKU yang paling lama tidak keluar.' : 'Urgent dihitung dengan ambang kalender, bukan perkiraan jumlah hari.'}</small>
    </div>
    {groups.length ? <RecommendationGroups groups={groups} onShare={(sku) => void shareSku(sku)} pendingSkuId={pendingSkuId} /> : <p className="empty-state">Tidak ada SKU yang memenuhi rekomendasi pada tanggal ini.</p>}
    {fallbackSku ? <SkuShareDialog onClose={() => setFallbackSku(null)} sku={fallbackSku} /> : null}
  </div>;
}
