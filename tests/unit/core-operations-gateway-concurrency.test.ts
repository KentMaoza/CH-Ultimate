import { describe, expect, it } from 'vitest';

import type { CoreApiResponse } from '../../src/gateway/core-api-transport';
import type {
  CoreCacheEnvelope,
  CoreGatewayStorage,
} from '../../src/gateway/core-operations-gateway';
import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import {
  NOTA_ID,
  SKU_ID,
  MemoryStorage,
  ScriptedTransport,
  TestClock,
  deferred,
  populatedBootstrap,
} from './core-gateway-test-support';

class BlockingStorage extends MemoryStorage implements CoreGatewayStorage {
  private nextGate:
    | ReturnType<typeof deferred<void>>
    | undefined;

  blockNextSave() {
    this.nextGate = deferred<void>();
    return this.nextGate;
  }

  override async save(value: CoreCacheEnvelope): Promise<void> {
    const gate = this.nextGate;
    this.nextGate = undefined;
    if (gate) await gate.promise;
    await super.save(value);
  }
}

function emptyChanges(revision: string): CoreApiResponse {
  return {
    status: 200,
    body: { serverRevision: revision, nextAfter: revision, changes: [] },
  };
}

async function settleUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Expected mutation request did not start');
}

describe('Core gateway concurrency and durability', () => {
  it('single-flights overlapping timer, resume, and retry triggers into one rerun', async () => {
    const transport = new ScriptedTransport();
    const clock = new TestClock();
    const gateway = createCoreOperationsGateway(
      transport,
      new MemoryStorage(),
      clock,
    );
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await gateway.initialize();
    const slowPoll = deferred<CoreApiResponse>();
    transport.enqueue(() => slowPoll.promise);
    transport.enqueue(emptyChanges('2'));

    const timerRun = clock.runNext();
    await Promise.resolve();
    const resumeRun = clock.resume();
    const retryRun = gateway.retryPending();
    await Promise.resolve();

    expect(transport.requests).toHaveLength(2);

    slowPoll.resolve({
      status: 200,
      body: {
        serverRevision: '2',
        nextAfter: '2',
        changes: [
          {
            revision: '2',
            entityType: 'sku',
            entityId: SKU_ID,
            operation: 'upsert',
            payload: {
              ...populatedBootstrap().skus[0]!,
              name: 'Single flight wins',
              rowVersion: '2',
            },
            createdAt: '2026-07-29T01:00:02.000Z',
          },
        ],
      },
    });
    await Promise.all([timerRun, resumeRun, retryRun]);

    expect(transport.requests.map((request) => request.path)).toEqual([
      '/v1/bootstrap',
      '/v1/changes?after=1&limit=500',
      '/v1/changes?after=2&limit=500',
    ]);
    expect(gateway.getSnapshot().skus[0]?.name).toBe('Single flight wins');
    expect(gateway.getSyncSnapshot().serverRevision).toBe('2');
    expect(clock.pendingDelays()).toEqual([2_000]);
  });

  it('accepts sparse auto-increment revisions without forcing bootstrap', async () => {
    const transport = new ScriptedTransport();
    const clock = new TestClock();
    const gateway = createCoreOperationsGateway(
      transport,
      new MemoryStorage(),
      clock,
    );
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '5',
        nextAfter: '5',
        changes: [
          {
            revision: '5',
            entityType: 'sku',
            entityId: SKU_ID,
            operation: 'upsert',
            payload: {
              ...populatedBootstrap().skus[0]!,
              name: 'Revision five',
              rowVersion: '5',
            },
            createdAt: '2026-07-29T01:00:05.000Z',
          },
        ],
      },
    });

    await gateway.initialize();
    await clock.runNext();

    expect(gateway.getSnapshot().skus[0]?.name).toBe('Revision five');
    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'online',
      serverRevision: '5',
    });
    expect(transport.requests).toHaveLength(2);
  });

  it('does not send a coalesced body until that exact body is durably saved', async () => {
    const transport = new ScriptedTransport();
    const storage = new BlockingStorage();
    const gateway = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
    );
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await gateway.initialize();
    const gate = storage.blockNextSave();
    transport.enqueue({ status: 200, body: { serverRevision: '2' } });
    transport.enqueue(emptyChanges('1'));

    const first = gateway.updateNotaTransaction(NOTA_ID, {
      customerName: 'Amina',
    });
    const second = gateway.updateNotaTransaction(NOTA_ID, {
      customerPlace: 'Banjarbaru',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(transport.requests).toHaveLength(1);

    gate.resolve();
    await Promise.all([first, second]);
    expect(transport.requests[1]).toMatchObject({
      body: {
        lifecycleVersion: '1',
        fields: {
          customerName: {
            version: '1',
            base: 'Amelia',
            mine: 'Amina',
          },
          customerPlace: {
            version: '1',
            base: 'Saibah',
            mine: 'Banjarbaru',
          },
        },
      },
    });
    expect(
      (storage.value as CoreCacheEnvelope).outbox,
    ).toEqual([]);
  });

  it('resolves a server-committed write while retaining its key after dequeue save failure', async () => {
    const transport = new ScriptedTransport();
    const storage = new MemoryStorage();
    const gateway = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
    );
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await gateway.initialize();
    transport.enqueue((request) => {
      storage.failNextSave = true;
      expect(request.idempotencyKey).toEqual(expect.any(String));
      return { status: 200, body: { serverRevision: '2' } };
    });
    transport.enqueue(emptyChanges('1'));

    await expect(
      gateway.updateNotaTransaction(NOTA_ID, { customerName: 'Amina' }),
    ).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const pending = (storage.value as CoreCacheEnvelope).outbox[0]!;
    expect(pending.idempotencyKey).toBe(
      transport.requests[1]?.idempotencyKey,
    );
    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'offline',
      pendingCount: 1,
    });
    expect(transport.requests[2]?.path).toBe(
      '/v1/changes?after=1&limit=500',
    );
  });

  it.each([
    { status: 401, body: { code: 'UNAUTHORIZED' }, phase: 'revoked' },
    {
      status: 426,
      body: { code: 'UPGRADE_REQUIRED' },
      phase: 'upgrade-required',
    },
  ] as const)('preserves terminal $phase after mutation failure', async (result) => {
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(
      transport,
      new MemoryStorage(),
      new TestClock(),
    );
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await gateway.initialize();
    transport.enqueue({ status: result.status, body: result.body });

    await expect(gateway.adjustStock(SKU_ID, 1)).rejects.toThrow();

    expect(gateway.getSyncSnapshot().phase).toBe(result.phase);
  });

  it.each([
    {
      name: 'transport failure',
      response: new Error('LAN unavailable'),
      message: 'LAN unavailable',
    },
    {
      name: 'conflict',
      response: {
        status: 409,
        body: {
          code: 'CONFLICT',
          conflict: {
            id: '77777777-7777-4777-8777-777777777777',
            entityType: 'nota',
            entityId: NOTA_ID,
            field: 'customerName',
            base: 'Amelia',
            mine: 'Amina',
            server: 'Amelia Baru',
          },
        },
      },
      message: 'CONFLICT',
    },
  ])('awaits durable state before rejecting a $name', async (result) => {
    const transport = new ScriptedTransport();
    const storage = new BlockingStorage();
    const gateway = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
    );
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await gateway.initialize();
    let gate: ReturnType<typeof deferred<void>> | undefined;
    transport.enqueue(() => {
      gate = storage.blockNextSave();
      if (result.response instanceof Error) throw result.response;
      return result.response;
    });
    let settled = false;
    const update = gateway.updateNotaTransaction(NOTA_ID, {
      customerName: 'Amina',
    });
    void update.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await settleUntil(() => transport.requests.length === 2);
    await Promise.resolve();

    expect(settled).toBe(false);
    gate?.resolve();
    await expect(update).rejects.toThrow(result.message);
    expect((storage.value as CoreCacheEnvelope).outbox[0]).toMatchObject({
      optimisticActive: false,
    });
  });

  it('reapplies a cached active optimistic overlay after canonical bootstrap', async () => {
    const seedTransport = new ScriptedTransport();
    const seedGateway = createCoreOperationsGateway(
      seedTransport,
      new MemoryStorage(),
      new TestClock(),
    );
    seedTransport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await seedGateway.initialize();
    const cache: CoreCacheEnvelope = {
      cacheVersion: 1,
      state: seedGateway.getSnapshot(),
      serverRevision: '1',
      outbox: [
        {
          id: '88888888-8888-4888-8888-888888888888',
          idempotencyKey: '99999999-9999-4999-8999-999999999999',
          method: 'PATCH',
          path: `/v1/notas/${NOTA_ID}/header`,
          body: { patch: { customerName: 'Amina' } },
          createdAt: '2026-07-29T00:59:00.000Z',
          notaId: NOTA_ID,
          coalesceKey: `nota:${NOTA_ID}:header`,
          optimistic: {
            kind: 'nota-header',
            notaId: NOTA_ID,
            patch: { customerName: 'Amina' },
          },
          optimisticActive: true,
        },
      ],
    };
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(
      transport,
      new MemoryStorage(cache),
      new TestClock(),
    );
    transport.enqueue({ status: 200, body: populatedBootstrap('2') });

    await gateway.initialize();

    expect(gateway.getSnapshot().notaTransactions[0]?.customerName).toBe(
      'Amina',
    );
    expect(gateway.getSyncSnapshot().pendingCount).toBe(1);
  });
});
