import { useMemo, useState } from 'react';
import { buildEmptyStockItems } from '../../domain/reports';
import { useOperations } from '../operations-context';
import { addFilteredSelection, filterEmptyStockItems, NO_SUPPLIER, supplierCodeFromName } from './empty-stock-utils';

export function EmptyStockPage() {
  const { state } = useOperations();
  const items = useMemo(() => buildEmptyStockItems(state), [state]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [supplier, setSupplier] = useState('');
  const supplierCodes = useMemo(() => [...new Set(items.map(({ sku }) => supplierCodeFromName(sku.name)).filter((code): code is string => Boolean(code)))].sort((a, b) => a.localeCompare(b, 'id-ID', { numeric: true })), [items]);
  const filtered = useMemo(() => filterEmptyStockItems(items, query, supplier), [items, query, supplier]);
  const chosen = items.filter((item) => selected.has(item.sku.id));
  function toggle(id: string) { setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
  return <div className="feature-page empty-layout"><section className="empty-list"><div className="card-heading"><div><span>TRACKED STOCK ≤ 0</span><h2>Daftar barang kosong</h2></div><button className="button secondary" onClick={() => setSelected((current) => addFilteredSelection(current, filtered))}>Pilih semua hasil filter</button></div>
    <div className="empty-filters"><label><span>Cari nama / nomor SKU</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari barang kosong" /></label><label><span>Supplier</span><select value={supplier} onChange={(event) => setSupplier(event.target.value)}><option value="">Semua supplier</option>{supplierCodes.map((code) => <option key={code} value={code}>{code}</option>)}<option value={NO_SUPPLIER}>Tanpa kode supplier</option></select></label></div>
    <p className="empty-filter-count">{filtered.length} dari {items.length} barang</p>
    <div className="empty-groups">{filtered.map(({ sku }) => <label key={sku.id} className="empty-row"><input aria-label={`Pilih ${sku.skuNumber}`} type="checkbox" checked={selected.has(sku.id)} onChange={() => toggle(sku.id)} /><div className="image-placeholder">CHU</div><div><strong>{sku.skuNumber}</strong><span>{sku.name}</span></div><b className="empty-balance">{sku.stock}</b></label>)}{!filtered.length && <p className="empty-state">Tidak ada barang yang cocok dengan filter.</p>}</div>
  </section><section className="a4-preview" data-testid="empty-report-preview"><header><div className="brand-mark dark">CHU</div><div><strong>RANGKUMAN BARANG KOSONG</strong><span>{new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Makassar' }).format(new Date())}</span></div></header>{chosen.length ? chosen.map(({ sku }) => <div className="report-item" key={sku.id}><div className="image-placeholder">CHU</div><div><strong>{sku.skuNumber}</strong><span>{sku.name}</span></div></div>) : <p className="preview-empty">Pilih SKU untuk menampilkan preview laporan.</p>}<footer>CH Ultimate · Demo preview · Export PDF belum aktif</footer></section></div>;
}
