import { useRef, useState } from 'react';
import type { Sku, SkuPriceChange } from '../../src/domain/types';
import type { OperationsGateway } from '../../src/gateway/operations-gateway';
import { formatRupiah, formatWita } from '../format';
import { BackIcon, ScanIcon } from './Icons';
import { ProductImage } from './ProductImage';
import { blobAsDataUrl, preprocessMobileSkuImage } from '../image-preprocessing';

export function SkuDetail({ gateway, sku, changes, coreBacked = false, syncLabel, onBack, onScanAgain }: {
  gateway: OperationsGateway;
  sku: Sku;
  changes: SkuPriceChange[];
  coreBacked?: boolean;
  syncLabel?: string;
  onBack: () => void;
  onScanAgain: () => void;
}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [imageStatus, setImageStatus] = useState('');
  const history = changes
    .filter((change) => change.skuId === sku.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  async function replaceImage(file?: File) {
    if (!file) return;
    setUploading(true);
    setImageStatus('');
    try {
      const image = await preprocessMobileSkuImage(file);
      await gateway.updateSku(sku.id, { imageUrl: await blobAsDataUrl(image) });
      setImageStatus('Gambar SKU diperbarui.');
    } catch (error) {
      setImageStatus(error instanceof Error ? error.message : 'Gambar gagal diperbarui.');
    } finally {
      setUploading(false);
      if (imageInput.current) imageInput.current.value = '';
    }
  }

  return <article className="page-view sku-detail">
    <button className="back-button" onClick={onBack}><BackIcon />Kembali</button>
    {sku.archived ? <p className="archived-warning" role="alert">SKU ini telah diarsipkan dan tidak tampil di daftar SKU aktif.</p> : null}
    <div className="detail-hero"><ProductImage gateway={gateway} sku={sku} /><div><h1 data-page-heading tabIndex={-1}>{sku.name}</h1><p>{sku.skuNumber}</p><strong>{formatRupiah(sku.referencePrice)}</strong><span>{sku.tracked ? `Stok ${sku.stock}` : 'Stok tidak dilacak'}</span></div></div>
    <input ref={imageInput} className="sr-only" type="file" accept="image/*" capture="environment" aria-label="Pilih gambar SKU" onChange={(event) => void replaceImage(event.target.files?.[0])} />
    <button className="secondary-action" disabled={uploading} onClick={() => imageInput.current?.click()}>{uploading ? 'Memproses gambar…' : 'Ganti gambar'}</button>
    {imageStatus ? <p className="action-status" role="status">{imageStatus}</p> : null}
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
      })}</div> : <p>{coreBacked ? `CH Core · Data · ${syncLabel ?? 'Tidak terhubung'}` : 'Belum ada perubahan harga pada sesi ini.'}</p>}
    </section>
    <button className="secondary-action" onClick={onScanAgain}><ScanIcon />Scan kode lain</button>
  </article>;
}
