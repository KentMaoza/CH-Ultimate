import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

test('mock keeps a stable demo sync snapshot through initialization and listener cleanup', async () => {
  const gateway = new MockOperationsGateway();
  let notifications = 0;
  const unsubscribe = gateway.subscribeSync(() => {
    notifications += 1;
  });

  expect(gateway.capabilities).toEqual({
    canResetDemoData: true,
    canImportInitialCatalogue: true,
    canStageInitialCatalogue: false,
    canManagePackageBarcodes: false,
  });
  expect(gateway.getSyncSnapshot()).toEqual({
    phase: 'demo',
    serverRevision: '0',
    pendingCount: 0,
    conflictCount: 0,
    trustedV2Bootstrap: true,
  });

  await gateway.initialize();
  expect(notifications).toBe(0);

  unsubscribe();
  await gateway.initialize();
  expect(notifications).toBe(0);
});

test('mock supports stock checks and package barcode lifecycle', async () => {
  const gateway = new MockOperationsGateway();

  await gateway.checkStock('sku-1', 8, '  Rak depan  ');

  const checkedSku = gateway.getSnapshot().skus.find((sku) => sku.id === 'sku-1');
  expect(checkedSku?.stock).toBe(8);
  expect(checkedSku?.lastStockCheckedAt).toBeTruthy();
  expect(gateway.getSnapshot().stockChecks).toEqual([
    expect.objectContaining({
      skuId: 'sku-1',
      observedQuantityPcs: 24,
      countedQuantityPcs: 8,
      serverQuantityBeforePcs: 24,
      appliedDeltaPcs: -16,
      forcedOffline: false,
      note: 'Rak depan',
    }),
  ]);

  await gateway.registerPackageBarcode('sku-1', ' 8990000123456 ');
  const identifier = gateway.getSnapshot().skus
    .find((sku) => sku.id === 'sku-1')
    ?.identifiers.find((candidate) => candidate.value === '8990000123456');
  expect(identifier).toEqual(expect.objectContaining({
    skuId: 'sku-1',
    kind: 'package_barcode',
  }));

  await gateway.reassignPackageBarcode(identifier!.id, 'sku-4');
  expect(gateway.getSnapshot().skus.find((sku) => sku.id === 'sku-1')?.aliases).not.toContain('8990000123456');
  expect(gateway.getSnapshot().skus.find((sku) => sku.id === 'sku-4')?.aliases).toContain('8990000123456');

  await gateway.removePackageBarcode(identifier!.id);
  expect(gateway.getSnapshot().skus.flatMap((sku) => sku.identifiers)).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ id: identifier!.id })]),
  );
});
