import { ClockIcon, ShareIcon } from './Icons';

export function MoreView({ coreBacked = false, onOpenPrices, onOpenRecommendations }: { coreBacked?: boolean; onOpenPrices: () => void; onOpenRecommendations: () => void }) {
  return <section className="mobile-more-view">
    <header className="mobile-header"><div><span className="eyebrow">FITUR LAIN</span><h1 data-page-heading tabIndex={-1}>Lainnya</h1></div></header>
    <div className="mobile-more-list">
      <button aria-label="Rekomendasi" onClick={onOpenRecommendations}><ShareIcon /><span><strong>Rekomendasi</strong><small>Buat dan bagikan katalog rekomendasi.</small></span></button>
      <button aria-label="Perubahan Harga" onClick={onOpenPrices}><ClockIcon /><span><strong>Perubahan Harga</strong><small>{coreBacked ? 'Lihat riwayat perubahan harga tersinkronisasi.' : 'Lihat riwayat perubahan harga sesi ini.'}</small></span></button>
    </div>
  </section>;
}
