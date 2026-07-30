import type { Sku, SkuPriceChange } from '../../src/domain/types';
import { PriceChangeList } from './PriceChangeList';

export function PriceFeedView({
  changes,
  coreBacked = false,
  skus,
  unreadOnly,
  status,
  onOpenSku,
  onSimulate,
}: {
  changes: SkuPriceChange[];
  coreBacked?: boolean;
  skus: Sku[];
  unreadOnly: boolean;
  status: string;
  onOpenSku: (sku: Sku) => void;
  onSimulate?: () => void;
}) {
  return <section aria-label={unreadOnly ? 'Perubahan harga belum dibaca' : 'Semua perubahan harga'} className="page-view price-feed-view">
    <h1 data-page-heading tabIndex={-1}>{unreadOnly ? 'Notifikasi Harga' : 'Perubahan Harga'}</h1>
    <p>{unreadOnly ? 'Perubahan harga yang belum Anda buka.' : 'Riwayat perubahan harga terbaru untuk semua SKU.'}</p>
    {!coreBacked && !unreadOnly && onSimulate ? <button className="primary-action simulate-button" onClick={onSimulate}>Simulasikan perubahan harga</button> : null}
    {status && !unreadOnly ? <p className="action-status" role="status">{status}</p> : null}
    {changes.length > 0 ? <PriceChangeList changes={changes} onOpenSku={onOpenSku} skus={skus} /> : <p className="empty-state">{unreadOnly ? 'Tidak ada perubahan harga yang belum dibaca.' : coreBacked ? 'Belum ada riwayat perubahan harga tersinkronisasi.' : 'Belum ada riwayat perubahan harga pada sesi ini.'}</p>}
  </section>;
}
