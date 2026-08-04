import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { createMobileDemoState, findSkuByScanCode, searchMobileSkus } from '../../src/domain/mobile-demo-state';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

test('mobile demo state keeps the six synthetic SKUs with deterministic mobile details', () => {
  const state = createMobileDemoState();

  expect(state.skus).toHaveLength(6);
  expect(state.skus.map((sku) => sku.id)).toEqual(['sku-1', 'sku-2', 'sku-3', 'sku-4', 'sku-5', 'sku-6']);
  expect(state.skus.find((sku) => sku.id === 'sku-1')).toMatchObject({
    aliases: ['BRS-108', 'BERAS-HITAM-1KG'],
    imageUrl: '/assets/mobile/beras-hitam-premium.svg',
    createdAt: '2026-07-22T08:00:00+08:00',
  });
  expect(state.skus.filter((sku) => sku.archived).map((sku) => sku.id)).toEqual(['sku-4']);
  expect(state.skus.some((sku) => sku.imageUrl === '/assets/mobile/gambar-tidak-tersedia.svg')).toBe(true);
  expect(state.skus.filter((sku) => sku.imageUrl !== '/assets/mobile/gambar-tidak-tersedia.svg')
    .every((sku) => sku.imageUrl.endsWith('.svg'))).toBe(true);
  expect(state.skus.filter((sku) => sku.imageUrl !== '/assets/mobile/gambar-tidak-tersedia.svg')
    .every((sku) => existsSync(resolve(process.cwd(), 'public', `.${sku.imageUrl}`)))).toBe(true);
  expect(state.priceChanges).toEqual([
    { id: 'mobile-price-1', skuId: 'sku-1', before: 39_000, after: 42_000, createdAt: '2026-07-21T10:15:00+08:00', source: 'manual' },
    { id: 'mobile-price-2', skuId: 'sku-6', before: 230_000, after: 245_000, createdAt: '2026-07-22T07:45:00+08:00', source: 'manual' },
  ]);
});

test('mobile demo state creates independent SKU alias collections', () => {
  const firstState = createMobileDemoState();
  firstState.skus.find((sku) => sku.id === 'sku-1')!.aliases.push('ALIAS-BOCOR');

  expect(createMobileDemoState().skus.find((sku) => sku.id === 'sku-1')!.aliases)
    .toEqual(['BRS-108', 'BERAS-HITAM-1KG']);
});

test('scan lookup normalizes text and prefers a current SKU number over an alias', () => {
  const state = createMobileDemoState();
  const longCode = `SKU-${'X'.repeat(120)}`;
  const withCollision = state.skus.map((sku) => sku.id === 'sku-1'
    ? { ...sku, aliases: [...sku.aliases, longCode] }
    : sku.id === 'sku-2' ? { ...sku, skuNumber: longCode } : sku);

  expect(findSkuByScanCode(withCollision, `  ${longCode.toLocaleLowerCase('id-ID')}  `)?.id).toBe('sku-2');
  expect(findSkuByScanCode(state.skus, '  brs-108  ')?.id).toBe('sku-1');
  expect(findSkuByScanCode(state.skus, 'mnm-002')?.id).toBe('sku-4');
  expect(findSkuByScanCode(state.skus, '   ')).toBeNull();
  expect(findSkuByScanCode(state.skus, 'tidak-ada')).toBeNull();
});

test('mobile search matches partial names, numbers, and aliases without archived SKUs', () => {
  const state = createMobileDemoState();

  expect(searchMobileSkus(state.skus, 'ber')).toMatchObject([{ id: 'sku-1' }]);
  expect(searchMobileSkus(state.skus, 'linEN-wht')).toMatchObject([{ id: 'sku-2' }]);
  expect(searchMobileSkus(state.skus, 'dress-mer')).toMatchObject([{ id: 'sku-6' }]);
  expect(searchMobileSkus(state.skus, 'cokelat')).toEqual([]);
  expect(searchMobileSkus(state.skus, '')).toHaveLength(5);
});

test('mock gateway keeps the desktop seed by default and reuses an injected seed on reset', async () => {
  const desktopGateway = new MockOperationsGateway();
  const mobileGateway = new MockOperationsGateway(createMobileDemoState);

  expect(desktopGateway.getSnapshot().sourceLabel).toBe('Fixture sintetis');
  expect(desktopGateway.getSnapshot().skus.every((sku) => !sku.archived)).toBe(true);
  expect(mobileGateway.getSnapshot().sourceLabel).toBe('Fixture sintetis mobile');
  await mobileGateway.setArchived('sku-1', true);
  await mobileGateway.reset();
  expect(mobileGateway.getSnapshot().skus.filter((sku) => sku.archived).map((sku) => sku.id)).toEqual(['sku-4']);
});
