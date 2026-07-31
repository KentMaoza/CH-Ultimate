import { expect, it } from 'vitest';

import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import {
  MemoryStorage,
  ScriptedTransport,
  TestClock,
} from './core-gateway-test-support';

it('treats an incompatible bootstrap envelope as upgrade-required', async () => {
  const transport = new ScriptedTransport();
  const clock = new TestClock();
  const gateway = createCoreOperationsGateway(
    transport,
    new MemoryStorage(),
    clock,
  );
  transport.enqueue({
    status: 200,
    body: { serverRevision: '1', skus: [] },
  });

  await gateway.initialize();

  expect(gateway.getSyncSnapshot().phase).toBe('upgrade-required');
  expect(clock.pendingDelays()).toEqual([]);
});
