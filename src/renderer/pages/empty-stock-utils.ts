import type { EmptyStockItem } from '../../domain/types';

export const NO_SUPPLIER = '__none__';

export function supplierCodeFromName(name: string): string | null {
  return name.match(/(?:^|[\s_-])(CH\d+)\s*$/i)?.[1]?.toUpperCase() ?? null;
}

export function filterEmptyStockItems(items: EmptyStockItem[], query: string, supplier: string): EmptyStockItem[] {
  const key = query.trim().toLocaleLowerCase('id-ID');
  return items.filter(({ sku }) => {
    const matchesQuery = !key || sku.name.toLocaleLowerCase('id-ID').includes(key) || sku.skuNumber.toLocaleLowerCase('id-ID').includes(key);
    const code = supplierCodeFromName(sku.name);
    const matchesSupplier = !supplier || (supplier === NO_SUPPLIER ? code === null : code === supplier);
    return matchesQuery && matchesSupplier;
  });
}

export function addFilteredSelection(selected: Set<string>, items: EmptyStockItem[]): Set<string> {
  return new Set([...selected, ...items.map(({ sku }) => sku.id)]);
}
