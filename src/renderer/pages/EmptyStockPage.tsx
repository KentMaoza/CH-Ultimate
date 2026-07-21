import { useMemo, useState } from 'react';
import { buildEmptyStockItems } from '../../domain/reports';
import { useOperations } from '../operations-context';

export function EmptyStockPage() {
  const { state } = useOperations();
  const items = useMemo(() => buildEmptyStockItems(state), [state]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const chosen = items.filter((item) => selected.has(item.sku.id));
  function toggle(id: string) { setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
  return <div className="feature-page empty-layout"><section className="empty-list"><div className="card-heading"><div><span>TRACKED STOCK ≤ 0</span><h2>Daftar barang kosong</h2></div><button className="button secondary" onClick={() => setSelected(new Set(items.map((item) => item.sku.id)))}>Pilih semua</button></div>
    <div className="empty-groups">{items.map(({ sku }) => <label key={sku.id} className="empty-row"><input aria-label={`Pilih ${sku.skuNumber}`} type="checkbox" checked={selected.has(sku.id)} onChange={() => toggle(sku.id)} /><div className="image-placeholder">CHU</div><div><strong>{sku.skuNumber}</strong><span>{sku.name}</span></div><b className="empty-balance">{sku.stock}</b></label>)}</div>
  </section><section className="a4-preview" data-testid="empty-report-preview"><header><div className="brand-mark dark">CHU</div><div><strong>RANGKUMAN BARANG KOSONG</strong><span>{new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Makassar' }).format(new Date())}</span></div></header>{chosen.length ? chosen.map(({ sku }) => <div className="report-item" key={sku.id}><div className="image-placeholder">CHU</div><div><strong>{sku.skuNumber}</strong><span>{sku.name}</span></div></div>) : <p className="preview-empty">Pilih SKU untuk menampilkan preview laporan.</p>}<footer>CH Ultimate · Demo preview · Export PDF belum aktif</footer></section></div>;
}
