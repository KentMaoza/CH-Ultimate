import { useState, type FormEvent } from 'react';
import { useOperations } from '../operations-context';
import { formatTitleCaseInput } from '../format';

export function CreateSkuPage({ coreBacked = false }: { coreBacked?: boolean }) {
  const { gateway } = useOperations();
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const sku = await gateway.createSku({
        skuNumber: String(form.get('skuNumber') ?? ''), name: String(form.get('name') ?? ''),
        referencePrice: Number(form.get('price')), openingStock: Number(form.get('stock')),
        tracked: form.get('tracked') === 'on', note: String(form.get('note') ?? ''), imageUrl: String(form.get('image') ?? ''),
      });
      event.currentTarget.reset();
      setMessage(coreBacked ? `${sku.skuNumber} disimpan ke CH Core.` : `${sku.skuNumber} ditambahkan ke sesi demo.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'SKU gagal dibuat.'); }
  }
  return (
    <div className="feature-page form-layout">
      <form className="editor-card" onSubmit={(event) => void submit(event)}>
        <div className="section-heading"><span>DATA UTAMA</span><h2>SKU baru</h2><p>{coreBacked ? 'SKU akan disimpan ke CH Core dan disinkronkan ke perangkat lain.' : 'Semua nilai hanya tersedia selama aplikasi tetap terbuka.'}</p></div>
        {message && <div className="notice" role="status">{message}</div>}
        <div className="form-grid">
          <label><span>Nomor SKU</span><input required name="skuNumber" /></label>
          <label><span>Nama SKU</span><input required name="name" onChange={(event) => { event.currentTarget.value = formatTitleCaseInput(event.currentTarget); }} /></label>
          <label><span>Harga Referensi</span><input required min="0" name="price" type="number" /></label>
          <label><span>Stok Awal</span><input required min="0" step="1" defaultValue="0" name="stock" type="number" /></label>
          <label className="full"><span>Tautan gambar (opsional)</span><input name="image" type="url" /></label>
          <label className="full"><span>Catatan SKU Gudang</span><textarea name="note" rows={3} /></label>
          <label className="check-field full"><input defaultChecked name="tracked" type="checkbox" /><span>SKU ini dilacak stoknya</span></label>
        </div>
        <div className="form-actions"><button className="button primary" type="submit">Simpan SKU</button></div>
      </form>
      <aside className="guide-card"><span className="guide-number">01</span><h3>Nomor tetap utuh</h3><p>Nomor SKU panjang tidak dipotong. Jika diedit nanti, nilai lama tetap menjadi alias untuk pencarian dan QR.</p><hr /><h3>Harga bukan modal</h3><p>Harga Referensi adalah saran harga jual per pcs, bukan COGS.</p></aside>
    </div>
  );
}
