import { useEffect, useMemo, useState } from 'react';
import { buildRestockRecommendationDocumentPlan } from '../../domain/restock-recommendation-document';
import {
  buildRestockRecommendationReport,
  type RestockRecommendationItem,
  type RestockRecommendationRank,
} from '../../domain/restock-recommendations';
import { buildEmptyStockItems } from '../../domain/reports';
import type { Sku } from '../../domain/types';
import { useOperations } from '../operations-context';
import { useOutput } from '../output-context';
import { hydrateOperationalPdfImages } from '../operational-pdf-images';
import { hydrateRestockRecommendationImages } from '../restock-recommendation-images';
import {
  addFilteredSelection,
  buildEmptyStockPdfPlan,
  filterEmptyStockItems,
  NO_SUPPLIER,
  supplierCodeFromName,
} from './empty-stock-utils';

const MAX_RESTOCK_QUANTITY = 9_999;
type StockCondition = 'empty' | 'one' | 'two' | 'low';

const RANK_COPY: Record<RestockRecommendationRank, string> = {
  green: 'Laris dan cepat terjual',
  yellow: 'Penjualan biasa',
  red: 'Lambat terjual',
};

function matchesSupplier(sku: Sku, supplier: string): boolean {
  const code = supplierCodeFromName(sku.name);
  return !supplier || (supplier === NO_SUPPLIER ? code === null : code === supplier);
}

function matchesQuery(sku: Sku, query: string): boolean {
  const key = query.trim().toLocaleLowerCase('id-ID');
  return !key || sku.name.toLocaleLowerCase('id-ID').includes(key) ||
    sku.skuNumber.toLocaleLowerCase('id-ID').includes(key);
}

function groupSelectedSkus(skus: Sku[]): Array<{ supplierCode: string | null; skus: Sku[] }> {
  const groups = new Map<string | null, Sku[]>();
  for (const sku of skus) {
    const supplierCode = supplierCodeFromName(sku.name);
    groups.set(supplierCode, [...(groups.get(supplierCode) ?? []), sku]);
  }
  return [...groups]
    .sort(([left], [right]) => {
      if (left === null) return 1;
      if (right === null) return -1;
      return left.localeCompare(right, 'id-ID', { numeric: true });
    })
    .map(([supplierCode, groupedSkus]) => ({ supplierCode, skus: groupedSkus }));
}

function recommendationReason(item: RestockRecommendationItem): string {
  if (item.recommendedQuantity === 0) return 'Stok saat ini mencukupi';
  if (item.reasons.length === 2) return 'Stok kosong dan top seller';
  if (item.reasons.includes('top-seller')) return 'Top seller 30 hari';
  return 'Stok kosong, pernah terjual';
}

export function EmptyStockPage({ coreBacked = false }: { coreBacked?: boolean }) {
  const { state, gateway } = useOperations();
  const output = useOutput();
  const items = useMemo(() => buildEmptyStockItems(state, 2), [state]);
  const recommendationReport = useMemo(
    () => buildRestockRecommendationReport(state),
    [state],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [supplier, setSupplier] = useState('');
  const [stockCondition, setStockCondition] = useState<StockCondition>('empty');
  const [notice, setNotice] = useState('');
  const recommendationById = useMemo(
    () => new Map(recommendationReport.items.map((item) => [item.sku.id, item])),
    [recommendationReport],
  );
  const supplierCodes = useMemo(() => [...new Set([
    ...items.map(({ sku }) => supplierCodeFromName(sku.name)),
    ...recommendationReport.items.map((item) => item.supplierCode),
  ].filter((code): code is string => Boolean(code)))].sort((left, right) =>
    left.localeCompare(right, 'id-ID', { numeric: true })), [items, recommendationReport]);
  const stockFiltered = useMemo(() => items.filter(({ sku }) => {
    if (stockCondition === 'one') return sku.stock === 1;
    if (stockCondition === 'two') return sku.stock === 2;
    if (stockCondition === 'low') return true;
    return sku.stock <= 0;
  }), [items, stockCondition]);
  const filtered = useMemo(
    () => filterEmptyStockItems(stockFiltered, query, supplier),
    [stockFiltered, query, supplier],
  );
  const filteredRecommendationGroups = useMemo(() => recommendationReport.groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        matchesQuery(item.sku, query) && matchesSupplier(item.sku, supplier)),
    }))
    .filter((group) => group.items.length > 0), [query, recommendationReport, supplier]);
  const filteredRecommendations = useMemo(
    () => filteredRecommendationGroups.flatMap((group) => group.items),
    [filteredRecommendationGroups],
  );
  const chosenAll = state.skus.filter((sku) => selected.has(sku.id));
  const chosen = chosenAll.filter((sku) => matchesSupplier(sku, supplier));
  const chosenGroups = groupSelectedSkus(chosen);
  const chosenRecommendations = recommendationReport.items.filter((item) =>
    selected.has(item.sku.id) && matchesSupplier(item.sku, supplier));
  const printableRecommendations = chosenRecommendations.filter((item) =>
    (quantities[item.sku.id] ?? 0) > 0);
  const hiddenSelectionCount = chosenAll.length - chosen.length;

  useEffect(() => {
    const available = new Set([
      ...items.map(({ sku }) => sku.id),
      ...recommendationReport.items.map(({ sku }) => sku.id),
    ]);
    setSelected((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
    setQuantities((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => available.has(id)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [items, recommendationReport]);

  function toggle(id: string, checked: boolean, defaultQuantity?: number) {
    setSelected((current) => {
      const next = new Set(current);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
    if (checked && defaultQuantity !== undefined) {
      setQuantities((current) => id in current
        ? current
        : { ...current, [id]: defaultQuantity });
    }
    if (!checked) setQuantities((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function addAllFilteredRecommendations() {
    setSelected((current) => new Set([
      ...current,
      ...filteredRecommendations.map((item) => item.sku.id),
    ]));
    setQuantities((current) => ({
      ...Object.fromEntries(filteredRecommendations.map((item) => [
        item.sku.id,
        current[item.sku.id] ?? item.recommendedQuantity,
      ])),
      ...current,
    }));
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

  function generatedDate(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }

  async function savePdf() {
    if (!chosen.length || output.busy) return;
    setNotice('');
    try {
      const plan = buildEmptyStockPdfPlan(
        chosen.map((sku) => ({ sku, selected: true })),
        quantities,
        generatedDate(),
      );
      const hydrated = await hydrateOperationalPdfImages(plan, state.skus, gateway);
      const result = await output.savePdf(hydrated);
      setNotice(result.status === 'saved'
        ? 'PDF barang kosong berhasil disimpan.'
        : 'Penyimpanan PDF barang kosong dibatalkan.');
    } catch {
      setNotice('PDF barang kosong belum dapat disimpan.');
    }
  }

  async function saveRecommendationPdf() {
    if (!printableRecommendations.length || output.busy) return;
    setNotice('');
    try {
      const plan = buildRestockRecommendationDocumentPlan(
        printableRecommendations,
        quantities,
        generatedDate(),
      );
      const hydrated = await hydrateRestockRecommendationImages(plan, state.skus, gateway);
      const result = await output.savePdf(hydrated);
      setNotice(result.status === 'saved'
        ? 'PDF rekomendasi restock berhasil disimpan.'
        : 'Penyimpanan PDF rekomendasi restock dibatalkan.');
    } catch {
      setNotice('PDF rekomendasi restock belum dapat disimpan.');
    }
  }

  return <div className="feature-page empty-layout">
    <div className="empty-workspace-list">
      <section className="restock-recommendations" data-testid="restock-recommendations">
        <div className="card-heading">
          <div><span>HISTORI STOK + NOTA</span><h2>Rekomendasi Restock</h2></div>
          <div>
            <button className="button secondary" disabled={!filteredRecommendations.length} onClick={addAllFilteredRecommendations}>Masukkan semua rekomendasi hasil filter</button>
            <button className="button primary" aria-label="Simpan PDF rekomendasi restock" disabled={!printableRecommendations.length || output.busy} onClick={() => void saveRecommendationPdf()}>{output.busy ? 'Menyimpan PDF…' : 'Simpan PDF rekomendasi'}</button>
          </div>
        </div>
        <p className="restock-explanation">Gabungan stok kosong yang terjual 60 hari terakhir dan top seller 30 hari. Pemilihan laporan tidak mengubah stok gudang.</p>
        {filteredRecommendationGroups.map((group) => <section className="restock-supplier-group" key={group.supplierCode ?? 'none'}>
          <h3>{group.supplierCode ? `Supplier ${group.supplierCode}` : 'Tanpa kode supplier'}</h3>
          <div className="restock-recommendation-grid">{group.items.map((item) => <article className={`restock-recommendation-card rank-${item.rank}`} key={item.sku.id}>
            <div className="image-placeholder">CHU</div>
            <div className="restock-recommendation-copy">
              <strong>{item.sku.name}</strong>
              <span>{item.sku.skuNumber} · Stok {item.sku.stock} pcs</span>
              <span>{item.soldPieces30 > 0 ? `Terjual ${item.soldPieces30} pcs · 30 hari` : `Terjual ${item.soldPieces60} pcs · 60 hari`}</span>
              <small>{recommendationReason(item)}</small>
            </div>
            <div className="restock-recommendation-action">
              <b className={`rank-badge rank-${item.rank}`}>{RANK_COPY[item.rank]}</b>
              <span>Saran {item.recommendedQuantity} pcs</span>
              <button type="button" className="button secondary" disabled={selected.has(item.sku.id)} aria-label={`Masukkan ${item.sku.skuNumber} ke laporan`} onClick={() => toggle(item.sku.id, true, item.recommendedQuantity)}>{selected.has(item.sku.id) ? 'Sudah masuk' : 'Masukkan'}</button>
            </div>
          </article>)}</div>
        </section>)}
        {!filteredRecommendations.length && <p className="empty-state">Belum ada rekomendasi yang cocok dengan filter.</p>}
      </section>

      <section className="empty-list">
        <div className="card-heading"><div><span>TRACKED STOCK ≤ 2</span><h2>Daftar stok menipis</h2></div><div><button className="button secondary" onClick={() => setSelected((current) => addFilteredSelection(current, filtered))}>Pilih semua hasil filter</button><button className="button primary" aria-label="Simpan PDF barang kosong" disabled={!chosen.length || output.busy} onClick={() => void savePdf()}>{output.busy ? 'Menyimpan PDF…' : 'Simpan PDF'}</button></div></div>
        {notice ? <p className="action-status" role="status">{notice}</p> : null}
        <div className="empty-filters"><label><span>Cari nama / nomor SKU</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari barang" /></label><label><span>Supplier</span><select value={supplier} onChange={(event) => setSupplier(event.target.value)}><option value="">Semua supplier</option>{supplierCodes.map((code) => <option key={code} value={code}>{code}</option>)}<option value={NO_SUPPLIER}>Tanpa kode supplier</option></select></label><label><span>Kondisi stok</span><select value={stockCondition} onChange={(event) => setStockCondition(event.target.value as StockCondition)}><option value="empty">Kosong / negatif</option><option value="one">Sisa 1 pcs</option><option value="two">Sisa 2 pcs</option><option value="low">Semua ≤ 2 pcs</option></select></label></div>
        <p className="empty-filter-count">{filtered.length} dari {stockFiltered.length} barang pada kondisi ini</p>
        <div className="empty-groups">{filtered.map(({ sku }) => <div key={sku.id} className="empty-row">
          <input aria-label={`Pilih ${sku.skuNumber}`} type="checkbox" checked={selected.has(sku.id)} onChange={(event) => toggle(sku.id, event.currentTarget.checked, recommendationById.get(sku.id)?.recommendedQuantity)} />
          <div className="image-placeholder">CHU</div>
          <div><strong>{sku.skuNumber}</strong><span>{sku.name}</span></div>
          <b className="empty-balance">{sku.stock}</b>
        </div>)}{!filtered.length && <p className="empty-state">Tidak ada barang yang cocok dengan filter.</p>}</div>
      </section>
    </div>

    <section className="a4-preview" data-testid="empty-report-preview">
      <header><div className="brand-mark dark">CHU</div><div><strong>LAPORAN BARANG KOSONG</strong><span>{new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Makassar' }).format(new Date())}</span></div></header>
      {hiddenSelectionCount > 0 ? <p className="selection-outside-filter">{hiddenSelectionCount} dipilih di luar filter</p> : null}
      {chosen.length ? chosenGroups.map((group) => <section className="report-supplier-group" key={group.supplierCode ?? 'none'}>
        <h3>{group.supplierCode ? `Supplier ${group.supplierCode}` : 'Tanpa kode supplier'}</h3>
        {group.skus.map((sku) => {
          const quantity = quantities[sku.id] ?? 0;
          return <div className="report-item" key={sku.id}><div className="image-placeholder">CHU</div><div><strong>{sku.skuNumber}</strong><span>{sku.name}</span><small>Stok saat ini: {sku.stock}</small></div><div className="report-restock"><b>Jumlah: {quantity}</b><div><button type="button" aria-label={`Kurangi jumlah restock ${sku.skuNumber}`} disabled={quantity === 0} onClick={() => setRestockQuantity(sku.id, quantity - 1)}>−</button><input aria-label={`Jumlah restock ${sku.skuNumber}`} inputMode="numeric" value={quantity} onChange={(event) => setRestockQuantity(sku.id, event.target.value)} /><button type="button" aria-label={`Tambah jumlah restock ${sku.skuNumber}`} disabled={quantity === MAX_RESTOCK_QUANTITY} onClick={() => setRestockQuantity(sku.id, quantity + 1)}>+</button></div><button type="button" className="report-remove" aria-label={`Keluarkan ${sku.skuNumber} dari laporan`} onClick={() => toggle(sku.id, false)}>Keluarkan dari laporan</button></div></div>;
        })}
      </section>) : <p className="preview-empty">Pilih SKU untuk menampilkan preview laporan.</p>}
      <footer>CH Ultimate · {coreBacked ? 'Data CH Core' : 'Demo preview'} · PDF siap disimpan</footer>
    </section>
  </div>;
}
