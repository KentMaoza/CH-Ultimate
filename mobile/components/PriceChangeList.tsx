import type { Sku, SkuPriceChange } from '../../src/domain/types';
import { formatRupiah, formatWita } from '../format';
import { ChevronIcon } from './Icons';
import { ProductImage } from './ProductImage';

export function PriceChangeList({
  changes,
  skus,
  onOpenSku,
  testId,
}: {
  changes: SkuPriceChange[];
  skus: Sku[];
  onOpenSku: (sku: Sku) => void;
  testId?: string;
}) {
  const skuMap = new Map(skus.map((sku) => [sku.id, sku]));
  return <div className="price-list" data-testid={testId}>
    {changes.map((change) => {
      const sku = skuMap.get(change.skuId);
      if (!sku) return null;
      return <button className="price-row" key={change.id} onClick={() => onOpenSku(sku)}>
        <ProductImage sku={sku} />
        <span className="price-row-copy">
          <strong>{sku.name}</strong>
          <span className="sku-code">SKU: {sku.skuNumber}</span>
          <span className="price-pair"><s>{formatRupiah(change.before)}</s><span aria-hidden="true">→</span><b>{formatRupiah(change.after)}</b></span>
        </span>
        <span className="price-row-time">{formatWita(change.createdAt)}</span>
        <ChevronIcon className="row-chevron" />
      </button>;
    })}
  </div>;
}
