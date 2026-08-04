import type { Sku, SkuPriceChange } from '../../src/domain/types';
import type { OperationsGateway } from '../../src/gateway/operations-gateway';
import { formatRupiah, formatWita } from '../format';
import { ChevronIcon } from './Icons';
import { ProductImage } from './ProductImage';

export function PriceChangeList({
  changes,
  gateway,
  skus,
  onOpenSku,
  testId,
}: {
  changes: SkuPriceChange[];
  gateway: OperationsGateway;
  skus: Sku[];
  onOpenSku: (sku: Sku) => void;
  testId?: string;
}) {
  const skuMap = new Map(skus.map((sku) => [sku.id, sku]));
  return <div className="price-list" data-testid={testId}>
    {changes.map((change) => {
      const sku = skuMap.get(change.skuId);
      if (!sku) return null;
      const direction = change.after > change.before ? 'naik' : change.after < change.before ? 'turun' : 'tetap';
      const priceDescription = `Harga ${direction}. Harga lama ${formatRupiah(change.before)}. Harga baru ${formatRupiah(change.after)}.`;
      const descriptionId = `price-change-${change.id}-description`;
      return <button aria-describedby={descriptionId} className="price-row" key={change.id} onClick={() => onOpenSku(sku)}>
        <ProductImage gateway={gateway} sku={sku} />
        <span className="price-row-copy">
          <strong>{sku.name}</strong>
          <span className="sku-code">SKU: {sku.skuNumber}</span>
          <span aria-hidden="true" className="price-pair"><s>{formatRupiah(change.before)}</s><span>→</span><b>{formatRupiah(change.after)}</b></span>
          <span className="sr-only" id={descriptionId}>{priceDescription}</span>
        </span>
        <span className="price-row-time">{formatWita(change.createdAt)}</span>
        <ChevronIcon className="row-chevron" />
      </button>;
    })}
  </div>;
}
