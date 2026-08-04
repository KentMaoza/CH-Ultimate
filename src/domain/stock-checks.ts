import type { Sku, StockCheck } from './types';

function normalizedIdentifier(value: string): string {
  return value.trim().toLocaleLowerCase('id-ID');
}

function latestCountedAt(checks: StockCheck[], sku: Sku): string | undefined {
  let latest = sku.lastStockCheckedAt;
  for (const check of checks) {
    if (check.skuId !== sku.id) continue;
    if (!latest || Date.parse(check.countedAt) > Date.parse(latest)) {
      latest = check.countedAt;
    }
  }
  return latest;
}

export function selectStockCheckSkus(skus: Sku[], checks: StockCheck[]) {
  return skus
    .filter((sku) => !sku.archived)
    .map((sku) => ({ sku, lastCountedAt: latestCountedAt(checks, sku) }))
    .sort((left, right) => {
      if (!left.lastCountedAt && right.lastCountedAt) return -1;
      if (left.lastCountedAt && !right.lastCountedAt) return 1;
      const countedOrder = (left.lastCountedAt ? Date.parse(left.lastCountedAt) : 0)
        - (right.lastCountedAt ? Date.parse(right.lastCountedAt) : 0);
      return countedOrder || left.sku.skuNumber.localeCompare(
        right.sku.skuNumber,
        'id-ID',
        { numeric: true },
      );
    });
}

export function resolveSkuByIdentifier(skus: Sku[], rawCode: string): Sku | null {
  const code = normalizedIdentifier(rawCode);
  if (!code) return null;
  return skus.find((sku) => normalizedIdentifier(sku.skuNumber) === code)
    ?? skus.find((sku) => sku.identifiers.some(
      (identifier) => normalizedIdentifier(identifier.value) === code,
    ))
    ?? skus.find((sku) => sku.aliases.some(
      (alias) => normalizedIdentifier(alias) === code,
    ))
    ?? null;
}

export function formatStockCheckWita(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `${value} WITA`;
  return `${new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Makassar',
  }).format(date).replace('.', ':')} WITA`;
}
