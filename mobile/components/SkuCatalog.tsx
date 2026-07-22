import { useState } from 'react';
import { searchMobileSkus } from '../../src/domain/mobile-demo-state';
import type { Sku } from '../../src/domain/types';
import { formatRupiah } from '../format';
import { ChevronIcon, SearchIcon } from './Icons';
import { ProductImage } from './ProductImage';

export function SkuCatalog({ skus, onOpenSku, focusSearch }: { skus: Sku[]; onOpenSku: (sku: Sku) => void; focusSearch: boolean }) {
  const [query, setQuery] = useState('');
  const results = searchMobileSkus(skus, query);
  return <section className="page-view">
    <h1 data-page-heading tabIndex={-1}>SKU Gudang</h1>
    <label className="search-field"><SearchIcon /><span className="sr-only">Cari SKU</span><input aria-label="Cari SKU" autoFocus={focusSearch} role="searchbox" placeholder="Cari nama, nomor, atau alias" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /></label>
    <p className="result-count">{results.length} SKU aktif</p>
    <div className="sku-list">
      {results.map((sku) => <button className="sku-row" key={sku.id} onClick={() => onOpenSku(sku)}>
        <ProductImage sku={sku} />
        <span><strong>{sku.name}</strong><small>{sku.skuNumber}</small><b>{formatRupiah(sku.referencePrice)}</b><em>{sku.tracked ? `Stok ${sku.stock}` : 'Stok tidak dilacak'}</em></span>
        <ChevronIcon />
      </button>)}
    </div>
    {results.length === 0 ? <p className="empty-state">Tidak ada SKU aktif yang cocok.</p> : null}
  </section>;
}
