import { createInitialState } from './operations';
import type { DemoState, Sku } from './types';

const mobileAliases: Record<string, string[]> = {
  'sku-1': ['BRS-108', 'BERAS-HITAM-1KG'],
  'sku-2': ['KEM-LINEN-PUTIH', 'FSH-001'],
  'sku-3': ['AKS-SILVER'],
  'sku-4': ['MINUMAN-COKELAT'],
  'sku-5': ['SNACK-PISANG'],
  'sku-6': ['DRESS-MERAH'],
};

const mobileImagePaths: Record<string, string> = {
  'sku-1': '/assets/mobile/beras-hitam-premium.svg',
  'sku-2': '/assets/mobile/kemeja-linen-putih.svg',
  'sku-3': '/assets/mobile/aksesori-silver.svg',
  'sku-4': '/assets/mobile/gambar-tidak-tersedia.svg',
  'sku-5': '/assets/mobile/keripik-pisang-original.svg',
  'sku-6': '/assets/mobile/dress-katun-merah.svg',
};

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('id-ID');
}

export function createMobileDemoState(): DemoState {
  const initial = createInitialState();
  return {
    ...initial,
    skus: initial.skus.map((sku) => ({
      ...sku,
      aliases: mobileAliases[sku.id] ?? [],
      imageUrl: mobileImagePaths[sku.id] ?? '',
      createdAt: '2026-07-22T08:00:00+08:00',
      archived: sku.id === 'sku-4',
    })),
    priceChanges: [
      { id: 'mobile-price-1', skuId: 'sku-1', before: 39_000, after: 42_000, createdAt: '2026-07-21T10:15:00+08:00' },
      { id: 'mobile-price-2', skuId: 'sku-6', before: 230_000, after: 245_000, createdAt: '2026-07-22T07:45:00+08:00' },
    ],
    sourceLabel: 'Fixture sintetis mobile',
  };
}

export function findSkuByScanCode(skus: Sku[], rawCode: string): Sku | null {
  const code = normalized(rawCode);
  if (!code) return null;
  return skus.find((sku) => normalized(sku.skuNumber) === code)
    ?? skus.find((sku) => sku.aliases.some((alias) => normalized(alias) === code))
    ?? null;
}

export function searchMobileSkus(skus: Sku[], query: string): Sku[] {
  const needle = normalized(query);
  return skus.filter((sku) => !sku.archived && (!needle || [sku.name, sku.skuNumber, ...sku.aliases]
    .some((value) => normalized(value).includes(needle))));
}
