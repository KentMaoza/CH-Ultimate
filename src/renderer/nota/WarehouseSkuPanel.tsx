import { useMemo, useState, type KeyboardEvent } from 'react';
import type { Sku } from '../../domain/types';
import { formatRupiah } from '../format';

const PAGE_SIZE = 50;

function matchesSku(sku: Sku, query: string) {
  const needle = query.trim().toLocaleLowerCase('id-ID');
  return !needle || [sku.name, sku.skuNumber, ...sku.aliases]
    .some((value) => value.toLocaleLowerCase('id-ID').includes(needle));
}

function SkuThumbnail({ sku }: { sku: Sku }) {
  const [failed, setFailed] = useState(false);
  if (!sku.imageUrl || failed) return <span className="chu-nota-workspace__sku-placeholder" aria-hidden="true">CHU</span>;
  return <img className="chu-nota-workspace__sku-image" src={sku.imageUrl} alt="" onError={() => setFailed(true)} />;
}

export function WarehouseSkuPanel({ skus, targetLabel, disabled, onSelect }: {
  skus: Sku[];
  targetLabel: string;
  disabled: boolean;
  onSelect: (sku: Sku) => void;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [highlight, setHighlight] = useState(-1);
  const filtered = useMemo(() => skus.filter((sku) => !sku.archived && matchesSku(sku, query)), [query, skus]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const items = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const active = highlight >= 0 ? items[highlight] : undefined;

  function updateQuery(value: string) {
    setQuery(value);
    setPage(0);
    setHighlight(-1);
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((value) => Math.min(items.length - 1, value + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((value) => Math.max(0, value - 1));
    } else if (event.key === 'Enter' && active) {
      event.preventDefault();
      onSelect(active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      updateQuery('');
    }
  }

  return <section className="chu-nota-workspace__warehouse" role="region" aria-label="SKU Gudang">
    <header>
      <div><strong>SKU GUDANG</strong><span>Target baris {targetLabel}</span></div>
      <button type="button" aria-label={open ? 'Lipat SKU Gudang' : 'Buka SKU Gudang'} onClick={() => setOpen((value) => !value)}>{open ? 'Lipat' : 'Buka'}</button>
    </header>
    {open && <>
      <div className="chu-nota-workspace__warehouse-tools">
        <input
          type="search"
          role="searchbox"
          aria-label="Cari SKU Gudang"
          aria-controls="warehouse-sku-results"
          aria-activedescendant={active ? `warehouse-sku-${active.id}` : undefined}
          placeholder="Cari nama / nomor SKU / alias"
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
          onKeyDown={keyDown}
        />
        <span>{filtered.length.toLocaleString('id-ID')} SKU aktif</span>
      </div>
      <div id="warehouse-sku-results" className="chu-nota-workspace__warehouse-results" role="listbox" aria-label="Hasil SKU Gudang">
        {items.map((sku, index) => <button
          type="button"
          role="option"
          id={`warehouse-sku-${sku.id}`}
          aria-selected={highlight === index}
          disabled={disabled}
          key={sku.id}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(sku)}
        >
          <SkuThumbnail sku={sku} />
          <span><strong>{sku.skuNumber}</strong><small>{sku.name}</small></span>
          <span><strong>{formatRupiah(sku.referencePrice)}</strong><small>{sku.tracked ? `Stok ${sku.stock}` : 'Stok tidak dilacak'}</small></span>
        </button>)}
        {!items.length && <p>Tidak ada SKU yang cocok.</p>}
      </div>
      <footer>
        <button type="button" disabled={page === 0} onClick={() => { setPage((value) => value - 1); setHighlight(-1); }}>SKU sebelumnya</button>
        <span>{page + 1}/{pages}</span>
        <button type="button" disabled={page + 1 >= pages} onClick={() => { setPage((value) => value + 1); setHighlight(-1); }}>SKU berikutnya</button>
      </footer>
    </>}
  </section>;
}
