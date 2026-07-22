import { useMemo, useRef, useState } from 'react';
import { parseSkuWorkbook } from '../../domain/workbook';
import type { Sku } from '../../domain/types';
import { useOperations } from '../operations-context';
import { capitalizeSentenceStarts, formatDate, formatRupiah } from '../format';

function SkuImage({ sku }: { sku: Sku }) {
  const [failed, setFailed] = useState(false);
  if (!sku.imageUrl || failed) return <div className="image-placeholder">CHU</div>;
  return <img className="sku-image" src={sku.imageUrl} alt="" onError={() => setFailed(true)} />;
}

export function InventoryPage() {
  const { state, gateway } = useOperations();
  const [query, setQuery] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [adjusting, setAdjusting] = useState<Sku | null>(null);
  const [editing, setEditing] = useState<Sku | null>(null);
  const [editNumber, setEditNumber] = useState('');
  const [editName, setEditName] = useState('');
  const [editNote, setEditNote] = useState('');
  const [quantity, setQuantity] = useState('');
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id-ID');
    return state.skus.filter((sku) => {
      if (sku.archived !== showArchived) return false;
      if (stockFilter === 'positive' && sku.stock <= 0) return false;
      if (stockFilter === 'empty' && sku.stock !== 0) return false;
      if (stockFilter === 'negative' && sku.stock >= 0) return false;
      return !needle || [sku.name, sku.skuNumber, ...sku.aliases].some((value) => value.toLocaleLowerCase('id-ID').includes(needle));
    });
  }, [query, showArchived, state.skus, stockFilter]);

  async function importFile(file?: File) {
    if (!file) return;
    if (!window.confirm('Ganti seluruh data sesi dan kosongkan transaksi demo?')) return;
    try {
      const result = await parseSkuWorkbook(await file.arrayBuffer());
      await gateway.replaceFromWorkbook(result, file.name);
      setMessage(`${result.loaded.toLocaleString('id-ID')} SKU dimuat · ${result.skipped} dilewati`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Import gagal.'); }
    if (fileInput.current) fileInput.current.value = '';
  }

  async function applyAdjustment() {
    if (!adjusting) return;
    await gateway.adjustStock(adjusting.id, Number(quantity));
    setAdjusting(null); setQuantity('');
  }

  function openEdit(sku: Sku) { setEditing(sku); setEditNumber(sku.skuNumber); setEditName(sku.name); setEditNote(sku.note); }
  async function saveEdit() {
    if (!editing) return;
    try { await gateway.updateSku(editing.id, { skuNumber: editNumber, name: editName, note: editNote }); setEditing(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Perubahan gagal disimpan.'); }
  }

  return (
    <div className="feature-page">
      <div className="feature-toolbar">
        <div><strong>{state.skus.length.toLocaleString('id-ID')} SKU</strong><span>{state.sourceLabel}</span></div>
        <div className="toolbar-actions">
          <input ref={fileInput} className="visually-hidden" type="file" accept=".xlsx" aria-label="Import XLSX" onChange={(event) => void importFile(event.target.files?.[0])} />
          <button className="button secondary" onClick={() => fileInput.current?.click()}>Import XLSX</button>
        </div>
      </div>
      {message && <div className="notice" role="status">{message}</div>}
      <div className="filters">
        <label className="search-field"><span>Cari</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nama / nomor SKU / scan QR" /></label>
        <label><span>Stok</span><select value={stockFilter} onChange={(event) => setStockFilter(event.target.value)}><option value="all">Semua</option><option value="positive">Tersedia</option><option value="empty">Kosong</option><option value="negative">Negatif</option></select></label>
        <label><span>Status</span><select value={showArchived ? 'archived' : 'active'} onChange={(event) => setShowArchived(event.target.value === 'archived')}><option value="active">Aktif</option><option value="archived">Diarsipkan</option></select></label>
      </div>
      <div className="table-frame">
        <table><thead><tr><th>Gambar</th><th>Nomor SKU</th><th>Nama SKU</th><th>Harga Referensi</th><th>Stok</th><th>Catatan</th><th>Dibuat</th><th>Aksi</th></tr></thead>
        <tbody>{filtered.slice(0, 50).map((sku) => (
          <tr key={sku.id}>
            <td><SkuImage sku={sku} /></td><td className="sku-number" title={sku.skuNumber}>{sku.skuNumber}</td><td>{sku.name}<small>{sku.tracked ? 'Stok dilacak' : 'Tanpa stok'}</small></td>
            <td>{formatRupiah(sku.referencePrice)}</td><td data-testid={`sku-stock-${sku.id}`} className={`stock-value ${sku.stock < 0 ? 'negative' : ''}`}>{sku.tracked ? sku.stock : '—'}</td><td>{sku.note || '—'}</td><td>{formatDate(sku.createdAt)}</td>
            <td><div className="row-actions">{!sku.archived && <button aria-label={`Edit ${sku.skuNumber}`} onClick={() => openEdit(sku)}>Edit</button>}{sku.tracked && !sku.archived && <button aria-label={`Atur stok ${sku.skuNumber}`} onClick={() => setAdjusting(sku)}>±</button>}<button onClick={() => void gateway.setArchived(sku.id, !sku.archived)}>{sku.archived ? 'Pulihkan' : 'Arsip'}</button></div></td>
          </tr>
        ))}</tbody></table>
        {!filtered.length && <div className="empty-state">Tidak ada SKU yang cocok.</div>}
      </div>
      <div className="table-footer">Menampilkan {Math.min(filtered.length, 50)} dari {filtered.length.toLocaleString('id-ID')}</div>
      {adjusting && <div className="dialog-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="adjust-title"><h2 id="adjust-title">Atur stok</h2><p><strong>{adjusting.skuNumber}</strong> · stok saat ini {adjusting.stock}</p><label><span>Perubahan stok</span><input autoFocus type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><div className="dialog-actions"><button className="button secondary" onClick={() => setAdjusting(null)}>Batal</button><button className="button primary" disabled={!quantity || !Number.isInteger(Number(quantity))} onClick={() => void applyAdjustment()}>Terapkan perubahan</button></div></section></div>}
      {editing && <div className="dialog-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-title"><h2 id="edit-title">Edit SKU</h2><p>Nomor lama akan tetap menjadi alias pencarian.</p><div className="stack-fields"><label><span>Edit nomor SKU</span><input autoFocus value={editNumber} onChange={(event) => setEditNumber(event.target.value)} /></label><label><span>Edit nama SKU</span><input value={editName} onChange={(event) => setEditName(capitalizeSentenceStarts(event.target.value))} /></label><label><span>Edit catatan SKU</span><textarea value={editNote} onChange={(event) => setEditNote(capitalizeSentenceStarts(event.target.value))} /></label></div><div className="dialog-actions"><button className="button secondary" onClick={() => setEditing(null)}>Batal</button><button className="button primary" onClick={() => void saveEdit()}>Simpan perubahan SKU</button></div></section></div>}
    </div>
  );
}
