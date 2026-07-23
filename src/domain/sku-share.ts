import type { Sku } from './types';

export function formatSkuShareText(sku: Sku): string {
  const price = `Rp${Math.round(sku.referencePrice).toLocaleString('id-ID')}`;
  return `${sku.name}\nSKU: ${sku.skuNumber}\nHarga referensi: ${price}`;
}
