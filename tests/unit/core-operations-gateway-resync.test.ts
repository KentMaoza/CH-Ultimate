import { describe, expect, it } from 'vitest';

import type { CoreCacheEnvelope } from '../../src/gateway/core-operations-gateway';
import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import {
  NOTA_ID,
  SKU_ID,
  MemoryStorage,
  ScriptedTransport,
  TestClock,
  populatedBootstrap,
} from './core-gateway-test-support';

function setup() {
  const transport = new ScriptedTransport();
  const storage = new MemoryStorage();
  const clock = new TestClock();
  const gateway = createCoreOperationsGateway(transport, storage, clock);
  return { gateway, transport, storage, clock };
}

describe('Core gateway resync and observable state boundaries', () => {
  it('full-resyncs an unknown change shape without replacing an unsent outbox item', async () => {
    const { gateway, transport, storage, clock } = setup();
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await gateway.initialize();

    transport.enqueue(new Error('lost mutation response'));
    await expect(gateway.adjustStock(SKU_ID, 1)).rejects.toThrow(
      'lost mutation response',
    );
    const pendingBefore = (storage.value as CoreCacheEnvelope).outbox[0]!;

    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '2',
        nextAfter: '2',
        changes: [
          {
            revision: '2',
            entityType: 'future_unknown_entity',
            entityId: NOTA_ID,
            operation: 'upsert',
            payload: {},
            createdAt: '2026-07-29T01:00:02.000Z',
          },
        ],
      },
    });
    transport.enqueue({
      status: 200,
      body: populatedBootstrap('2', {
        skus: [
          {
            ...populatedBootstrap().skus[0]!,
            name: 'Canonical after unknown change',
            rowVersion: '2',
          },
        ],
      }),
    });

    await clock.runNext();

    expect(gateway.getSnapshot().skus[0]?.name).toBe(
      'Canonical after unknown change',
    );
    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'online',
      serverRevision: '2',
      pendingCount: 1,
    });
    expect((storage.value as CoreCacheEnvelope).outbox[0]).toMatchObject({
      id: pendingBefore.id,
      idempotencyKey: pendingBefore.idempotencyKey,
    });
  });

  it('caps repeated offline polling delays at thirty seconds', async () => {
    const { gateway, transport, clock } = setup();
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await gateway.initialize();

    const observed: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      transport.enqueue(new Error(`offline ${attempt}`));
      await clock.runNext();
      observed.push(clock.pendingDelays()[0]!);
    }

    expect(observed).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  });

  it('returns defensive snapshots and honors deterministic unsubscription', async () => {
    const { gateway, transport, clock } = setup();
    let businessNotifications = 0;
    let syncNotifications = 0;
    const unsubscribeBusiness = gateway.subscribe(() => {
      businessNotifications += 1;
    });
    const unsubscribeSync = gateway.subscribeSync(() => {
      syncNotifications += 1;
    });
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await gateway.initialize();
    const businessAtUnsubscribe = businessNotifications;
    const syncAtUnsubscribe = syncNotifications;
    unsubscribeBusiness();
    unsubscribeSync();

    const snapshot = gateway.getSnapshot();
    snapshot.skus[0]!.name = 'Corrupted outside';
    const sync = gateway.getSyncSnapshot();
    sync.phase = 'revoked';

    transport.enqueue({
      status: 200,
      body: { serverRevision: '1', nextAfter: '1', changes: [] },
    });
    await clock.runNext();

    expect(gateway.getSnapshot().skus[0]?.name).toBe('Produk Core');
    expect(gateway.getSyncSnapshot().phase).toBe('online');
    expect(businessNotifications).toBe(businessAtUnsubscribe);
    expect(syncNotifications).toBe(syncAtUnsubscribe);
  });
});
