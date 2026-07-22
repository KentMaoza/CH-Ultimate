import { useState } from 'react';
import type { Sku } from '../../src/domain/types';
import { BoxIcon } from './Icons';

export function ProductImage({ sku }: { sku: Sku }) {
  const [failed, setFailed] = useState(false);
  if (!sku.imageUrl || failed) {
    return <span className="product-image product-image-fallback" data-testid={`image-fallback-${sku.id}`}><BoxIcon /></span>;
  }
  return <img alt="" className="product-image" src={sku.imageUrl} onError={() => setFailed(true)} />;
}
