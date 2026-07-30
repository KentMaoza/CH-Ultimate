import { describe, expect, it } from 'vitest';

import {
  CORE_CACHE_VERSION,
  CoreLocalStore,
  migrateCoreCache,
  parseCoreLocalEnvelope,
} from '../../src/gateway/core-local-store';
import { CoreDeferredOutbox } from '../../src/gateway/core-outbox';
import { emptyCoreState } from '../../src/gateway/core-bootstrap-mapping';
import {
  MemoryStorage,
  ScriptedTransport,
} from './core-gateway-test-support';

const INSTALLATION_ID = '10101010-1010-4010-8010-101010101010';
const OPERATION_ID = '20202020-2020-4020-8020-202020202020';
const PROVISIONAL_ID = '30303030-3030-4030-8030-303030303030';

function localNota(customerName = '') {
  return {
    id: PROVISIONAL_ID,
    baseNumber: 'OFFLINE',
    customerName,
    customerPlace: '',
    transactionDate: '2026-07-30',
    payment: 'unclassified' as const,
    status: 'draft' as const,
    nextNoteIndex: 0,
    pages: [],
    postedLines: [],
    postedStockEffects: {},
    postedTrackedLineIds: {},
  };
}

describe('Core local cache v2', () => {
  it('migrates a v1 cache without losing its canonical cursor or online outbox', () => {
    const legacy = {
      cacheVersion: 1,
      state: emptyCoreState(),
      serverRevision: '17',
      outbox: [
        {
          id: OPERATION_ID,
          idempotencyKey: OPERATION_ID,
          method: 'POST',
          path: '/v1/notas',
          body: {},
          createdAt: '2026-07-30T01:00:00.000Z',
        },
      ],
    };

    const migrated = migrateCoreCache(legacy, () => INSTALLATION_ID);

    expect(migrated).toMatchObject({
      cacheVersion: CORE_CACHE_VERSION,
      installationId: INSTALLATION_ID,
      state: legacy.state,
      serverRevision: '17',
      outbox: legacy.outbox,
      deferredOutbox: [],
      provisionalNotas: [],
      offlineConflicts: [],
      quarantine: { active: false },
    });
    expect(parseCoreLocalEnvelope(migrated)).toEqual(migrated);
  });

  it('fails closed on corrupt v2 data while leaving the caller-owned value untouched', () => {
    const corrupt = {
      cacheVersion: CORE_CACHE_VERSION,
      installationId: INSTALLATION_ID,
      state: emptyCoreState(),
      serverRevision: 'not-a-cursor',
      outbox: [],
      deferredOutbox: [{ operationId: OPERATION_ID }],
      provisionalNotas: [],
      offlineConflicts: [],
      quarantine: { active: false },
    };
    const before = structuredClone(corrupt);

    expect(() => parseCoreLocalEnvelope(corrupt)).toThrow();
    expect(corrupt).toEqual(before);
  });

  it('atomically recovers a persisted envelope after an app kill', async () => {
    const storage = new MemoryStorage();
    const first = new CoreLocalStore(storage, () => INSTALLATION_ID);
    const canonical = await first.loadCanonical();
    canonical.serverRevision = '23';
    await first.saveCanonical(canonical);
    await first.update((envelope) => ({
      ...envelope,
      provisionalNotas: [
        localNota('Toko Aman'),
      ],
    }));

    const restarted = new CoreLocalStore(storage, () => crypto.randomUUID());
    const recovered = await restarted.load();

    expect(recovered.installationId).toBe(INSTALLATION_ID);
    expect(recovered.serverRevision).toBe('23');
    expect(recovered.provisionalNotas[0]?.customerName).toBe('Toko Aman');
  });
});

describe('Core deferred outbox', () => {
  it('replaces a local Nota snapshot before first send while retaining one operation UUID', async () => {
    const storage = new MemoryStorage();
    const store = new CoreLocalStore(storage, () => INSTALLATION_ID);
    const transport = new ScriptedTransport();
    const outbox = new CoreDeferredOutbox(store, transport, {
      now: () => new Date('2026-07-30T02:00:00.000Z'),
      uuid: () => OPERATION_ID,
    });

    await outbox.deferNota(localNota('Pertama'));
    await outbox.deferNota(localNota('Terakhir'));

    const envelope = await store.load();
    expect(envelope.deferredOutbox).toHaveLength(1);
    expect(envelope.deferredOutbox[0]).toMatchObject({
      operationId: OPERATION_ID,
      idempotencyKey: OPERATION_ID,
      status: 'deferred',
      payload: {
        provisionalId: PROVISIONAL_ID,
        snapshot: { customerName: 'Terakhir' },
      },
    });
  });

  it('persists sending before transport and keeps the exact body immutable after response loss', async () => {
    const storage = new MemoryStorage();
    const store = new CoreLocalStore(storage, () => INSTALLATION_ID);
    const firstTransport = new ScriptedTransport();
    firstTransport.enqueue(new Error('response lost'));
    const first = new CoreDeferredOutbox(store, firstTransport, {
      now: () => new Date('2026-07-30T02:00:00.000Z'),
      uuid: () => OPERATION_ID,
    });
    await first.deferNota(localNota('Persisted'));

    await first.pump(true);

    const afterLoss = await store.load();
    const immutable = afterLoss.deferredOutbox[0]!;
    expect(immutable.status).toBe('error');
    expect(immutable.firstSentAt).toBe('2026-07-30T02:00:00.000Z');
    await expect(first.deferNota(localNota('Too late'))).rejects.toThrow(
      'Sedang sinkronisasi',
    );

    const retryTransport = new ScriptedTransport();
    retryTransport.enqueue({
      status: 200,
      body: {
        entityId: '40404040-4040-4040-8040-404040404040',
        entity: { id: '40404040-4040-4040-8040-404040404040' },
      },
    });
    const restarted = new CoreDeferredOutbox(store, retryTransport, {
      now: () => new Date('2026-07-30T02:01:00.000Z'),
      uuid: crypto.randomUUID,
    });
    await restarted.pump(true);

    expect(retryTransport.requests[0]).toEqual(firstTransport.requests[0]);
    expect((await store.load()).deferredOutbox).toEqual([]);
  });

  it('sends persisted commands in creation order only after online confirmation', async () => {
    let counter = 0;
    const storage = new MemoryStorage();
    const store = new CoreLocalStore(storage, () => INSTALLATION_ID);
    const transport = new ScriptedTransport();
    const outbox = new CoreDeferredOutbox(store, transport, {
      now: () =>
        new Date(`2026-07-30T02:00:0${counter++}.000Z`),
      uuid: () =>
        counter === 1
          ? OPERATION_ID
          : '50505050-5050-4050-8050-505050505050',
    });
    await outbox.deferNota(localNota());
    await outbox.deferStock({
      skuId: '11111111-1111-4111-8111-111111111111',
      skuIdentifier: 'SKU-1',
      skuName: 'Produk',
      referencePrice: 5_000,
      delta: -2,
      reason: 'Barang rusak',
    });

    await outbox.pump(false);
    expect(transport.requests).toEqual([]);

    transport.enqueue({ status: 200, body: {} });
    transport.enqueue({ status: 200, body: {} });
    await outbox.pump(true);

    expect(transport.requests.map((request) => request.path)).toEqual([
      '/v1/offline/notas',
      '/v1/offline/stock-adjustments',
    ]);
  });

  it('quarantines every pending item on 401 and resumes only after same-installation reapproval', async () => {
    let operation = 0;
    const storage = new MemoryStorage();
    const store = new CoreLocalStore(storage, () => INSTALLATION_ID);
    const transport = new ScriptedTransport();
    let revoked = 0;
    const outbox = new CoreDeferredOutbox(store, transport, {
      now: () => new Date('2026-07-30T02:00:00.000Z'),
      uuid: () =>
        operation++ === 0
          ? OPERATION_ID
          : '50505050-5050-4050-8050-505050505050',
      onRevoked: () => {
        revoked += 1;
      },
    });
    await outbox.deferNota(localNota());
    await outbox.deferStock({
      skuId: '11111111-1111-4111-8111-111111111111',
      skuIdentifier: 'SKU-1',
      skuName: 'Produk',
      referencePrice: 5_000,
      delta: 2,
      reason: 'Koreksi',
    });
    transport.enqueue({ status: 401, body: { code: 'UNAUTHORIZED' } });

    await outbox.pump(true);
    await outbox.pump(true);

    const quarantined = await store.load();
    expect(revoked).toBe(1);
    expect(quarantined.installationId).toBe(INSTALLATION_ID);
    expect(quarantined.quarantine.active).toBe(true);
    expect(
      quarantined.deferredOutbox.map((command) => command.status),
    ).toEqual(['quarantined', 'quarantined']);
    expect(transport.requests).toHaveLength(1);

    await outbox.resumeAfterReapproval();
    transport.enqueue({ status: 200, body: {} });
    transport.enqueue({ status: 200, body: {} });
    await outbox.pump(true);

    expect((await store.load()).installationId).toBe(INSTALLATION_ID);
    expect((await store.load()).deferredOutbox).toEqual([]);
    expect(transport.requests[1]).toEqual(transport.requests[0]);
  });

  it('retains a permanent rejection as an actionable offline conflict', async () => {
    const storage = new MemoryStorage();
    const store = new CoreLocalStore(storage, () => INSTALLATION_ID);
    const transport = new ScriptedTransport();
    const outbox = new CoreDeferredOutbox(store, transport, {
      now: () => new Date('2026-07-30T02:00:00.000Z'),
      uuid: () => OPERATION_ID,
    });
    await outbox.deferStock({
      skuId: '11111111-1111-4111-8111-111111111111',
      skuIdentifier: 'SKU-1',
      skuName: 'Produk',
      referencePrice: 5_000,
      delta: 2,
      reason: 'Koreksi',
    });
    transport.enqueue({
      status: 409,
      body: { code: 'SKU_MISSING' },
    });

    await outbox.pump(true);

    const envelope = await store.load();
    expect(envelope.deferredOutbox[0]).toMatchObject({
      status: 'conflict',
      lastError: 'SKU_MISSING',
    });
    expect(envelope.offlineConflicts).toEqual([
      expect.objectContaining({
        operationId: OPERATION_ID,
        errorCode: 'SKU_MISSING',
        conflict: expect.objectContaining({
          id: OPERATION_ID,
          entityType: 'stock_balance',
          entityId: '11111111-1111-4111-8111-111111111111',
          server: 'SKU_MISSING',
        }),
      }),
    ]);

    await outbox.resolveConflict(OPERATION_ID, 'mine');
    expect(await store.load()).toMatchObject({
      deferredOutbox: [{ status: 'error' }],
      offlineConflicts: [],
    });
  });
});
