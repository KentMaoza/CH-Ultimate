import { useEffect, useRef, useState } from 'react';
import { formatSkuShareText } from '../../domain/sku-share';
import type { Sku } from '../../domain/types';
import { formatRupiah } from '../format';
import { downloadSkuImage } from '../sku-share';

function ShareImage({ sku }: { sku: Sku }) {
  const [failed, setFailed] = useState(false);
  return sku.imageUrl && !failed
    ? <img src={sku.imageUrl} alt="" onError={() => setFailed(true)} />
    : <div className="image-placeholder">CHU</div>;
}

export function SkuShareDialog({ sku, onClose }: { sku: Sku; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  async function copyInformation() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard tidak tersedia.');
      await navigator.clipboard.writeText(formatSkuShareText(sku));
      setStatus({ kind: 'success', text: 'Informasi SKU disalin.' });
    } catch {
      setStatus({ kind: 'error', text: 'Informasi belum dapat disalin.' });
    }
  }

  async function saveImage() {
    try {
      const saved = await downloadSkuImage(sku);
      setStatus(saved
        ? { kind: 'success', text: 'Gambar produk mulai disimpan.' }
        : { kind: 'error', text: 'SKU ini belum memiliki gambar.' });
    } catch {
      setStatus({ kind: 'error', text: 'Gambar produk belum dapat disimpan.' });
    }
  }

  return <div
    className="sku-share-dialog"
    onClick={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}
  >
    <div
      aria-labelledby="sku-share-dialog-title"
      aria-modal="true"
      className="sku-share-dialog__panel"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      ref={panelRef}
      role="dialog"
      tabIndex={-1}
    >
      <header>
        <div>
          <span>BAGIKAN SATU PRODUK</span>
          <h2 id="sku-share-dialog-title">Bagikan SKU</h2>
        </div>
        <button aria-label="Tutup dialog share" onClick={onClose}>×</button>
      </header>
      <div className="sku-share-dialog__product">
        <ShareImage sku={sku} />
        <div>
          <strong>{sku.name}</strong>
          <span>SKU: {sku.skuNumber}</span>
          <b>{formatRupiah(sku.referencePrice)}</b>
        </div>
      </div>
      <p>Pilih salin informasi atau simpan gambar produk untuk dibagikan melalui aplikasi lain.</p>
      {status ? <p className="notice" role={status.kind === 'error' ? 'alert' : 'status'}>{status.text}</p> : null}
      <footer className="sku-share-dialog__actions">
        <button className="button" onClick={onClose}>Tutup</button>
        {sku.imageUrl ? <button className="button" onClick={() => void saveImage()}>Simpan gambar</button> : null}
        <button className="button primary" onClick={() => void copyInformation()}>Salin informasi</button>
      </footer>
    </div>
  </div>;
}
