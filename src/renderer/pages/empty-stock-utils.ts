import type { EmptyStockItem } from '../../domain/types';
import type { OperationalPdfPlan } from '../../domain/operational-exports';

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

export function buildEmptyStockPdfPlan(
  items: EmptyStockItem[],
  quantities: Record<string, number>,
  generatedDate: string,
): OperationalPdfPlan {
  const rows = items.map(({ sku }) => ({
    id: sku.id,
    skuId: sku.id,
    cells: [sku.skuNumber, sku.name, sku.stock, quantities[sku.id] ?? 0],
  }));
  return {
    kind: 'operational-data',
    dataset: 'sku-stock',
    title: 'Laporan Barang Kosong',
    headers: ['Nomor SKU', 'Nama Barang', 'Stok Saat Ini', 'Jumlah Restock'],
    rows,
    totalMatched: rows.length,
    totalIncluded: rows.length,
    generatedDate,
    widthMm: 297,
    heightMm: 210,
    fileName: `CHU-Laporan-Barang-Kosong-${generatedDate}.pdf`,
  };
}
