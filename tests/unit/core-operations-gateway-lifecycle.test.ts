import { describe, expect, it } from 'vitest';

import { CORE_API_PATHS } from '../../src/gateway/core-api-types';
import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import {
  NOTA_ID,
  MemoryStorage,
  ScriptedTransport,
  TestClock,
  deferred,
  populatedBootstrap,
} from './core-gateway-test-support';

const lifecycleCases = [
  {
    name: 'completion',
    path: CORE_API_PATHS.notaComplete(NOTA_ID),
    run: (gateway: ReturnType<typeof createCoreOperationsGateway>) =>
      gateway.completeNotaTransaction(NOTA_ID),
  },
  {
    name: 'cancellation',
    path: CORE_API_PATHS.notaCancel(NOTA_ID),
    run: (gateway: ReturnType<typeof createCoreOperationsGateway>) =>
      gateway.cancelNotaTransaction(NOTA_ID),
  },
  {
    name: 'reopening',
    path: CORE_API_PATHS.notaReopen(NOTA_ID),
    run: (gateway: ReturnType<typeof createCoreOperationsGateway>) =>
      gateway.reopenNotaTransaction(NOTA_ID),
  },
  {
    name: 'restoration',
    path: CORE_API_PATHS.notaRestore(NOTA_ID),
    run: (gateway: ReturnType<typeof createCoreOperationsGateway>) =>
      gateway.restoreNotaTransaction(NOTA_ID),
  },
] as const;

async function settleUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Expected header request did not start');
}

describe('Core Nota lifecycle ordering', () => {
  it.each(lifecycleCases)(
    'flushes header writes before $name',
    async ({ path, run }) => {
      const transport = new ScriptedTransport();
      const gateway = createCoreOperationsGateway(
        transport,
        new MemoryStorage(),
        new TestClock(),
      );
      transport.enqueue({ status: 200, body: populatedBootstrap('1') });
      await gateway.initialize();
      const headerResponse = deferred<{ status: number; body: unknown }>();
      transport.enqueue(() => headerResponse.promise);
      transport.enqueue({
        status: 200,
        body: { serverRevision: '1', nextAfter: '1', changes: [] },
      });
      transport.enqueue({ status: 200, body: { serverRevision: '2' } });
      transport.enqueue({
        status: 200,
        body: { serverRevision: '1', nextAfter: '1', changes: [] },
      });

      const header = gateway.updateNotaTransaction(NOTA_ID, {
        customerName: 'Amina',
      });
      const lifecycle = run(gateway);
      await settleUntil(() => transport.requests.length >= 2);
      expect(transport.requests.map((request) => request.path)).toEqual([
        CORE_API_PATHS.bootstrap,
        CORE_API_PATHS.notaHeader(NOTA_ID),
      ]);

      headerResponse.resolve({
        status: 200,
        body: { serverRevision: '1' },
      });
      await header;
      await lifecycle;

      expect(
        transport.requests.findIndex((request) => request.path === path),
      ).toBeGreaterThan(
        transport.requests.findIndex(
          (request) => request.path === CORE_API_PATHS.notaHeader(NOTA_ID),
        ),
      );
    },
  );
});
