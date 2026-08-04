import { describe, expect, it } from 'vitest';

import type { CoreCacheEnvelope } from '../../src/gateway/core-operations-gateway';
import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import { parseCoreCache } from '../../src/gateway/core-cache';
import { createInitialState } from '../../src/domain/operations';
import {
  IDENTIFIER_ID,
  SKU_ID,
  MemoryStorage,
  ScriptedTransport,
  TestClock,
  bootstrapBody,
  populatedBootstrap,
} from './core-gateway-test-support';

function createGateway(
  transport = new ScriptedTransport(),
  storage = new MemoryStorage(),
  clock = new TestClock(),
) {
  return {
    gateway: createCoreOperationsGateway(transport, storage, clock),
    transport,
    storage,
    clock,
  };
}

describe('Core operations gateway bootstrap and polling', () => {
  it('treats legacy cached recommendation events without source as neutral', () => {
    const state = createInitialState();

    const cached = parseCoreCache({
      cacheVersion: 1,
      state: {
        ...state,
        priceChanges: [
          {
            id: 'legacy-price', skuId: 'sku-1', before: 42_000, after: 43_000,
            createdAt: '2026-08-04T00:00:00.000Z',
          },
        ],
        adjustments: [
          {
            id: 'legacy-stock', skuId: 'sku-1', quantity: 2, before: 1, after: 3,
            createdAt: '2026-08-04T00:00:00.000Z',
          },
        ],
      },
      serverRevision: '1',
      outbox: [],
    });

    expect(cached.state.priceChanges[0]?.source).toBe('other');
    expect(cached.state.adjustments[0]?.source).toBe('other');
  });

  it('enables owner-only capabilities only after an owner bootstrap', async () => {
    const owner = createGateway();
    owner.transport.enqueue({
      status: 200,
      body: populatedBootstrap('1'),
    });
    expect(owner.gateway.capabilities.canStageInitialCatalogue).toBe(false);
    expect(owner.gateway.capabilities.canManagePackageBarcodes).toBe(false);
    await owner.gateway.initialize();
    expect(owner.gateway.capabilities.canStageInitialCatalogue).toBe(true);
    expect(owner.gateway.capabilities.canManagePackageBarcodes).toBe(true);

    const client = createGateway();
    client.transport.enqueue({
      status: 200,
      body: populatedBootstrap('1', { deviceRole: 'client' }),
    });
    await client.gateway.initialize();
    expect(client.gateway.capabilities.canStageInitialCatalogue).toBe(false);
    expect(client.gateway.capabilities.canManagePackageBarcodes).toBe(false);
  });
  it('publishes a valid cached snapshot before replacing it with canonical bootstrap data', async () => {
    const cached: CoreCacheEnvelope = {
      cacheVersion: 1,
      state: {
        skus: [
          {
            id: SKU_ID,
            skuNumber: 'CACHED',
            aliases: [],
            identifiers: [],
            name: 'Cached product',
            referencePrice: 100,
            stock: 3,
            tracked: true,
            note: '',
            imageUrl: '',
            createdAt: '2026-07-28T00:00:00.000Z',
            archived: false,
          },
        ],
        adjustments: [],
        stockChecks: [],
        priceChanges: [],
        notaTransactions: [],
        labelTemplate: {
          medium: 'thermal',
          widthMm: 50,
          heightMm: 30,
          columns: 1,
          marginMm: 2,
          gapMm: 2,
          fontSize: 10,
          alignment: 'center',
          fields: ['qr', 'name'],
        },
        invoiceTemplate: {
          widthMm: 210,
          heightMm: 148,
          fontSize: 12,
          logoUrl: '',
          bankAccount: '',
          address: '',
          phone: '',
          elements: [],
        },
        sourceLabel: 'CH Core',
      },
      serverRevision: '7',
      outbox: [],
    };
    const storage = new MemoryStorage(cached);
    const transport = new ScriptedTransport();
    let releaseBootstrap!: () => void;
    transport.enqueue(
      () =>
        new Promise((resolve) => {
          releaseBootstrap = () =>
            resolve({ status: 200, body: populatedBootstrap('8') });
        }),
    );
    const { gateway, clock } = createGateway(
      transport,
      storage,
      new TestClock(),
    );
    const publishedNames: string[] = [];
    gateway.subscribe(() => {
      publishedNames.push(gateway.getSnapshot().skus[0]?.name ?? 'empty');
    });

    const initializing = gateway.initialize();
    await Promise.resolve();

    expect(gateway.getSnapshot().skus[0]?.name).toBe('Cached product');
    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'connecting',
      serverRevision: '7',
      pendingCount: 0,
    });

    await Promise.resolve();
    releaseBootstrap();
    await initializing;

    expect(gateway.getSnapshot()).toMatchObject({
      sourceLabel: 'CH Core',
      adjustments: [],
      priceChanges: [],
    });
    expect(gateway.getSnapshot().skus[0]).toMatchObject({
      skuNumber: 'SKU-001',
      aliases: ['SCAN-001'],
      stock: 12,
      note: 'Rak A',
      imageHash: 'a'.repeat(64),
      sourceCreatedAt: '2026-07-28 09:24',
    });
    expect(gateway.getSnapshot().notaTransactions[0]?.pages[0]?.lines).toHaveLength(15);
    expect(publishedNames).toEqual(['Cached product', 'Produk Core']);
    expect((storage.value as CoreCacheEnvelope).outbox).toEqual(cached.outbox);
    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'online',
      serverRevision: '8',
      pendingCount: 0,
    });
    expect(clock.pendingDelays()).toEqual([2_000]);
  });

  it('uses empty business collections and presentation defaults for an empty bootstrap', async () => {
    const { gateway, transport } = createGateway();
    transport.enqueue({ status: 200, body: bootstrapBody('0') });

    await gateway.initialize();

    const snapshot = gateway.getSnapshot();
    expect(snapshot.skus).toEqual([]);
    expect(snapshot.notaTransactions).toEqual([]);
    expect(snapshot.labelTemplate.fields).toContain('qr');
    expect(snapshot.invoiceTemplate.elements).not.toEqual([]);
  });

  it('applies a complete remote page atomically and ignores duplicate revisions', async () => {
    const { gateway, transport, storage, clock } = createGateway();
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '2',
        nextAfter: '2',
        changes: [
          {
            revision: '1',
            entityType: 'device',
            entityId: SKU_ID,
            operation: 'upsert',
            payload: { id: SKU_ID },
            createdAt: '2026-07-29T01:00:01.000Z',
          },
          {
            revision: '2',
            entityType: 'sku',
            entityId: SKU_ID,
            operation: 'upsert',
            payload: {
              ...populatedBootstrap().skus[0]!,
              name: 'Produk berubah',
              priceRupiah: '30000',
              rowVersion: '2',
            },
            createdAt: '2026-07-29T01:00:02.000Z',
          },
        ],
      },
    });

    await gateway.initialize();
    await clock.runNext();

    expect(gateway.getSnapshot().skus[0]).toMatchObject({
      name: 'Produk berubah',
      referencePrice: 30_000,
    });
    expect(gateway.getSyncSnapshot().serverRevision).toBe('2');
    expect((storage.value as CoreCacheEnvelope).serverRevision).toBe('2');
  });

  it.each([
    {
      name: 'an expired cursor',
      response: { status: 410, body: { code: 'CURSOR_EXPIRED' } },
    },
    {
      name: 'a cursor ahead response',
      response: {
        status: 409,
        body: { code: 'CURSOR_AHEAD', bootstrapRequired: true },
      },
    },
  ])('full-bootstraps after $name while preserving the outbox', async ({ response }) => {
    const { gateway, transport, storage, clock } = createGateway();
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    transport.enqueue(response);
    transport.enqueue({
      status: 200,
      body: populatedBootstrap('4', {
        skus: [
          {
            ...populatedBootstrap().skus[0]!,
            name: 'Canonical resync',
            rowVersion: '4',
          },
        ],
      }),
    });

    await gateway.initialize();
    await clock.runNext();

    expect(gateway.getSnapshot().skus[0]?.name).toBe('Canonical resync');
    expect(gateway.getSyncSnapshot().serverRevision).toBe('4');
    expect((storage.value as CoreCacheEnvelope).outbox).toEqual([]);
    expect(transport.requests.map((request) => request.path)).toEqual([
      '/v1/bootstrap',
      '/v1/changes?after=1&limit=500',
      '/v1/bootstrap',
    ]);
  });

  it('does not advance the in-memory cursor when saving the whole page fails', async () => {
    const { gateway, transport, storage, clock } = createGateway();
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '2',
        nextAfter: '2',
        changes: [
          {
            revision: '2',
            entityType: 'sku_identifier',
            entityId: IDENTIFIER_ID,
            operation: 'upsert',
            payload: {
              ...populatedBootstrap().skuIdentifiers[0]!,
              identifierValue: 'SCAN-NEW',
            },
            createdAt: '2026-07-29T01:00:02.000Z',
          },
        ],
      },
    });

    await gateway.initialize();
    storage.failNextSave = true;
    await clock.runNext();

    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'offline',
      serverRevision: '1',
    });
    expect(gateway.getSnapshot().skus[0]?.aliases).toEqual(['SCAN-001']);
    expect(clock.pendingDelays()).toEqual([2_000]);
  });

  it('stops polling in the background and polls immediately on resume', async () => {
    const { gateway, transport, clock } = createGateway();
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await gateway.initialize();

    clock.foreground = false;
    await clock.runNext();
    expect(transport.requests).toHaveLength(1);
    expect(clock.pendingDelays()).toEqual([]);

    transport.enqueue({
      status: 200,
      body: { serverRevision: '1', nextAfter: '1', changes: [] },
    });
    await clock.resume();

    expect(transport.requests).toHaveLength(2);
    expect(clock.pendingDelays()).toEqual([2_000]);
  });

  it('uses capped exponential retry and manual retry runs immediately', async () => {
    const { gateway, transport, clock } = createGateway();
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    transport.enqueue(new Error('LAN down'));
    await gateway.initialize();

    await clock.runNext();
    expect(gateway.getSyncSnapshot().phase).toBe('offline');
    expect(clock.pendingDelays()).toEqual([2_000]);

    transport.enqueue(new Error('still down'));
    await clock.runNext();
    expect(clock.pendingDelays()).toEqual([4_000]);

    transport.enqueue({
      status: 200,
      body: { serverRevision: '1', nextAfter: '1', changes: [] },
    });
    await gateway.retryPending();
    expect(gateway.getSyncSnapshot().phase).toBe('online');
    expect(clock.pendingDelays()).toEqual([2_000]);
  });

  it.each([
    {
      status: 401,
      body: { code: 'UNAUTHORIZED' },
      phase: 'revoked',
    },
    {
      status: 426,
      body: { code: 'UPGRADE_REQUIRED' },
      phase: 'upgrade-required',
    },
  ] as const)('enters $phase for an explicit API terminal state', async (response) => {
    const { gateway, transport, clock } = createGateway();
    transport.enqueue({ status: response.status, body: response.body });

    await gateway.initialize();

    expect(gateway.getSyncSnapshot().phase).toBe(response.phase);
    expect(clock.pendingDelays()).toEqual([]);
  });

  it('rejects an unsupported cache version without using its state or the API', async () => {
    const storage = new MemoryStorage({
      cacheVersion: 99,
      state: {},
      serverRevision: '1',
      outbox: [],
    });
    const { gateway, transport } = createGateway(
      new ScriptedTransport(),
      storage,
    );

    await gateway.initialize();

    expect(gateway.getSyncSnapshot().phase).toBe('upgrade-required');
    expect(transport.requests).toEqual([]);
  });
});
