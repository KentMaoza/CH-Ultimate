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
  });
  expect(gateway.getSyncSnapshot()).toEqual({
    phase: 'demo',
    serverRevision: '0',
    pendingCount: 0,
    conflictCount: 0,
  });

  await gateway.initialize();
  expect(notifications).toBe(0);

  unsubscribe();
  await gateway.initialize();
  expect(notifications).toBe(0);
});
