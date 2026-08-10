import { useEffect, useMemo, useState } from 'react';
import { buildEmptyStockItems } from '../../domain/reports';
import { useOperations } from '../operations-context';
import { useOutput } from '../output-context';
import { hydrateOperationalPdfImages } from '../operational-pdf-images';
import { addFilteredSelection, buildEmptyStockPdfPlan, filterEmptyStockItems, NO_SUPPLIER, supplierCodeFromName } from './empty-stock-utils';

const MAX_RESTOCK_QUANTITY = 9_999;
type StockCondition = 'empty' | 'one' | 'two' | 'low';

export function EmptyStockPage({ coreBacked = false }: { coreBacked?: boolean }) {
  const { state, gateway } = useOperations();
  const output = useOutput();
  const items = useMemo(() => buildEmptyStockItems(state, 2), [state]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [supplier, setSupplier] = useState('');
  const [stockCondition, setStockCondition] = useState<StockCondition>('empty');
  const [notice, setNotice] = useState('');
  const supplierCodes = useMemo(() => [...new Set(items.map(({ sku }) => supplierCodeFromName(sku.name)).filter((code): code is string => Boolean(code)))].sort((a, b) => a.localeCompare(b, 'id-ID', { numeric: true })), [items]);
  const stockFiltered = useMemo(() => items.filter(({ sku }) => {
    if (stockCondition === 'one') return sku.stock === 1;
    if (stockCondition === 'two') return sku.stock === 2;
    if (stockCondition === 'low') return true;
    return sku.stock <= 0;
  }), [items, stockCondition]);
  const filtered = useMemo(() => filterEmptyStockItems(stockFiltered, query, supplier), [stockFiltered, query, supplier]);
  const chosen = items.filter((item) => selected.has(item.sku.id));

  useEffect(() => {
    const available = new Set(items.map(({ sku }) => sku.id));
    setSelected((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
    setQuantities((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => available.has(id)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [items]);

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
    if (!checked) setQuantities((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function setRestockQuantity(id: string, rawValue: string | number) {
    const digits = String(rawValue).replace(/\D/g, '');
    const nextValue = Math.min(MAX_RESTOCK_QUANTITY, Number(digits) || 0);
    setQuantities((current) => {
      if (nextValue === 0) {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      return { ...current, [id]: nextValue };
    });
  }

  async function savePdf() {
    if (!chosen.length || output.busy) return;
    setNotice('');
    const generatedDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    try {
      const plan = buildEmptyStockPdfPlan(chosen, quantities, generatedDate);
      const hydrated = await hydrateOperationalPdfImages(plan, state.skus, gateway);
      const result = await output.savePdf(hydrated);
      setNotice(result.status === 'saved'
        ? 'PDF barang kosong berhasil disimpan.'
        : 'Penyimpanan PDF barang kosong dibatalkan.');
    } catch {
      setNotice('PDF barang kosong belum dapat disimpan.');
    }
  }

  return <div className="feature-page empty-layout">
    <section className="empty-list">
      <div className="card-heading"><div><span>TRACKED STOCK ≤ 2</span><h2>Daftar stok menipis</h2></div><div><button className="button secondary" onClick={() => setSelected((current) => addFilteredSelection(current, filtered))}>Pilih semua hasil filter</button><button className="button primary" aria-label="Simpan PDF barang kosong" disabled={!chosen.length || output.busy} onClick={() => void savePdf()}>{output.busy ? 'Menyimpan PDF…' : 'Simpan PDF'}</button></div></div>
      {notice ? <p className="action-status" role="status">{notice}</p> : null}
      <div className="empty-filters"><label><span>Cari nama / nomor SKU</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari barang" /></label><label><span>Supplier</span><select value={supplier} onChange={(event) => setSupplier(event.target.value)}><option value="">Semua supplier</option>{supplierCodes.map((code) => <option key={code} value={code}>{code}</option>)}<option value={NO_SUPPLIER}>Tanpa kode supplier</option></select></label><label><span>Kondisi stok</span><select value={stockCondition} onChange={(event) => setStockCondition(event.target.value as StockCondition)}><option value="empty">Kosong / negatif</option><option value="one">Sisa 1 pcs</option><option value="two">Sisa 2 pcs</option><option value="low">Semua ≤ 2 pcs</option></select></label></div>
      <p className="empty-filter-count">{filtered.length} dari {stockFiltered.length} barang pada kondisi ini</p>
      <div className="empty-groups">{filtered.map(({ sku }) => {
        return <div key={sku.id} className="empty-row">
          <input aria-label={`Pilih ${sku.skuNumber}`} type="checkbox" checked={selected.has(sku.id)} onChange={(event) => toggle(sku.id, event.currentTarget.checked)} />
          <div className="image-placeholder">CHU</div>
          <div><strong>{sku.skuNumber}</strong><span>{sku.name}</span></div>
          <b className="empty-balance">{sku.stock}</b>
        </div>;
      })}{!filtered.length && <p className="empty-state">Tidak ada barang yang cocok dengan filter.</p>}</div>
    </section>
    <section className="a4-preview" data-testid="empty-report-preview"><header><div className="brand-mark dark">CHU</div><div><strong>LAPORAN BARANG KOSONG</strong><span>{new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Makassar' }).format(new Date())}</span></div></header>{chosen.length ? chosen.map(({ sku }) => {
      const quantity = quantities[sku.id] ?? 0;
      return <div className="report-item" key={sku.id}><div className="image-placeholder">CHU</div><div><strong>{sku.skuNumber}</strong><span>{sku.name}</span><small>Stok saat ini: {sku.stock}</small></div><div className="report-restock"><b>Jumlah: {quantity}</b><div><button type="button" aria-label={`Kurangi jumlah restock ${sku.skuNumber}`} disabled={quantity === 0} onClick={() => setRestockQuantity(sku.id, quantity - 1)}>−</button><input aria-label={`Jumlah restock ${sku.skuNumber}`} inputMode="numeric" value={quantity} onChange={(event) => setRestockQuantity(sku.id, event.target.value)} /><button type="button" aria-label={`Tambah jumlah restock ${sku.skuNumber}`} disabled={quantity === MAX_RESTOCK_QUANTITY} onClick={() => setRestockQuantity(sku.id, quantity + 1)}>+</button></div></div></div>;
    }) : <p className="preview-empty">Pilih SKU untuk menampilkan preview laporan.</p>}<footer>CH Ultimate · {coreBacked ? 'Data CH Core' : 'Demo preview'} · PDF siap disimpan</footer></section>
  </div>;
}
