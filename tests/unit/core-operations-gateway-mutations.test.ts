import { describe, expect, it, vi } from 'vitest';

import {
  CORE_API_PATHS,
  type CoreConflict,
} from '../../src/gateway/core-api-types';
import type { CoreCacheEnvelope } from '../../src/gateway/core-operations-gateway';
import {
  createCoreOperationsGateway,
  type CoreOperationsGateway,
} from '../../src/gateway/core-operations-gateway';
import { mapCoreBootstrapToDemoState } from '../../src/gateway/core-bootstrap-mapping';
import { CoreGatewayState } from '../../src/gateway/core-gateway-state';
import { parseCoreBootstrap } from '../../src/gateway/core-api-types';
import { asCoreJson } from '../../src/gateway/core-optimistic-state';
import {
  LINE_ID,
  NOTA_ID,
  PAGE_ID,
  SKU_ID,
  MemoryStorage,
  ScriptedTransport,
  TestClock,
  deferred,
  exactCatalogueBootstrap,
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

interface DirectSchemaCase {
  label: string;
  source:
    | 'catalogue-validation'
    | 'catalogue-commit'
    | 'catalogue-image'
    | 'sku-image';
  response: { status: number; body: unknown };
  errorName: 'CoreApiSchemaError' | 'CoreApiUpgradeRequiredError';
  detail: string;
  invoke(gateway: CoreOperationsGateway): Promise<unknown>;
}

const directSchemaCases: DirectSchemaCase[] = [
  {
    label: 'catalogue validation',
    source: 'catalogue-validation',
    response: { status: 200, body: 'invalid-validation' },
    errorName: 'CoreApiSchemaError',
    detail: 'Invalid CH Core catalogue validation envelope',
    invoke: (gateway) => gateway.validateInitialCatalogue({
      fileName: 'catalogue.xlsx',
      workbookBase64: 'eGxzeA==',
    }),
  },
  {
    label: 'catalogue commit',
    source: 'catalogue-commit',
    response: { status: 200, body: { apiSchemaVersion: 1 } },
    errorName: 'CoreApiUpgradeRequiredError',
    detail: 'CH Core API memerlukan versi aplikasi yang lebih baru.',
    invoke: (gateway) => gateway.commitInitialCatalogue(
      '88888888-8888-4888-8888-888888888888',
    ),
  },
  {
    label: 'catalogue image',
    source: 'catalogue-image',
    response: { status: 200, body: 'invalid-image' },
    errorName: 'CoreApiSchemaError',
    detail: 'Invalid CH Core catalogue image envelope',
    invoke: (gateway) => gateway.loadSkuImage(gateway.getSnapshot().skus[0]!),
  },
  {
    label: 'SKU image acknowledgement',
    source: 'sku-image',
    response: { status: 200, body: 'invalid-image-acknowledgement' },
    errorName: 'CoreApiSchemaError',
    detail: 'Invalid CH Core mutation acknowledgement envelope',
    invoke: (gateway) => gateway.updateSku(SKU_ID, {
      imageUrl: 'data:image/png;base64,iVBORw==',
    }),
  },
];

describe('Core operations gateway mutation coordination', () => {
  it.each(directSchemaCases)(
    'makes a malformed $label response terminal through the shared handler',
    async ({ source, response, errorName, detail, invoke }) => {
      const transport = new ScriptedTransport();
      const diagnostics = vi.fn();
      const gateway = createCoreOperationsGateway(
        transport,
        new MemoryStorage(),
        new TestClock(),
        diagnostics,
      );
      transport.enqueue({ status: 200, body: populatedBootstrap('1') });
      await gateway.initialize();
      transport.enqueue(response);

      await expect(invoke(gateway)).rejects.toThrow(
        'Versi CH Core tidak kompatibel',
      );

      expect(gateway.getSyncSnapshot()).toMatchObject({
        phase: 'upgrade-required',
        message:
          'Versi CH Core tidak kompatibel. Perbarui CH Core, lalu coba hubungkan kembali.',
      });
      expect(diagnostics).toHaveBeenCalledWith({
        event: 'core-schema-incompatibility',
        source,
        errorName,
        errorMessage: detail,
      });
      const requestsBeforeBlockedWrite = transport.requests.length;
      await expect(gateway.adjustStock(SKU_ID, 1)).rejects.toMatchObject({
        name: 'CoreGatewayNetworkBlockedError',
        code: 'UPGRADE_REQUIRED',
      });
      expect(transport.requests).toHaveLength(requestsBeforeBlockedWrite);
    },
  );

  it('makes a malformed normal mutation acknowledgement terminal without leaking parser details', async () => {
    const transport = new ScriptedTransport();
    const storage = new MemoryStorage();
    const diagnostics = vi.fn();
    const gateway = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
      diagnostics,
    );
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await gateway.initialize();
    transport.enqueue({ status: 200, body: 'not-an-acknowledgement' });

    await expect(gateway.adjustStock(SKU_ID, 1)).rejects.toThrow(
      'Versi CH Core tidak kompatibel',
    );

    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'upgrade-required',
      message:
        'Versi CH Core tidak kompatibel. Perbarui CH Core, lalu coba hubungkan kembali.',
    });
    expect(gateway.getSyncSnapshot().message).not.toContain('envelope');
    expect(diagnostics).toHaveBeenCalledWith({
      event: 'core-schema-incompatibility',
      source: 'mutation',
      errorName: 'CoreApiSchemaError',
      errorMessage: 'Invalid CH Core mutation acknowledgement envelope',
    });
    const requestsBeforeBlockedWrite = transport.requests.length;
    await expect(gateway.adjustStock(SKU_ID, 1)).rejects.toMatchObject({
      name: 'CoreGatewayNetworkBlockedError',
      code: 'UPGRADE_REQUIRED',
    });
    expect(transport.requests).toHaveLength(requestsBeforeBlockedWrite);
    expect((storage.value as CoreCacheEnvelope).outbox).toHaveLength(1);
  });

  it('keeps an ordinary normal-mutation network failure offline and retryable', async () => {
    const transport = new ScriptedTransport();
    const diagnostics = vi.fn();
    const gateway = createCoreOperationsGateway(
      transport,
      new MemoryStorage(),
      new TestClock(),
      diagnostics,
    );
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await gateway.initialize();
    transport.enqueue(new Error('socket closed'));

    await expect(gateway.adjustStock(SKU_ID, 1)).rejects.toThrow(
      'socket closed',
    );

    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'offline',
      message: 'socket closed',
    });
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it('sends an online stock check from the observed balance version and applies the exact acknowledgement', async () => {
    const { gateway, transport, clock } = readyGateway();
    await gateway.initialize();
    const checkId = '89898989-8989-4989-8989-898989898989';
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '2',
        entityVersion: '2',
        entity: {
          id: checkId,
          skuId: SKU_ID,
          observedQuantityPcs: '12',
          countedQuantityPcs: '8',
          serverQuantityBeforePcs: '12',
          appliedDeltaPcs: '-4',
          baseBalanceVersion: '1',
          forcedOffline: false,
          countedAt: clock.now().toISOString(),
          appliedAt: '2026-07-29T01:00:01.000Z',
          deviceId: '66666666-6666-4666-8666-666666666666',
          deviceDisplayName: 'Desktop Owner',
          note: 'Rak depan',
        },
      },
    });
    transport.enqueue(emptyPoll('2'));

    await gateway.checkStock(SKU_ID, 8, '  Rak depan  ');

    expect(
      transport.requests.find(
        (request) => request.path === CORE_API_PATHS.stockChecks(SKU_ID),
      ),
    ).toEqual({
      method: 'POST',
      path: CORE_API_PATHS.stockChecks(SKU_ID),
      body: {
        observedQuantityPcs: 12,
        countedQuantityPcs: 8,
        baseBalanceVersion: '1',
        countedAt: clock.now().toISOString(),
        note: 'Rak depan',
      },
      idempotencyKey: expect.any(String),
    });
    expect(gateway.getSnapshot()).toMatchObject({
      skus: [{ stock: 8, lastStockCheckedAt: clock.now().toISOString() }],
      stockChecks: [
        {
          id: checkId,
          serverQuantityBeforePcs: 12,
          appliedDeltaPcs: -4,
          forcedOffline: false,
          note: 'Rak depan',
        },
      ],
    });
  });

  it('registers, reassigns, and removes package barcodes through typed v2 acknowledgements', async () => {
    const secondSkuId = 'abababab-abab-4bab-8bab-abababababab';
    const packageIdentifierId = '89898989-8989-4989-8989-898989898989';
    const transport = new ScriptedTransport();
    const storage = new MemoryStorage();
    const clock = new TestClock();
    const gateway = createCoreOperationsGateway(transport, storage, clock);
    const bootstrap = populatedBootstrap('1');
    transport.enqueue({
      status: 200,
      body: {
        ...bootstrap,
        skus: [
          ...bootstrap.skus,
          {
            ...bootstrap.skus[0],
            id: secondSkuId,
            primaryIdentifier: 'SKU-002',
            name: 'Produk Kedua',
          },
        ],
        balances: [
          ...bootstrap.balances,
          { ...bootstrap.balances[0], skuId: secondSkuId },
        ],
      },
    });
    await gateway.initialize();
    const barcode = {
      id: packageIdentifierId,
      skuId: SKU_ID,
      identifierValue: 'PKG-001',
      identifierKind: 'package_barcode',
      createdAt: '2026-07-29T01:00:00.000Z',
    };
    transport.enqueue({
      status: 200,
      body: { entityId: packageIdentifierId, entity: barcode },
    });
    transport.enqueue(emptyPoll());

    await gateway.registerPackageBarcode(SKU_ID, '  PKG-001  ');

    expect(
      transport.requests.find(
        (request) => request.path === CORE_API_PATHS.packageBarcodes(SKU_ID),
      ),
    ).toMatchObject({
      method: 'POST',
      path: CORE_API_PATHS.packageBarcodes(SKU_ID),
      body: { identifierValue: 'PKG-001' },
    });
    expect(gateway.getSnapshot().skus[0]?.identifiers).toContainEqual(
      expect.objectContaining({ id: packageIdentifierId, kind: 'package_barcode' }),
    );

    transport.enqueue({
      status: 200,
      body: {
        entityId: packageIdentifierId,
        entity: { ...barcode, skuId: secondSkuId },
      },
    });
    transport.enqueue(emptyPoll());
    await gateway.reassignPackageBarcode(packageIdentifierId, secondSkuId);

    expect(
      transport.requests.find(
        (request) =>
          request.method === 'PATCH' &&
          request.path === CORE_API_PATHS.packageBarcode(packageIdentifierId),
      ),
    ).toMatchObject({
      method: 'PATCH',
      path: CORE_API_PATHS.packageBarcode(packageIdentifierId),
      body: { skuId: secondSkuId },
    });
    expect(gateway.getSnapshot().skus[0]?.aliases).not.toContain('PKG-001');
    expect(gateway.getSnapshot().skus[1]?.aliases).toContain('PKG-001');

    transport.enqueue({
      status: 200,
      body: { entityId: packageIdentifierId },
    });
    transport.enqueue(emptyPoll());
    await gateway.removePackageBarcode(packageIdentifierId);

    expect(
      transport.requests.find(
        (request) =>
          request.method === 'DELETE' &&
          request.path === CORE_API_PATHS.packageBarcode(packageIdentifierId),
      ),
    ).toMatchObject({
      method: 'DELETE',
      path: CORE_API_PATHS.packageBarcode(packageIdentifierId),
    });
    expect(
      gateway.getSnapshot().skus.flatMap((sku) => sku.identifiers),
    ).not.toContainEqual(expect.objectContaining({ id: packageIdentifierId }));
  });

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
        selectedPriceTotal: 276_285_615,
        stockTotal: 3_988,
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
    transport.enqueue({ status: 200, body: exactCatalogueBootstrap('2') });
    await expect(
      gateway.commitInitialCatalogue(validation.importId),
    ).resolves.toEqual(receipt);
    expect(transport.requests.at(-2)).toEqual({
      method: 'POST',
      path: `/v1/imports/${validation.importId}/commit`,
    });
    expect(transport.requests.at(-1)?.path).toBe('/v1/bootstrap');
    expect(gateway.getSnapshot().skus).toHaveLength(3_144);

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
      });
      requestStarted.resolve();
      return mutationResponse.promise;
    });
    transport.enqueue(emptyPoll('12'));

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
      expect(request.body).toEqual({
        rowVersion: null,
        base: null,
        definition: secondTemplate,
      });
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
    expect(transport.requests[completeIndex]?.body).toEqual({
      lifecycleVersion: '1',
      destination: 'archive',
    });
  });

  it('sends canonical page and whole-line base material', async () => {
    const { gateway, transport } = readyGateway();
    await gateway.initialize();
    transport.enqueue({ status: 200, body: { serverRevision: '2' } });
    transport.enqueue(emptyPoll());

    await gateway.updateNotaLine(NOTA_ID, PAGE_ID, LINE_ID, {
      quantity: 2,
    });

    expect(transport.requests.at(-2)).toMatchObject({
      method: 'PATCH',
      path: CORE_API_PATHS.notaLine(NOTA_ID, PAGE_ID, LINE_ID),
      body: {
        lifecycleVersion: '1',
        pageVersion: '1',
        lineVersion: '1',
        base: {
          linePosition: 0,
          skuId: SKU_ID,
          description: 'Produk Core',
          kind: '',
          quantity: 1,
          unit: 'pcs',
          pcsPrice: 25000,
          lsnPrice: 300000,
        },
        mine: {
          linePosition: 0,
          skuId: SKU_ID,
          description: 'Produk Core',
          kind: '',
          quantity: 2,
          unit: 'pcs',
          pcsPrice: 25000,
          lsnPrice: 300000,
        },
      },
    });
  });

  it('keeps a line acknowledgement version isolated from Nota lifecycle version', async () => {
    const state = new CoreGatewayState();
    const bootstrap = parseCoreBootstrap(populatedBootstrap('1'));
    state.commitCanonical(mapCoreBootstrapToDemoState(bootstrap), '1');
    state.replaceRowVersions(bootstrap);

    state.recordMutationAcknowledgement(
      CORE_API_PATHS.notaLine(NOTA_ID, PAGE_ID, LINE_ID),
      {
        apiSchemaVersion: 2,
        serverRevision: '2',
        entityVersion: '9',
        entity: asCoreJson(state.getSnapshot().notaTransactions[0]),
      },
      {},
    );

    expect(state.requireNotaLifecycleContext(NOTA_ID)).toEqual({
      lifecycleVersion: '1',
    });
  });

  it('replaces peer-polled Nota, page, and line versions without requiring rowVersion on Nota', () => {
    const state = new CoreGatewayState();
    const bootstrap = parseCoreBootstrap(populatedBootstrap('1'));
    state.commitCanonical(mapCoreBootstrapToDemoState(bootstrap), '1');
    state.replaceRowVersions(bootstrap);

    state.recordChangeVersions([
      {
        revision: '2',
        entityType: 'nota',
        entityId: NOTA_ID,
        operation: 'upsert',
        payload: asCoreJson({
          ...populatedBootstrap().notas[0],
          fieldVersions: {
            customerName: '7',
            customerPlace: '8',
            payment: '9',
          },
          structureVersion: '10',
          lifecycleVersion: '11',
        }),
        createdAt: '2026-07-30T00:00:00.000Z',
      },
      {
        revision: '3',
        entityType: 'nota_page',
        entityId: PAGE_ID,
        operation: 'upsert',
        payload: asCoreJson({
          ...populatedBootstrap().notaPages[0],
          rowVersion: '12',
          lifecycleVersion: '13',
        }),
        createdAt: '2026-07-30T00:00:01.000Z',
      },
      {
        revision: '4',
        entityType: 'nota_line',
        entityId: LINE_ID,
        operation: 'upsert',
        payload: asCoreJson({
          ...populatedBootstrap().notaLines[0],
          rowVersion: '14',
        }),
        createdAt: '2026-07-30T00:00:02.000Z',
      },
    ]);

    expect(state.requireNotaLifecycleContext(NOTA_ID)).toEqual({
      lifecycleVersion: '11',
    });
    expect(state.requireNotaStructureContext(NOTA_ID)).toEqual({
      lifecycleVersion: '11',
      structureVersion: '10',
    });
    expect(state.requireNotaPageLifecycleContext(NOTA_ID, PAGE_ID)).toEqual({
      lifecycleVersion: '11',
      structureVersion: '10',
      pageVersion: '13',
    });
    expect(
      state.requireNotaLineWriteContext(NOTA_ID, PAGE_ID, LINE_ID, {
        quantity: 2,
      }),
    ).toMatchObject({
      lifecycleVersion: '11',
      pageVersion: '12',
      lineVersion: '14',
    });
    expect(
      state.requireNotaHeaderWriteContext(NOTA_ID, { customerName: 'Baru' }),
    ).toEqual({
      lifecycleVersion: '11',
      fields: {
        customerName: {
          version: '7',
          base: 'Amelia',
          mine: 'Baru',
        },
      },
    });
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

    const canonical = {
      ...gateway.getSnapshot().notaTransactions[0]!,
      customerName: 'Amelia Baru',
    };
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '12',
        entityVersion: '6',
        entity: canonical,
        versionState: {
          notaId: NOTA_ID,
          fieldVersions: {
            customerName: '7',
            customerPlace: '8',
            transactionDate: '9',
            payment: '10',
          },
          structureVersion: '11',
          lifecycleVersion: '6',
          pageVersions: { [PAGE_ID]: '12' },
          pageLifecycleVersions: { [PAGE_ID]: '13' },
          lineVersions: { [LINE_ID]: '14' },
        },
      },
    });
    transport.enqueue(emptyPoll());
    await gateway.resolveConflict(conflict.id, 'server');

    expect(transport.requests.at(-2)).toMatchObject({
      method: 'POST',
      path: CORE_API_PATHS.resolveConflict(conflict.id),
      body: { choice: 'server' },
    });
    expect(gateway.getSyncSnapshot().conflictCount).toBe(0);
    expect(
      gateway.getSnapshot().notaTransactions[0]?.customerName,
    ).toBe('Amelia Baru');
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '13',
        entityVersion: '8',
        entity: { ...canonical, customerName: 'Saya' },
      },
    });
    transport.enqueue(emptyPoll('13'));
    await gateway.updateNotaTransaction(NOTA_ID, { customerName: 'Saya' });
    const finalHeaderWrite = [...transport.requests]
      .reverse()
      .find(
        (request) =>
          request.path === CORE_API_PATHS.notaHeader(NOTA_ID),
      );
    expect(finalHeaderWrite?.body).toEqual({
      lifecycleVersion: '6',
      fields: {
        customerName: {
          version: '7',
          base: 'Amelia Baru',
          mine: 'Saya',
        },
      },
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
      canManagePackageBarcodes: true,
    });
    await expect(gateway.reset()).rejects.toThrow(
      'Reset data demo tidak tersedia',
    );
    expect(transport.requests).toHaveLength(requestCount);
  });
});
