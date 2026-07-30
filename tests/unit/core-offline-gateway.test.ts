import { describe, expect, it } from 'vitest';

import type { CoreLocalEnvelope } from '../../src/gateway/core-local-store';
import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import {
  SKU_ID,
  MemoryStorage,
  ScriptedTransport,
  TestClock,
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

describe('Core offline permission matrix', () => {
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
});
