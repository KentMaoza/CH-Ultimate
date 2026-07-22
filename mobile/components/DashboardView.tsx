import type { DemoState, Sku } from '../../src/domain/types';
import { BellIcon, BoxIcon, ChevronIcon, InfoIcon, ScanIcon, SearchIcon, TrendIcon } from './Icons';
import { PriceChangeList } from './PriceChangeList';

export function DashboardView({
  snapshot,
  unreadCount,
  onScan,
  onSearch,
  onOpenPrices,
  onOpenUnread,
  onOpenSku,
}: {
  snapshot: DemoState;
  unreadCount: number;
  onScan: () => void;
  onSearch: () => void;
  onOpenPrices: () => void;
  onOpenUnread: () => void;
  onOpenSku: (sku: Sku) => void;
}) {
  const activeSkus = snapshot.skus.filter((sku) => !sku.archived);
  const lowStockCount = activeSkus.filter((sku) => sku.tracked && sku.stock <= 2).length;
  const latest = [...snapshot.priceChanges].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 2);

  return <>
    <header className="mobile-header">
      <h1 data-page-heading tabIndex={-1}>CHU Companion Mobile</h1>
      <button aria-label={`Notifikasi harga, ${unreadCount} belum dibaca`} className="icon-button bell-button" onClick={onOpenUnread}>
        <BellIcon />
        {unreadCount > 0 ? <span className="unread-badge">{unreadCount}</span> : null}
      </button>
    </header>
    <aside className="demo-banner" aria-label="Mode Demo">
      <InfoIcon />
      <span><strong>Mode Demo</strong><small>Data yang ditampilkan adalah contoh.</small></span>
    </aside>
    <section className="quick-actions" aria-label="Aksi cepat">
      <button className="quick-action primary" onClick={onScan}><ScanIcon />Scan Barcode</button>
      <button className="quick-action" onClick={onSearch}><SearchIcon />Cari SKU</button>
    </section>
    <section className="summary-panel" aria-label="Ringkasan gudang">
      <div><BoxIcon /><span><small>Total SKU</small><strong data-testid="active-sku-count">{activeSkus.length.toLocaleString('id-ID')}</strong><em>SKU aktif di gudang</em></span></div>
      <div><TrendIcon /><span><small>Stok Menipis</small><strong data-testid="low-stock-count">{lowStockCount.toLocaleString('id-ID')}</strong><em>Perlu perhatian</em></span></div>
    </section>
    <section className="latest-section">
      <div className="section-heading"><h2>Perubahan harga terbaru</h2><button onClick={onOpenPrices}>Lihat semua<ChevronIcon /></button></div>
      <PriceChangeList changes={latest} onOpenSku={onOpenSku} skus={snapshot.skus} testId="latest-price-changes" />
    </section>
  </>;
}
