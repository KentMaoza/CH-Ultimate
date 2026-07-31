import type { Sku, SkuPriceChange } from '../../src/domain/types';
import { formatRupiah, formatWita } from '../format';
import { BackIcon, ScanIcon } from './Icons';
import { ProductImage } from './ProductImage';

export function SkuDetail({ sku, changes, coreBacked = false, onBack, onScanAgain }: {
  sku: Sku;
  changes: SkuPriceChange[];
  coreBacked?: boolean;
  onBack: () => void;
  onScanAgain: () => void;
}) {
  const history = changes
    .filter((change) => change.skuId === sku.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return <article className="page-view sku-detail">
    <button className="back-button" onClick={onBack}><BackIcon />Kembali</button>
    {sku.archived ? <p className="archived-warning" role="alert">SKU ini telah diarsipkan dan tidak tampil di daftar SKU aktif.</p> : null}
    <div className="detail-hero"><ProductImage sku={sku} /><div><h1 data-page-heading tabIndex={-1}>{sku.name}</h1><p>{sku.skuNumber}</p><strong>{formatRupiah(sku.referencePrice)}</strong><span>{sku.tracked ? `Stok ${sku.stock}` : 'Stok tidak dilacak'}</span></div></div>
    <section className="detail-section">
      <h2>Alias SKU</h2>
      {sku.aliases.length > 0 ? <ul className="alias-list">{sku.aliases.map((alias) => <li key={alias}>{alias}</li>)}</ul> : <p>Belum ada alias.</p>}
    </section>
    <section aria-label="Riwayat harga SKU" className="detail-section">
      <h2>Riwayat harga</h2>
      {history.length > 0 ? <div className="detail-history">{history.map((change) => {
        const direction = change.after > change.before ? 'naik' : change.after < change.before ? 'turun' : 'tetap';
        const priceDescription = `Harga ${direction}. Harga lama ${formatRupiah(change.before)}. Harga baru ${formatRupiah(change.after)}.`;
        return <div key={change.id}><span aria-label={priceDescription} role="group"><s aria-hidden="true">{formatRupiah(change.before)}</s><b aria-hidden="true">→</b><strong aria-hidden="true">{formatRupiah(change.after)}</strong></span><time>{formatWita(change.createdAt)}</time></div>;
      })}</div> : <p>{coreBacked ? 'Belum ada perubahan harga tersinkronisasi.' : 'Belum ada perubahan harga pada sesi ini.'}</p>}
    </section>
    <button className="secondary-action" onClick={onScanAgain}><ScanIcon />Scan kode lain</button>
  </article>;
}
