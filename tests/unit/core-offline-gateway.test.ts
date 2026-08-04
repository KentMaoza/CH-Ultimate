import { describe, expect, it } from 'vitest';

import {
  CoreLocalStore,
  type CoreLocalEnvelope,
} from '../../src/gateway/core-local-store';
import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import { CoreDeferredOutbox } from '../../src/gateway/core-outbox';
import {
  NOTA_ID,
  SKU_ID,
  MemoryStorage,
  ScriptedTransport,
  TestClock,
  deferred,
  populatedBootstrap,
} from './core-gateway-test-support';
import { mapCoreBootstrapToDemoState } from '../../src/gateway/core-bootstrap-mapping';
import { parseCoreBootstrap } from '../../src/gateway/core-api-types';

function cachedState() {
  return {
    cacheVersion: 1 as const,
    state: mapCoreBootstrapToDemoState(
      parseCoreBootstrap(populatedBootstrap('7')),
    ),
    serverRevision: '7',
    outbox: [],
  };
}

function pendingV1NotaCache() {
  return {
    ...cachedState(),
    outbox: [
      {
        id: '20202020-2020-4020-8020-202020202020',
        idempotencyKey: '20202020-2020-4020-8020-202020202020',
        method: 'PATCH' as const,
        path: `/v1/notas/${NOTA_ID}/header`,
        body: { patch: { customerName: 'Jangan pindahkan' } },
        createdAt: '2026-07-30T01:00:00.000Z',
        notaId: NOTA_ID,
      },
    ],
  };
}

async function offlineGateway() {
  const storage = new MemoryStorage(cachedState());
  const transport = new ScriptedTransport();
  transport.enqueue(new Error('wifi down'));
  const gateway = createCoreOperationsGateway(
    transport,
    storage,
    new TestClock(),
  );
  await gateway.initialize();
  expect(gateway.getSyncSnapshot().phase).toBe('offline');
  return { gateway, storage, transport };
}

async function settleUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Condition did not settle.');
}

describe('Core offline permission matrix', () => {
  it('fails closed visibly without rewriting or retrying a v1 cache that owns pending work', async () => {
    const storage = new MemoryStorage(pendingV1NotaCache());
    const before = JSON.stringify(storage.value);
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
    );

    await expect(gateway.initialize()).resolves.toBeUndefined();

    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'upgrade-required',
      message: 'Cache aplikasi tidak kompatibel.',
    });
    expect(JSON.stringify(storage.value)).toBe(before);
    expect(storage.saves).toEqual([]);
    expect(transport.requests).toEqual([]);

    await expect(gateway.flushNota(NOTA_ID)).rejects.toMatchObject({
      name: 'CoreGatewayNetworkBlockedError',
      code: 'UPGRADE_REQUIRED',
    });
    await expect(gateway.retryPending()).rejects.toMatchObject({
      name: 'CoreGatewayNetworkBlockedError',
      code: 'UPGRADE_REQUIRED',
    });

    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'upgrade-required',
      message: 'Cache aplikasi tidak kompatibel.',
    });
    expect(JSON.stringify(storage.value)).toBe(before);
    expect(storage.saves).toEqual([]);
    expect(transport.requests).toEqual([]);
  });

  it('does not fetch a cached SKU image after v1 ownership validation fails', async () => {
    const storage = new MemoryStorage(pendingV1NotaCache());
    const before = JSON.stringify(storage.value);
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
    );
    await gateway.initialize();
    const sku = gateway.getSnapshot().skus[0]!;

    await expect(gateway.loadSkuImage(sku)).rejects.toMatchObject({
      name: 'CoreGatewayNetworkBlockedError',
      code: 'UPGRADE_REQUIRED',
    });

    expect(JSON.stringify(storage.value)).toBe(before);
    expect(storage.saves).toEqual([]);
    expect(transport.requests).toEqual([]);
  });

  it('fails closed visibly without rewriting or sending a v2 cache that owns pending work', async () => {
    const pendingV2 = {
      cacheVersion: 2 as const,
      installationId: '11111111-1111-4111-8111-111111111111',
      state: cachedState().state,
      serverRevision: '7',
      outbox: [
        {
          id: '20202020-2020-4020-8020-202020202020',
          idempotencyKey: '20202020-2020-4020-8020-202020202020',
          method: 'PATCH' as const,
          path: `/v1/skus/${SKU_ID}`,
          body: { patch: { name: 'Jangan pindahkan' } },
          createdAt: '2026-07-30T01:00:00.000Z',
        },
      ],
      deferredOutbox: [],
      provisionalNotas: [],
      offlineConflicts: [],
      quarantine: { active: false },
    };
    const storage = new MemoryStorage(pendingV2 as never);
    const before = structuredClone(storage.value);
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
    );

    await expect(gateway.initialize()).resolves.toBeUndefined();

    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'upgrade-required',
      message: 'Cache aplikasi tidak kompatibel.',
    });
    expect(storage.value).toEqual(before);
    expect(transport.requests).toEqual([]);
  });

  it('fails closed visibly without rewriting or sending a v3 cache owned by another native installation', async () => {
    const storage = new MemoryStorage();
    const originalInstallation =
      '10101010-1010-4010-8010-101010101010';
    const store = new CoreLocalStore(
      storage,
      () => originalInstallation,
    );
    await store.update((envelope) => envelope);
    const before = structuredClone(storage.value);
    const transport = new ScriptedTransport();
    transport.nativeInstallationId =
      '11111111-1111-4111-8111-111111111111';
    const gateway = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
    );

    await expect(gateway.initialize()).resolves.toBeUndefined();

    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'upgrade-required',
      message: 'Cache aplikasi tidak kompatibel.',
    });
    expect(storage.value).toEqual(before);
    expect(transport.requests).toEqual([]);
  });

  it('stops a live normal queue when a concurrent deferred command receives 401', async () => {
    const storage = new MemoryStorage();
    const installationId = '10101010-1010-4010-8010-101010101010';
    const preparedStore = new CoreLocalStore(storage, () => installationId);
    const preparedDeferred = new CoreDeferredOutbox(
      preparedStore,
      new ScriptedTransport(),
      {
        now: () => new Date('2026-07-30T02:00:00.000Z'),
        uuid: () => '20202020-2020-4020-8020-202020202020',
      },
    );
    await preparedDeferred.deferStock({
      skuId: SKU_ID,
      skuIdentifier: 'SKU-001',
      skuName: 'Produk Core',
      referencePrice: 25_000,
      delta: 1,
      reason: 'Koreksi',
    });

    const transport = new ScriptedTransport();
    const deferredResponse = deferred<{
      status: number;
      body: unknown;
    }>();
    const normalAResponse = deferred<{
      status: number;
      body: unknown;
    }>();
    transport.enqueue({ status: 200, body: populatedBootstrap('8') });
    transport.enqueue(() => deferredResponse.promise);
    const gateway = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
    );
    const initializing = gateway.initialize();
    await settleUntil(() => transport.requests.length === 2);

    transport.enqueue(() => normalAResponse.promise);
    const mutationA = gateway.updateSku(SKU_ID, { name: 'Mutasi A' });
    await settleUntil(() => transport.requests.length === 3);
    const mutationB = gateway.setArchived(SKU_ID, true);
    await settleUntil(
      () =>
        (
          storage.value as unknown as CoreLocalEnvelope
        ).outbox?.length === 2,
    );

    deferredResponse.resolve({
      status: 401,
      body: { code: 'UNAUTHORIZED' },
    });
    await initializing;

    const quarantined = storage.value as unknown as CoreLocalEnvelope;
    expect(quarantined.outbox).toEqual([]);
    expect(quarantined.quarantinedOutbox).toHaveLength(2);
    expect(gateway.getSyncSnapshot().phase).toBe('revoked');

    normalAResponse.resolve({
      status: 200,
      body: {
        serverRevision: '9',
        entityId: SKU_ID,
        entityVersion: '2',
        entity: {
          ...populatedBootstrap('8').skus[0],
          name: 'Mutasi A',
          rowVersion: '2',
        },
      },
    });

    await expect(mutationA).resolves.toBeUndefined();
    await expect(mutationB).rejects.toThrow('Akses perangkat dicabut');
    expect(transport.requests).toHaveLength(3);
    expect(gateway.getSyncSnapshot().phase).toBe('revoked');
    expect(
      (storage.value as unknown as CoreLocalEnvelope).quarantinedOutbox,
    ).toHaveLength(2);
  });

  it('quarantines the normal mutation queue on 401 and resumes it only for the same native installation', async () => {
    const storage = new MemoryStorage(cachedState());
    const transport = new ScriptedTransport();
    const clock = new TestClock();
    transport.enqueue({
      status: 200,
      body: populatedBootstrap('8'),
    });
    const gateway = createCoreOperationsGateway(transport, storage, clock);
    await gateway.initialize();
    transport.enqueue({ status: 401, body: { code: 'UNAUTHORIZED' } });

    await expect(
      gateway.updateSku(SKU_ID, { name: 'Tertahan' }),
    ).rejects.toThrow('UNAUTHORIZED');

    const quarantined = storage.value as unknown as CoreLocalEnvelope;
    expect(quarantined.quarantine).toMatchObject({
      active: true,
      installationId: transport.nativeInstallationId,
    });
    expect(quarantined.outbox).toEqual([]);
    expect(Reflect.get(quarantined, 'quarantinedOutbox')).toHaveLength(1);
    transport.nativeInstallationId =
      '11111111-1111-4111-8111-111111111111';
    transport.enqueue({
      status: 200,
      body: populatedBootstrap('9'),
    });
    await gateway.retryPending();
    expect(gateway.getSyncSnapshot().phase).toBe('revoked');
    expect(transport.requests).toHaveLength(3);

    transport.nativeInstallationId =
      '10101010-1010-4010-8010-101010101010';
    transport.enqueue({
      status: 200,
      body: populatedBootstrap('10'),
    });
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '11',
        entityId: SKU_ID,
        entityVersion: '2',
        entity: {
          ...populatedBootstrap('10').skus[0],
          name: 'Tertahan',
          rowVersion: '2',
        },
      },
    });
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '11',
        nextAfter: '10',
        changes: [],
      },
    });
    await gateway.retryPending();

    expect(gateway.getSyncSnapshot()).toMatchObject({ phase: 'online' });
    expect(
      (storage.value as unknown as CoreLocalEnvelope).quarantinedOutbox,
    ).toEqual([]);
  });

  it('fails closed before connectivity is known or when the device is revoked', async () => {
    const connecting = createCoreOperationsGateway(
      new ScriptedTransport(),
      new MemoryStorage(cachedState()),
      new TestClock(),
    );
    await expect(async () =>
      connecting.createSku({
        skuNumber: 'NEW',
        name: 'Baru',
        referencePrice: 1,
        openingStock: 0,
        tracked: true,
      }),
    ).rejects.toThrow('Status sinkronisasi belum mengizinkan perubahan.');

    const storage = new MemoryStorage(cachedState());
    const transport = new ScriptedTransport();
    transport.enqueue({ status: 401, body: { code: 'UNAUTHORIZED' } });
    const revoked = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
    );
    await revoked.initialize();
    expect(revoked.getSyncSnapshot().phase).toBe('revoked');
    await expect(revoked.createNotaTransaction()).rejects.toThrow(
      'Akses perangkat dicabut.',
    );
  });

  it('marks corrupt v2 cache as upgrade-required without rewriting it', async () => {
    const corrupt = {
      cacheVersion: 2,
      installationId: '10101010-1010-4010-8010-101010101010',
      state: cachedState().state,
      serverRevision: 'bad',
      outbox: [],
      deferredOutbox: [],
      provisionalNotas: [],
      offlineConflicts: [],
      quarantine: { active: false },
    };
    const storage = new MemoryStorage(corrupt as never);
    const before = structuredClone(storage.value);
    const gateway = createCoreOperationsGateway(
      new ScriptedTransport(),
      storage,
      new TestClock(),
    );

    await gateway.initialize();

    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'upgrade-required',
      message: 'Cache aplikasi tidak kompatibel.',
    });
    expect(storage.value).toEqual(before);
  });

  it('allows only a new local Nota and a reasoned signed stock delta', async () => {
    const { gateway, storage, transport } = await offlineGateway();

    const nota = await gateway.createNotaTransaction();
    await gateway.adjustStock(SKU_ID, -2, 'Barang rusak saat diterima');

    expect(nota.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const persisted = storage.value as unknown as CoreLocalEnvelope;
    expect(persisted.provisionalNotas).toHaveLength(1);
    expect(persisted.deferredOutbox).toHaveLength(2);
    expect(persisted.deferredOutbox[1]).toMatchObject({
      kind: 'stock-delta',
      payload: {
        skuId: SKU_ID,
        delta: -2,
        reason: 'Barang rusak saat diterima',
        skuIdentifier: 'SKU-001',
        skuName: 'Produk Core',
        referencePrice: 25_000,
      },
    });
    expect(transport.requests).toHaveLength(1);
  });

  it('persists an absolute stock count before optimism and replays the immutable forced request after restart', async () => {
    const clock = new TestClock();
    clock.current = new Date('2026-08-04T02:00:00.000Z');
    const observedBootstrap = populatedBootstrap('7');
    observedBootstrap.balances = [
      {
        ...observedBootstrap.balances[0],
        quantityPcs: '10',
        rowVersion: '4',
      },
    ];
    const storage = new MemoryStorage();
    const seedTransport = new ScriptedTransport();
    seedTransport.enqueue({ status: 200, body: observedBootstrap });
    const seeded = createCoreOperationsGateway(seedTransport, storage, clock);
    await seeded.initialize();
    seeded.dispose();
    const offlineTransport = new ScriptedTransport();
    offlineTransport.enqueue(new Error('wifi down'));
    const offline = createCoreOperationsGateway(
      offlineTransport,
      storage,
      clock,
    );
    await offline.initialize();
    let commandWasDurableBeforeProjection = false;
    const unsubscribe = offline.subscribe(() => {
      if (offline.getSnapshot().skus[0]?.stock !== 8) return;
      const envelope = storage.value as unknown as CoreLocalEnvelope;
      commandWasDurableBeforeProjection =
        envelope.deferredOutbox[0]?.kind === 'stock-count';
    });

    await offline.checkStock(SKU_ID, 8, '  Hitung rak depan  ');
    unsubscribe();

    const queued = storage.value as unknown as CoreLocalEnvelope;
    expect(commandWasDurableBeforeProjection).toBe(true);
    expect(offline.getSnapshot().skus[0]).toMatchObject({
      stock: 8,
      lastStockCheckedAt: clock.now().toISOString(),
    });
    expect(queued.deferredOutbox).toEqual([
      expect.objectContaining({
        kind: 'stock-count',
        sequence: 1,
        payload: {
          skuId: SKU_ID,
          observedQuantityPcs: 10,
          countedQuantityPcs: 8,
          baseBalanceVersion: '4',
          countedAt: clock.now().toISOString(),
          note: 'Hitung rak depan',
        },
      }),
    ]);
    offline.dispose();

    const serverCheck = {
      id: '89898989-8989-4989-8989-898989898989',
      skuId: SKU_ID,
      observedQuantityPcs: '10',
      countedQuantityPcs: '8',
      serverQuantityBeforePcs: '7',
      appliedDeltaPcs: '1',
      baseBalanceVersion: '4',
      forcedOffline: true,
      countedAt: clock.now().toISOString(),
      appliedAt: '2026-08-04T02:01:00.000Z',
      deviceId: '66666666-6666-4666-8666-666666666666',
      deviceDisplayName: 'Android Gudang',
      note: 'Hitung rak depan',
    };
    const firstReplayTransport = new ScriptedTransport();
    const serverBeforeReplay = populatedBootstrap('8');
    serverBeforeReplay.balances = [
      {
        ...serverBeforeReplay.balances[0],
        quantityPcs: '7',
        rowVersion: '5',
      },
    ];
    firstReplayTransport.enqueue({ status: 200, body: serverBeforeReplay });
    firstReplayTransport.enqueue(new Error('response lost after apply'));
    const firstReplay = createCoreOperationsGateway(
      firstReplayTransport,
      storage,
      clock,
    );
    await firstReplay.initialize();
    const immutableRequest = firstReplayTransport.requests[1]!;
    expect(immutableRequest).toMatchObject({
      method: 'POST',
      path: '/v1/offline/stock-checks',
      body: queued.deferredOutbox[0]?.payload,
      idempotencyKey: queued.deferredOutbox[0]?.idempotencyKey,
    });
    firstReplay.dispose();

    const duplicateReplayTransport = new ScriptedTransport();
    const appliedBootstrap = populatedBootstrap('9');
    appliedBootstrap.balances = [
      {
        ...appliedBootstrap.balances[0],
        quantityPcs: '8',
        rowVersion: '6',
        lastCheckedAt: clock.now().toISOString(),
      },
    ];
    appliedBootstrap.stockChecks = [serverCheck];
    duplicateReplayTransport.enqueue({ status: 200, body: appliedBootstrap });
    duplicateReplayTransport.enqueue({
      status: 200,
      body: {
        serverRevision: '9',
        entityVersion: '6',
        entity: serverCheck,
      },
    });
    const duplicateReplay = createCoreOperationsGateway(
      duplicateReplayTransport,
      storage,
      clock,
    );
    await duplicateReplay.initialize();

    expect(duplicateReplayTransport.requests[1]).toEqual(immutableRequest);
    expect(duplicateReplay.getSnapshot().skus[0]?.stock).toBe(8);
    expect(duplicateReplay.getSnapshot().stockChecks).toEqual([
      expect.objectContaining({
        id: serverCheck.id,
        observedQuantityPcs: 10,
        countedQuantityPcs: 8,
        serverQuantityBeforePcs: 7,
        appliedDeltaPcs: 1,
        forcedOffline: true,
      }),
    ]);
    expect(
      (storage.value as unknown as CoreLocalEnvelope).deferredOutbox,
    ).toEqual([]);
    expect(
      (storage.value as unknown as CoreLocalEnvelope).balanceVersions[SKU_ID],
    ).toBe('6');
  });

  it('rejects every shared mutation with visible Indonesian read-only copy', async () => {
    const { gateway } = await offlineGateway();
    const sku = gateway.getSnapshot().skus[0]!;
    const nota = gateway.getSnapshot().notaTransactions[0]!;
    const page = nota.pages[0]!;
    const line = page.lines[0]!;
    const blocked = [
      () => gateway.createSku({
        skuNumber: 'NEW',
        name: 'Baru',
        referencePrice: 1,
        openingStock: 0,
        tracked: true,
      }),
      () => gateway.updateSku(sku.id, { name: 'Tidak boleh' }),
      () => gateway.setArchived(sku.id, true),
      () => gateway.setLabelTemplate(gateway.getSnapshot().labelTemplate),
      () => gateway.setInvoiceTemplate(gateway.getSnapshot().invoiceTemplate),
      () => gateway.updateNotaTransaction(nota.id, { customerName: 'X' }),
      () => gateway.updateNotaLine(nota.id, page.id, line.id, { quantity: 2 }),
      () => gateway.deleteNotaLine(nota.id, page.id, line.id),
      () => gateway.addNotaPage(nota.id),
      () => gateway.cancelNotaPage(nota.id, page.id),
      () => gateway.restoreNotaPage(nota.id, page.id),
      () => gateway.completeNotaTransaction(nota.id),
      () => gateway.reopenNotaTransaction(nota.id),
      () => gateway.cancelNotaTransaction(nota.id),
      () => gateway.restoreNotaTransaction(nota.id),
      () => gateway.validateInitialCatalogue({
        fileName: 'x.xlsx',
        workbookBase64: 'eA==',
      }),
      () => gateway.commitInitialCatalogue(
        '88888888-8888-4888-8888-888888888888',
      ),
    ];

    for (const operation of blocked) {
      await expect(operation()).rejects.toThrow(
        'Mode offline: data bersama hanya dapat dibaca.',
      );
    }
  });

  it('requires a nonzero safe stock delta and bounded reason offline', async () => {
    const { gateway } = await offlineGateway();

    await expect(gateway.adjustStock(SKU_ID, 0, 'Koreksi')).rejects.toThrow(
      'Delta stok offline',
    );
    await expect(gateway.adjustStock(SKU_ID, 1)).rejects.toThrow(
      'Alasan perubahan stok offline wajib diisi.',
    );
    await expect(
      gateway.adjustStock(SKU_ID, 1, 'x'.repeat(513)),
    ).rejects.toThrow('maksimal 512');
  });
});

describe('Core local Nota projection', () => {
  it('keeps every first-sent provisional Nota mutation on the guarded local route', async () => {
    const cases = [
      {
        name: 'header',
        run: (
          gateway: ReturnType<typeof createCoreOperationsGateway>,
          notaId: string,
        ) => gateway.updateNotaTransaction(notaId, { customerName: 'Terlambat' }),
      },
      {
        name: 'line',
        run: (
          gateway: ReturnType<typeof createCoreOperationsGateway>,
          notaId: string,
          pageId: string,
          lineId: string,
        ) => gateway.updateNotaLine(notaId, pageId, lineId, { quantity: 3 }),
      },
      {
        name: 'delete line',
        run: (
          gateway: ReturnType<typeof createCoreOperationsGateway>,
          notaId: string,
          pageId: string,
          lineId: string,
        ) => gateway.deleteNotaLine(notaId, pageId, lineId),
      },
      {
        name: 'add page',
        run: (
          gateway: ReturnType<typeof createCoreOperationsGateway>,
          notaId: string,
        ) => gateway.addNotaPage(notaId),
      },
      {
        name: 'cancel page',
        run: (
          gateway: ReturnType<typeof createCoreOperationsGateway>,
          notaId: string,
          pageId: string,
        ) => gateway.cancelNotaPage(notaId, pageId),
      },
      {
        name: 'restore page',
        run: (
          gateway: ReturnType<typeof createCoreOperationsGateway>,
          notaId: string,
          _pageId: string,
          _lineId: string,
          cancelledPageId?: string,
        ) => gateway.restoreNotaPage(notaId, cancelledPageId!),
      },
      {
        name: 'completion',
        run: (
          gateway: ReturnType<typeof createCoreOperationsGateway>,
          notaId: string,
        ) => gateway.completeNotaTransaction(notaId),
      },
      {
        name: 'reopen transaction',
        run: (
          gateway: ReturnType<typeof createCoreOperationsGateway>,
          notaId: string,
        ) => gateway.reopenNotaTransaction(notaId),
      },
      {
        name: 'cancel transaction',
        run: (
          gateway: ReturnType<typeof createCoreOperationsGateway>,
          notaId: string,
        ) => gateway.cancelNotaTransaction(notaId),
      },
      {
        name: 'restore transaction',
        run: (
          gateway: ReturnType<typeof createCoreOperationsGateway>,
          notaId: string,
        ) => gateway.restoreNotaTransaction(notaId),
      },
    ];

    for (const testCase of cases) {
      const { gateway, transport } = await offlineGateway();
      const nota = await gateway.createNotaTransaction();
      const page = nota.pages[0]!;
      const line = page.lines[0]!;
      await gateway.updateNotaLine(nota.id, page.id, line.id, {
        skuId: SKU_ID,
        description: 'Produk Core',
        quantity: 1,
        pcsPrice: 25_000,
        lsnPrice: 300_000,
      });
      const second = await gateway.addNotaPage(nota.id);
      await gateway.addNotaPage(nota.id);
      await gateway.cancelNotaPage(nota.id, second!.id);
      transport.enqueue({
        status: 200,
        body: populatedBootstrap('9'),
      });
      transport.enqueue(new Error('response lost'));

      await gateway.retryPending();

      const requestsBeforeEdit = transport.requests.length;
      await expect(
        async () =>
          testCase.run(gateway, nota.id, page.id, line.id, second!.id),
        testCase.name,
      ).rejects.toThrow('Sedang sinkronisasi');
      expect(transport.requests, testCase.name).toHaveLength(
        requestsBeforeEdit,
      );
      gateway.dispose();
    }
  });

  it('does not restore a page on a completed offline Nota', async () => {
    const { gateway } = await offlineGateway();
    const nota = await gateway.createNotaTransaction();
    const page = nota.pages[0]!;
    const line = page.lines[0]!;
    await gateway.updateNotaLine(nota.id, page.id, line.id, {
      skuId: SKU_ID,
      description: 'Produk Core',
      quantity: 1,
      pcsPrice: 25_000,
      lsnPrice: 300_000,
    });
    const second = await gateway.addNotaPage(nota.id);
    await gateway.cancelNotaPage(nota.id, second!.id);
    await gateway.completeNotaTransaction(nota.id);

    await expect(
      gateway.restoreNotaPage(nota.id, second!.id),
    ).rejects.toThrow('Nota offline yang selesai tidak dapat diubah.');
  });

  it('persists full local edits and completion without changing central stock or omzet', async () => {
    const { gateway, storage } = await offlineGateway();
    const before = gateway.getSnapshot();
    const nota = await gateway.createNotaTransaction();
    const firstPage = nota.pages[0]!;
    const firstLine = firstPage.lines[0]!;

    await gateway.updateNotaTransaction(nota.id, {
      customerName: 'Toko Offline',
      customerPlace: 'Samarinda',
    });
    await gateway.updateNotaLine(nota.id, firstPage.id, firstLine.id, {
      skuId: SKU_ID,
      description: 'Produk Core',
      quantity: 2,
      unit: 'pcs',
      pcsPrice: 25_000,
      lsnPrice: 300_000,
    });
    const added = await gateway.addNotaPage(nota.id);
    expect(added?.suffix).toBe('B');
    await gateway.completeNotaTransaction(nota.id, 'finished');

    const completed = gateway
      .getSnapshot()
      .notaTransactions.find((candidate) => candidate.id === nota.id);
    expect(completed).toMatchObject({
      customerName: 'Toko Offline',
      customerPlace: 'Samarinda',
      status: 'completed',
      completionDestination: 'finished',
      postedLines: [],
      postedStockEffects: {},
    });
    expect(gateway.getSnapshot().skus).toEqual(before.skus);
    expect(gateway.getSnapshot().revenuePostings).toEqual(
      before.revenuePostings,
    );
    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'offline',
      pendingCount: 1,
      message:
        'Menunggu sinkronisasi — stok dan omzet pusat belum berubah.',
    });

    const persisted = storage.value as unknown as CoreLocalEnvelope;
    expect(persisted.deferredOutbox).toHaveLength(1);
    expect(persisted.deferredOutbox[0]).toMatchObject({
      kind: 'offline-nota',
      payload: {
        completed: true,
        destination: 'finished',
        snapshot: {
          customerName: 'Toko Offline',
          pages: [{ suffix: 'A' }, { suffix: 'B' }],
        },
      },
    });
  });

  it('preserves the provisional Nota through bootstrap then atomically replaces its ID on acknowledgement', async () => {
    const { gateway, storage, transport } = await offlineGateway();
    const provisional = await gateway.createNotaTransaction();
    const page = provisional.pages[0]!;
    const line = page.lines[0]!;
    await gateway.updateNotaLine(provisional.id, page.id, line.id, {
      skuId: SKU_ID,
      description: 'Produk Core',
      quantity: 1,
      pcsPrice: 25_000,
      lsnPrice: 300_000,
    });
    const officialId = '90909090-9090-4090-8090-909090909090';
    const official = {
      ...gateway
        .getSnapshot()
        .notaTransactions.find((nota) => nota.id === provisional.id)!,
      id: officialId,
      baseNumber: 'CHU-20260730-0001',
      pages: gateway
        .getSnapshot()
        .notaTransactions.find((nota) => nota.id === provisional.id)!
        .pages.map((candidate) => ({
          ...candidate,
          id: crypto.randomUUID(),
          lines: candidate.lines.map((candidateLine) => ({
            ...candidateLine,
            id: crypto.randomUUID(),
          })),
        })),
    };
    transport.enqueue({
      status: 200,
      body: populatedBootstrap('9'),
    });
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '10',
        entityId: officialId,
        entityVersion: '1',
        entity: official,
      },
    });

    await gateway.retryPending();

    const projected = gateway.getSnapshot().notaTransactions;
    expect(projected.some((nota) => nota.id === provisional.id)).toBe(false);
    expect(projected.find((nota) => nota.id === officialId)?.baseNumber).toBe(
      'CHU-20260730-0001',
    );
    const persisted = storage.value as unknown as CoreLocalEnvelope;
    expect(persisted.provisionalNotas).toEqual([]);
    expect(persisted.deferredOutbox).toEqual([]);
    expect(transport.requests.slice(-2).map((request) => request.path)).toEqual([
      '/v1/bootstrap',
      '/v1/offline/notas',
    ]);
  });

  it('uses the authoritative stock acknowledgement without retaining a synthetic movement', async () => {
    const { gateway, storage, transport } = await offlineGateway();
    await gateway.adjustStock(SKU_ID, 2, 'Koreksi hitung');
    transport.enqueue({
      status: 200,
      body: populatedBootstrap('9'),
    });
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '11',
        entityId: SKU_ID,
        entityVersion: '3',
        entity: {
          skuId: SKU_ID,
          quantityPcs: '20',
          rowVersion: '3',
          updatedAt: '2026-07-30T03:00:00.000Z',
        },
      },
    });

    await gateway.retryPending();

    expect(gateway.getSnapshot().skus[0]?.stock).toBe(20);
    expect(gateway.getSnapshot().adjustments).toEqual([]);
    expect(
      (storage.value as unknown as CoreLocalEnvelope).balanceVersions[SKU_ID],
    ).toBe('3');

    const movementId = '12121212-1212-4121-8121-121212121212';
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '11',
        nextAfter: '11',
        changes: [
          {
            revision: '10',
            entityType: 'stock_balance',
            entityId: SKU_ID,
            operation: 'upsert',
            payload: {
              skuId: SKU_ID,
              quantityPcs: '20',
              rowVersion: '3',
              updatedAt: '2026-07-30T03:00:00.000Z',
            },
            createdAt: '2026-07-30T03:00:00.000Z',
          },
          {
            revision: '11',
            entityType: 'stock_movement',
            entityId: movementId,
            operation: 'upsert',
            payload: {
              id: movementId,
              skuId: SKU_ID,
              deltaPcs: '2',
              beforeQuantityPcs: '18',
              afterQuantityPcs: '20',
              reason: 'Koreksi hitung',
              deviceId: '66666666-6666-4666-8666-666666666666',
              operationId: '13131313-1313-4131-8131-131313131313',
              createdAt: '2026-07-30T03:00:00.000Z',
            },
            createdAt: '2026-07-30T03:00:00.000Z',
          },
        ],
      },
    });

    await gateway.retryPending();

    expect(gateway.getSnapshot().adjustments).toEqual([
      expect.objectContaining({
        id: movementId,
        quantity: 2,
        before: 18,
        after: 20,
      }),
    ]);
    expect(gateway.getSnapshot().skus[0]?.stock).toBe(20);
  });
});
