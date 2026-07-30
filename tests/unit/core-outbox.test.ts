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
const OTHER_INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
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

function legacyV2Envelope() {
  return {
    cacheVersion: 2 as const,
    installationId: OTHER_INSTALLATION_ID,
    state: emptyCoreState(),
    serverRevision: '17',
    outbox: [],
    deferredOutbox: [],
    provisionalNotas: [],
    offlineConflicts: [],
    quarantine: { active: false },
  };
}

describe('Core local cache v3', () => {
  it('rebinds only a clean v2 canonical cache to the native installation UUID', () => {
    const migrated = migrateCoreCache(
      legacyV2Envelope(),
      () => INSTALLATION_ID,
    );

    expect(migrated).toMatchObject({
      cacheVersion: 3,
      installationId: INSTALLATION_ID,
      serverRevision: '17',
      outbox: [],
      quarantinedOutbox: [],
      deferredOutbox: [],
      provisionalNotas: [],
      offlineConflicts: [],
      quarantine: { active: false },
    });
  });

  it.each([
    {
      name: 'normal outbox',
      patch: {
        outbox: [
          {
            id: OPERATION_ID,
            idempotencyKey: OPERATION_ID,
            method: 'POST' as const,
            path: '/v1/notas',
            body: {},
            createdAt: '2026-07-30T01:00:00.000Z',
          },
        ],
      },
    },
    {
      name: 'deferred outbox',
      patch: {
        deferredOutbox: [
          {
            kind: 'offline-nota' as const,
            operationId: OPERATION_ID,
            idempotencyKey: OPERATION_ID,
            createdAt: '2026-07-30T01:00:00.000Z',
            status: 'deferred' as const,
            payload: {
              provisionalId: PROVISIONAL_ID,
              snapshot: localNota(),
              completed: false,
              destination: 'archive' as const,
              skuSnapshots: [],
            },
          },
        ],
      },
    },
    {
      name: 'provisional Nota',
      patch: { provisionalNotas: [localNota()] },
    },
    {
      name: 'offline conflict',
      patch: {
        offlineConflicts: [
          {
            operationId: OPERATION_ID,
            conflict: {
              id: OPERATION_ID,
              entityType: 'nota',
              entityId: PROVISIONAL_ID,
              base: null,
              mine: null,
              server: null,
            },
          },
        ],
      },
    },
    {
      name: 'active quarantine',
      patch: {
        quarantine: {
          active: true as const,
          quarantinedAt: '2026-07-30T01:00:00.000Z',
        },
      },
    },
  ])('refuses to rebind v2 ownership with $name', ({ patch }) => {
    const legacy = { ...legacyV2Envelope(), ...patch };

    expect(() =>
      migrateCoreCache(legacy, () => INSTALLATION_ID),
    ).toThrow('pending work');
  });

  it('rebinds only a clean v1 canonical cache to the native installation UUID', () => {
    const legacy = {
      cacheVersion: 1,
      state: emptyCoreState(),
      serverRevision: '17',
      outbox: [],
    };

    const migrated = migrateCoreCache(legacy, () => INSTALLATION_ID);

    expect(migrated).toMatchObject({
      cacheVersion: CORE_CACHE_VERSION,
      installationId: INSTALLATION_ID,
      state: legacy.state,
      serverRevision: '17',
      outbox: [],
      deferredOutbox: [],
      provisionalNotas: [],
      offlineConflicts: [],
      quarantine: { active: false },
    });
    expect(parseCoreLocalEnvelope(migrated)).toEqual(migrated);
  });

  it('refuses to rebind v1 ownership with a pending online outbox', () => {
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
    const before = JSON.stringify(legacy);

    expect(() =>
      migrateCoreCache(legacy, () => INSTALLATION_ID),
    ).toThrow('pending work');
    expect(JSON.stringify(legacy)).toBe(before);
  });

  it('fails closed on corrupt v3 data while leaving the caller-owned value untouched', () => {
    const corrupt = {
      cacheVersion: CORE_CACHE_VERSION,
      installationId: INSTALLATION_ID,
      state: emptyCoreState(),
      serverRevision: 'not-a-cursor',
      outbox: [],
      quarantinedOutbox: [],
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

    const restarted = new CoreLocalStore(storage, () => INSTALLATION_ID);
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
    await store.update((envelope) => ({
      ...envelope,
      outbox: [
        {
          id: '60606060-6060-4060-8060-606060606060',
          idempotencyKey: '60606060-6060-4060-8060-606060606060',
          method: 'PATCH',
          path: `/v1/skus/11111111-1111-4111-8111-111111111111`,
          body: { name: 'Antrean biasa' },
          createdAt: '2026-07-30T01:59:00.000Z',
        },
      ],
    }));
    transport.enqueue({ status: 401, body: { code: 'UNAUTHORIZED' } });

    await outbox.pump(true);
    await outbox.pump(true);

    const quarantined = await store.load();
    expect(revoked).toBe(1);
    expect(quarantined.installationId).toBe(INSTALLATION_ID);
    expect(quarantined.quarantine).toMatchObject({
      active: true,
      installationId: INSTALLATION_ID,
    });
    expect(quarantined.outbox).toEqual([]);
    expect(Reflect.get(quarantined, 'quarantinedOutbox')).toHaveLength(1);
    expect(
      quarantined.deferredOutbox.map((command) => command.status),
    ).toEqual(['quarantined', 'quarantined']);
    expect(transport.requests).toHaveLength(1);

    await expect(
      outbox.resumeAfterReapproval(OTHER_INSTALLATION_ID),
    ).resolves.toBe(false);
    expect((await store.load()).quarantine.active).toBe(true);
    await outbox.pump(true);
    expect(transport.requests).toHaveLength(1);

    await expect(
      outbox.resumeAfterReapproval(INSTALLATION_ID),
    ).resolves.toBe(true);
    transport.enqueue({ status: 200, body: {} });
    transport.enqueue({ status: 200, body: {} });
    await outbox.pump(true);

    expect((await store.load()).installationId).toBe(INSTALLATION_ID);
    expect((await store.load()).deferredOutbox).toEqual([]);
    expect((await store.load()).outbox).toHaveLength(1);
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
