import { describe, expect, it } from 'vitest';

import {
  CORE_API_PATHS,
  type CoreConflict,
} from '../../src/gateway/core-api-types';
import type { CoreCacheEnvelope } from '../../src/gateway/core-operations-gateway';
import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import {
  LINE_ID,
  NOTA_ID,
  PAGE_ID,
  SKU_ID,
  MemoryStorage,
  ScriptedTransport,
  TestClock,
  deferred,
  populatedBootstrap,
} from './core-gateway-test-support';

function readyGateway() {
  const transport = new ScriptedTransport();
  const storage = new MemoryStorage();
  const clock = new TestClock();
  const gateway = createCoreOperationsGateway(transport, storage, clock);
  transport.enqueue({ status: 200, body: populatedBootstrap('1') });
  return { gateway, transport, storage, clock };
}

function emptyPoll(revision = '1') {
  return {
    status: 200,
    body: { serverRevision: revision, nextAfter: revision, changes: [] },
  };
}

describe('Core operations gateway mutation coordination', () => {
  it('validates, previews, commits, reboots, and reads cached images through approved routes', async () => {
    const { gateway, transport } = readyGateway();
    await gateway.initialize();
    const validation = {
      importId: '88888888-8888-4888-8888-888888888888',
      workbookSha256: 'a'.repeat(64),
      sourceFileName: 'catalogue.xlsx',
      status: 'staged',
      preview: {
        rowCount: 3_144,
        imageJobCount: 2_786,
        missingImageCount: 358,
        priceMismatchCount: 3,
        selectedPriceTotal: 276_267_011,
        stockTotal: 4_115,
        maximumCellTextLength: 168,
        warnings: [],
        priceMismatches: [],
      },
      expiresAt: '2026-07-31T00:00:00.000Z',
      committedAt: null,
    };
    transport.enqueue({ status: 200, body: validation });

    await expect(
      gateway.validateInitialCatalogue({
        fileName: 'catalogue.xlsx',
        workbookBase64: 'eGxzeA==',
      }),
    ).resolves.toEqual(validation);
    expect(transport.requests.at(-1)).toEqual({
      method: 'POST',
      path: '/v1/imports/validate',
      body: {
        fileName: 'catalogue.xlsx',
        workbookBase64: 'eGxzeA==',
      },
    });

    const receipt = {
      importId: validation.importId,
      workbookSha256: validation.workbookSha256,
      rowCount: 3_144,
      imageJobCount: 2_786,
      committedAt: '2026-07-30T02:00:00.000Z',
      replayed: false,
    };
    transport.enqueue({ status: 200, body: receipt });
    transport.enqueue({ status: 200, body: populatedBootstrap('2') });
    await expect(
      gateway.commitInitialCatalogue(validation.importId),
    ).resolves.toEqual(receipt);
    expect(transport.requests.at(-2)).toEqual({
      method: 'POST',
      path: `/v1/imports/${validation.importId}/commit`,
    });
    expect(transport.requests.at(-1)?.path).toBe('/v1/bootstrap');

    transport.enqueue({
      status: 200,
      body: {
        mimeType: 'image/png',
        bytesBase64: 'iVBORw==',
      },
    });
    await expect(
      gateway.loadSkuImage(gateway.getSnapshot().skus[0]!),
    ).resolves.toBe('data:image/png;base64,iVBORw==');
    expect(transport.requests.at(-1)).toEqual({
      method: 'GET',
      path: `/v1/images/${'a'.repeat(64)}`,
    });
  });

  it('persists one stable UUID idempotency key before first send and reuses it on manual retry', async () => {
    const { gateway, transport, storage } = readyGateway();
    await gateway.initialize();
    transport.enqueue((request) => {
      const persisted = storage.value as CoreCacheEnvelope;
      expect(persisted.outbox).toHaveLength(1);
      expect(persisted.outbox[0]?.idempotencyKey).toBe(request.idempotencyKey);
      throw new Error('socket closed');
    });

    await expect(
      gateway.adjustStock(SKU_ID, 2),
    ).rejects.toThrow('socket closed');

    const pending = (storage.value as CoreCacheEnvelope).outbox[0]!;
    expect(pending.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'offline',
      pendingCount: 1,
    });

    transport.enqueue({ status: 200, body: { serverRevision: '2' } });
    transport.enqueue(emptyPoll('1'));
    await gateway.retryPending();

    expect(transport.requests[1]?.idempotencyKey).toBe(
      transport.requests[2]?.idempotencyKey,
    );
    expect((storage.value as CoreCacheEnvelope).outbox).toEqual([]);
  });

  it('coalesces rapid Nota header patches into one persisted mutation', async () => {
    const { gateway, transport } = readyGateway();
    await gateway.initialize();
    const requestStarted = deferred<void>();
    const mutationResponse = deferred<{ status: number; body: unknown }>();
    transport.enqueue(async (request) => {
      expect(request.body).toEqual({
        patch: {
          customerName: 'Amina',
          customerPlace: 'Banjarbaru',
        },
      });
      requestStarted.resolve();
      return mutationResponse.promise;
    });
    transport.enqueue(emptyPoll());

    const first = gateway.updateNotaTransaction(NOTA_ID, {
      customerName: 'Amina',
    });
    const second = gateway.updateNotaTransaction(NOTA_ID, {
      customerPlace: 'Banjarbaru',
    });

    expect(gateway.getSnapshot().notaTransactions[0]).toMatchObject({
      customerName: 'Amina',
      customerPlace: 'Banjarbaru',
    });
    await requestStarted.promise;
    expect(
      transport.requests.filter((request) =>
        request.path.endsWith('/header'),
      ),
    ).toHaveLength(1);

    mutationResponse.resolve({ status: 200, body: { serverRevision: '1' } });
    await Promise.all([first, second]);
  });

  it('coalesces rapid template updates with last-writer-wins content', async () => {
    const { gateway, transport } = readyGateway();
    await gateway.initialize();
    const mutationResponse = deferred<{ status: number; body: unknown }>();
    const firstTemplate = {
      ...gateway.getSnapshot().labelTemplate,
      fontSize: 11,
    };
    const secondTemplate = { ...firstTemplate, fontSize: 12 };
    transport.enqueue((request) => {
      expect(request.body).toEqual({ definition: secondTemplate });
      return mutationResponse.promise;
    });
    transport.enqueue(emptyPoll());

    const first = gateway.setLabelTemplate(firstTemplate);
    const second = gateway.setLabelTemplate(secondTemplate);
    expect(gateway.getSnapshot().labelTemplate.fontSize).toBe(12);

    await Promise.resolve();
    mutationResponse.resolve({ status: 200, body: { serverRevision: '1' } });
    await Promise.all([first, second]);
    expect(
      transport.requests.filter((request) => request.path === '/v1/templates/label'),
    ).toHaveLength(1);
  });

  it('rolls back a failed optimistic line patch and exposes offline pending state', async () => {
    const { gateway, transport } = readyGateway();
    await gateway.initialize();
    transport.enqueue(new Error('LAN unavailable'));

    const update = gateway.updateNotaLine(
      NOTA_ID,
      PAGE_ID,
      LINE_ID,
      { description: 'Nama optimistis' },
    );
    expect(
      gateway.getSnapshot().notaTransactions[0]?.pages[0]?.lines[0]?.description,
    ).toBe('Nama optimistis');

    await expect(update).rejects.toThrow('LAN unavailable');

    expect(
      gateway.getSnapshot().notaTransactions[0]?.pages[0]?.lines[0]?.description,
    ).toBe('Produk Core');
    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'offline',
      pendingCount: 1,
    });
  });

  it('flushes every Nota patch before sending completion', async () => {
    const { gateway, transport } = readyGateway();
    await gateway.initialize();
    const headerResponse = deferred<{ status: number; body: unknown }>();
    transport.enqueue(() => headerResponse.promise);
    transport.enqueue(emptyPoll());
    transport.enqueue({ status: 200, body: { serverRevision: '2' } });
    transport.enqueue(emptyPoll());

    const header = gateway.updateNotaTransaction(NOTA_ID, {
      customerName: 'Amina',
    });
    const completion = gateway.completeNotaTransaction(NOTA_ID);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (transport.requests.length >= 2) break;
      await Promise.resolve();
    }

    expect(transport.requests.map((request) => request.path)).toEqual([
      '/v1/bootstrap',
      CORE_API_PATHS.notaHeader(NOTA_ID),
    ]);

    headerResponse.resolve({ status: 200, body: { serverRevision: '1' } });
    await header;
    await completion;

    const headerIndex = transport.requests.findIndex((request) =>
      request.path.endsWith('/header'),
    );
    const completeIndex = transport.requests.findIndex((request) =>
      request.path.endsWith('/complete'),
    );
    expect(completeIndex).toBeGreaterThan(headerIndex);
  });

  it('stores a typed conflict and resolves it through the dedicated endpoint', async () => {
    const { gateway, transport } = readyGateway();
    await gateway.initialize();
    const conflict: CoreConflict = {
      id: '88888888-8888-4888-8888-888888888888',
      entityType: 'nota',
      entityId: NOTA_ID,
      field: 'customerName',
      base: 'Amelia',
      mine: 'Amina',
      server: 'Amelia Baru',
    };
    transport.enqueue({
      status: 409,
      body: { code: 'CONFLICT', conflict },
    });

    await expect(
      gateway.updateNotaTransaction(NOTA_ID, { customerName: 'Amina' }),
    ).rejects.toThrow('CONFLICT');
    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'conflict',
      conflictCount: 1,
    });

    transport.enqueue({ status: 200, body: { serverRevision: '2' } });
    transport.enqueue(emptyPoll());
    await gateway.resolveConflict(conflict.id, 'server');

    expect(transport.requests.at(-2)).toMatchObject({
      method: 'POST',
      path: CORE_API_PATHS.resolveConflict(conflict.id),
      body: { choice: 'server' },
    });
  });

  it('rejects Nota flush immediately when a queued write is in conflict', async () => {
    const { gateway, transport } = readyGateway();
    await gateway.initialize();
    transport.enqueue({
      status: 409,
      body: {
        code: 'CONFLICT',
        conflict: {
          id: '88888888-8888-4888-8888-888888888888',
          entityType: 'nota',
          entityId: NOTA_ID,
          field: 'customerName',
          base: 'Amelia',
          mine: 'Amina',
          server: 'Amelia Baru',
        },
      },
    });
    await expect(
      gateway.updateNotaTransaction(NOTA_ID, { customerName: 'Amina' }),
    ).rejects.toThrow('CONFLICT');

    const outcome = await Promise.race([
      gateway.flushNota(NOTA_ID).then(
        () => 'resolved',
        () => 'rejected',
      ),
      new Promise<'pending'>((resolve) => {
        setTimeout(() => resolve('pending'), 0);
      }),
    ]);

    expect(outcome).toBe('rejected');
  });

  it('never resets production data or calls transport for reset', async () => {
    const { gateway, transport } = readyGateway();
    await gateway.initialize();
    const requestCount = transport.requests.length;

    expect(gateway.capabilities).toEqual({
      canResetDemoData: false,
      canImportInitialCatalogue: false,
      canStageInitialCatalogue: true,
    });
    await expect(gateway.reset()).rejects.toThrow(
      'Reset data demo tidak tersedia',
    );
    expect(transport.requests).toHaveLength(requestCount);
  });
});
