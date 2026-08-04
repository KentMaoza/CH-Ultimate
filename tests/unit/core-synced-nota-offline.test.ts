import { describe, expect, it } from 'vitest';

import type { CoreLocalEnvelope } from '../../src/gateway/core-local-store';
import type { NotaTransaction } from '../../src/domain/types';
import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import {
  CORE_API_PATHS,
} from '../../src/gateway/core-api-types';
import {
  LINE_ID,
  NOTA_ID,
  PAGE_ID,
  MemoryStorage,
  ScriptedTransport,
  TestClock,
  populatedBootstrap,
} from './core-gateway-test-support';

async function bootstrappedStorage(
  bootstrap = populatedBootstrap('7'),
): Promise<MemoryStorage> {
  const storage = new MemoryStorage();
  const transport = new ScriptedTransport();
  transport.enqueue({ status: 200, body: bootstrap });
  const gateway = createCoreOperationsGateway(
    transport,
    storage,
    new TestClock(),
  );
  await gateway.initialize();
  gateway.dispose();
  return storage;
}

async function restartOffline(storage: MemoryStorage) {
  const transport = new ScriptedTransport();
  transport.enqueue(new Error('wifi down'));
  const gateway = createCoreOperationsGateway(
    transport,
    storage,
    new TestClock(),
  );
  await gateway.initialize();
  expect(gateway.getSyncSnapshot().phase).toBe('offline');
  return { gateway, transport };
}

async function storageWithPersistedNotaConflict(
  bootstrap = populatedBootstrap('7'),
): Promise<MemoryStorage> {
  const storage = await bootstrappedStorage(bootstrap);
  const envelope = storage.value as unknown as CoreLocalEnvelope;
  const operationId = '77777777-7777-4777-8777-777777777777';
  const conflictId = '88888888-8888-4888-8888-888888888888';
  storage.value = {
    ...structuredClone(envelope),
    deferredOutbox: [
      {
        kind: 'nota-mutation',
        sequence: 1,
        operationId,
        idempotencyKey: operationId,
        createdAt: '2026-08-04T01:00:00.000Z',
        firstSentAt: '2026-08-04T01:01:00.000Z',
        status: 'conflict',
        lastError: 'CONFLICT',
        payload: {
          notaId: NOTA_ID,
          targetKey: `nota:${NOTA_ID}:header:customerName`,
          method: 'PATCH',
          path: CORE_API_PATHS.notaHeader(NOTA_ID),
          body: {
            lifecycleVersion: '1',
            fields: {
              customerName: {
                version: '1',
                base: 'Amelia',
                mine: 'Konflik Tersimpan',
              },
            },
          },
          dependsOn: [],
          optimistic: {
            kind: 'nota-header',
            notaId: NOTA_ID,
            patch: { customerName: 'Konflik Tersimpan' },
          },
        },
      },
    ],
    nextDeferredSequence: 2,
    offlineConflicts: [
      {
        operationId,
        errorCode: 'CONFLICT',
        conflict: {
          id: conflictId,
          entityType: 'nota',
          entityId: NOTA_ID,
          field: 'customerName',
          base: 'Amelia',
          mine: 'Konflik Tersimpan',
          server: 'Versi Server',
        },
      },
    ],
  } satisfies CoreLocalEnvelope;
  return storage;
}

function versionState(
  fieldVersions: Record<string, string>,
  lineVersion: string,
) {
  return {
    notaId: NOTA_ID,
    fieldVersions,
    structureVersion: '1',
    lifecycleVersion: '1',
    pageVersions: { [PAGE_ID]: '1' },
    pageLifecycleVersions: { [PAGE_ID]: '1' },
    lineVersions: { [LINE_ID]: lineVersion },
  };
}

function withLineDescription(
  transaction: NotaTransaction,
  description: string,
): NotaTransaction {
  return {
    ...transaction,
    pages: transaction.pages.map((page) => ({
      ...page,
      lines: page.lines.map((line) =>
        line.id === LINE_ID ? { ...line, description } : line,
      ),
    })),
  };
}

describe('Core cached Nota version readiness', () => {
  it('persists bootstrap Nota versions for a synced draft across restart', async () => {
    const storage = await bootstrappedStorage();

    expect(storage.value).toMatchObject({
      cacheVersion: 4,
      notaVersions: {
        [NOTA_ID]: {
          fieldVersions: expect.objectContaining({ customerName: '1' }),
          structureVersion: '1',
          lifecycleVersion: '1',
          pageVersions: { [PAGE_ID]: '1' },
          pageLifecycleVersions: { [PAGE_ID]: '1' },
          lineVersions: { [LINE_ID]: '1' },
        },
      },
    });

    const { gateway, transport } = await restartOffline(storage);
    expect(
      gateway.getSnapshot().notaTransactions.find((nota) => nota.id === NOTA_ID)
        ?.customerName,
    ).toBe('Amelia');
    expect((storage.value as unknown as CoreLocalEnvelope).notaVersions).toHaveProperty(
      NOTA_ID,
    );
    expect(transport.requests).toHaveLength(1);
    gateway.dispose();
  });

  it('keeps a migrated cache without Nota version knowledge read-only offline', async () => {
    const storage = await bootstrappedStorage();
    const current = storage.value as unknown as Record<string, unknown>;
    const legacy = structuredClone(current);
    delete legacy.notaVersions;
    storage.value = legacy;

    const { gateway } = await restartOffline(storage);

    await expect(
      gateway.updateNotaTransaction(NOTA_ID, { customerName: 'Ditolak' }),
    ).rejects.toThrow('Versi Nota belum tersedia');
    expect(
      gateway.getSnapshot().notaTransactions.find((nota) => nota.id === NOTA_ID)
        ?.customerName,
    ).toBe('Amelia');
    gateway.dispose();
  });
});

describe('Core durable offline edits for synced Nota', () => {
  it('persists and restores optimistic header and line edits in global sequence order', async () => {
    const storage = await bootstrappedStorage();
    const first = await restartOffline(storage);

    await first.gateway.updateNotaTransaction(NOTA_ID, {
      customerName: 'Amina Offline',
    });
    await first.gateway.updateNotaLine(NOTA_ID, PAGE_ID, LINE_ID, {
      description: 'Kopi Offline',
    });
    await first.gateway.updateNotaLine(NOTA_ID, PAGE_ID, LINE_ID, {
      description: 'Kopi Offline Baru',
    });

    const persisted = storage.value as unknown as CoreLocalEnvelope;
    expect(persisted.deferredOutbox).toEqual([
      expect.objectContaining({
        kind: 'nota-mutation',
        sequence: 1,
        idempotencyKey: expect.any(String),
        payload: expect.objectContaining({
          notaId: NOTA_ID,
          targetKey: `nota:${NOTA_ID}:header:customerName`,
          method: 'PATCH',
          path: CORE_API_PATHS.notaHeader(NOTA_ID),
          body: {
            lifecycleVersion: '1',
            fields: {
              customerName: {
                version: '1',
                base: 'Amelia',
                mine: 'Amina Offline',
              },
            },
          },
        }),
      }),
      expect.objectContaining({
        kind: 'nota-mutation',
        sequence: 2,
        payload: expect.objectContaining({
          notaId: NOTA_ID,
          targetKey: `nota:${NOTA_ID}:line:${LINE_ID}`,
          method: 'PATCH',
          path: CORE_API_PATHS.notaLine(NOTA_ID, PAGE_ID, LINE_ID),
          body: expect.objectContaining({
            lifecycleVersion: '1',
            pageVersion: '1',
            lineVersion: '1',
            mine: expect.objectContaining({ description: 'Kopi Offline Baru' }),
          }),
        }),
      }),
    ]);
    expect(persisted.nextDeferredSequence).toBe(3);
    first.gateway.dispose();

    const restarted = await restartOffline(storage);
    const nota = restarted.gateway
      .getSnapshot()
      .notaTransactions.find((candidate) => candidate.id === NOTA_ID);
    expect(nota?.customerName).toBe('Amina Offline');
    expect(nota?.pages[0]?.lines[0]?.description).toBe('Kopi Offline Baru');
    restarted.gateway.dispose();
  });

  it('does not project a synced Nota edit when the durable write fails', async () => {
    const storage = await bootstrappedStorage();
    const { gateway } = await restartOffline(storage);
    storage.failNextSave = true;

    await expect(
      gateway.updateNotaTransaction(NOTA_ID, { customerName: 'Tidak Durable' }),
    ).rejects.toThrow('cache unavailable');

    expect(
      gateway.getSnapshot().notaTransactions.find((nota) => nota.id === NOTA_ID)
        ?.customerName,
    ).toBe('Amelia');
    gateway.dispose();
  });

  it('persists a line deletion as a normal deferred DELETE', async () => {
    const storage = await bootstrappedStorage();
    const { gateway } = await restartOffline(storage);

    await gateway.deleteNotaLine(NOTA_ID, PAGE_ID, LINE_ID);

    expect(
      (storage.value as unknown as CoreLocalEnvelope).deferredOutbox[0],
    ).toMatchObject({
      kind: 'nota-mutation',
      payload: {
        notaId: NOTA_ID,
        method: 'DELETE',
        path: CORE_API_PATHS.notaLine(NOTA_ID, PAGE_ID, LINE_ID),
        dependsOn: [],
      },
    });
    expect(
      gateway.getSnapshot().notaTransactions[0]?.pages[0]?.lines[0],
    ).toMatchObject({ description: '', quantity: 0, pcsPrice: 0, lsnPrice: 0 });
    expect(
      gateway.getSnapshot().notaTransactions[0]?.pages[0]?.lines[0]?.skuId,
    ).toBeUndefined();
    gateway.dispose();
  });

  it('can edit the same physical line offline after delete acknowledgement and restart', async () => {
    const storage = await bootstrappedStorage();
    const offline = await restartOffline(storage);
    await offline.gateway.deleteNotaLine(NOTA_ID, PAGE_ID, LINE_ID);
    const clearedEntity = JSON.parse(JSON.stringify(
      offline.gateway.getSnapshot().notaTransactions
        .find((nota) => nota.id === NOTA_ID)!,
    )) as NotaTransaction;
    expect(clearedEntity.pages[0]?.lines[0]?.id).toBe(LINE_ID);
    offline.gateway.dispose();

    const transport = new ScriptedTransport();
    transport.enqueue({ status: 200, body: populatedBootstrap('8') });
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '9',
        entityVersion: '2',
        entity: clearedEntity,
        versionState: versionState(
          {
            customerName: '1',
            customerPlace: '1',
            payment: '1',
          },
          '2',
        ),
      },
    });
    const reconnected = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
    );

    await reconnected.initialize();

    expect(transport.requests.at(-1)?.path).toBe(
      CORE_API_PATHS.notaLine(NOTA_ID, PAGE_ID, LINE_ID),
    );
    expect(
      reconnected.getSnapshot().notaTransactions[0]?.pages[0]?.lines[0]?.id,
    ).toBe(LINE_ID);
    expect(
      (storage.value as unknown as CoreLocalEnvelope).notaVersions[NOTA_ID]
        ?.lineVersions,
    ).toEqual({ [LINE_ID]: '2' });
    reconnected.dispose();

    const restarted = await restartOffline(storage);
    await restarted.gateway.updateNotaLine(NOTA_ID, PAGE_ID, LINE_ID, {
      description: 'Kopi Baru',
      quantity: 2,
    });

    expect(
      (storage.value as unknown as CoreLocalEnvelope).deferredOutbox[0],
    ).toMatchObject({
      kind: 'nota-mutation',
      payload: {
        method: 'PATCH',
        path: CORE_API_PATHS.notaLine(NOTA_ID, PAGE_ID, LINE_ID),
        body: {
          lifecycleVersion: '1',
          pageVersion: '1',
          lineVersion: '2',
          base: {
            linePosition: 0,
            skuId: null,
            description: '',
            kind: '',
            quantity: 0,
            unit: 'pcs',
            pcsPrice: 0,
            lsnPrice: 0,
          },
          mine: expect.objectContaining({
            linePosition: 0,
            description: 'Kopi Baru',
            quantity: 2,
          }),
        },
      },
    });
    restarted.gateway.dispose();
  });

  it('keeps synced transaction lifecycle operations online-only with known versions', async () => {
    const storage = await bootstrappedStorage();
    const { gateway } = await restartOffline(storage);

    for (const operation of [
      () => gateway.completeNotaTransaction(NOTA_ID),
      () => gateway.cancelNotaTransaction(NOTA_ID),
      () => gateway.reopenNotaTransaction(NOTA_ID),
      () => gateway.restoreNotaTransaction(NOTA_ID),
    ]) {
      await expect(operation()).rejects.toThrow(
        'Mode offline: data bersama hanya dapat dibaca.',
      );
    }
    gateway.dispose();
  });

  it('replays normal Nota endpoints after reconnect and persists acknowledgement versions', async () => {
    const storage = await bootstrappedStorage();
    const offline = await restartOffline(storage);
    await offline.gateway.updateNotaTransaction(NOTA_ID, {
      customerName: 'Amina Replay',
    });
    await offline.gateway.updateNotaLine(NOTA_ID, PAGE_ID, LINE_ID, {
      description: 'Kopi Replay',
    });
    offline.gateway.dispose();

    const transport = new ScriptedTransport();
    const bootstrap = populatedBootstrap('8');
    const initial = offline.gateway
      .getSnapshot()
      .notaTransactions.find((nota) => nota.id === NOTA_ID)!;
    const headerEntity = { ...initial, customerName: 'Amina Replay' };
    const lineEntity = withLineDescription(headerEntity, 'Kopi Replay');
    transport.enqueue({ status: 200, body: bootstrap });
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '9',
        entityVersion: '1',
        entity: headerEntity,
        versionState: versionState(
          {
            customerName: '2',
            customerPlace: '1',
            payment: '1',
          },
          '1',
        ),
      },
    });
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '10',
        entityVersion: '2',
        entity: lineEntity,
        versionState: versionState(
          {
            customerName: '2',
            customerPlace: '1',
            payment: '1',
          },
          '2',
        ),
      },
    });
    const gateway = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
    );

    await gateway.initialize();

    expect(transport.requests.slice(1).map((request) => request.path)).toEqual([
      CORE_API_PATHS.notaHeader(NOTA_ID),
      CORE_API_PATHS.notaLine(NOTA_ID, PAGE_ID, LINE_ID),
    ]);
    const persisted = storage.value as unknown as CoreLocalEnvelope;
    expect(persisted.deferredOutbox).toEqual([]);
    expect(persisted.notaVersions[NOTA_ID]).toMatchObject({
      fieldVersions: expect.objectContaining({ customerName: '2' }),
      lineVersions: { [LINE_ID]: '2' },
    });
    expect(
      gateway.getSnapshot().notaTransactions.find((nota) => nota.id === NOTA_ID),
    ).toMatchObject({ customerName: 'Amina Replay' });
    expect(
      gateway.getSnapshot().notaTransactions.find((nota) => nota.id === NOTA_ID)
        ?.pages[0]?.lines[0]?.description,
    ).toBe('Kopi Replay');
    gateway.dispose();
  });
});

describe('Core durable offline page structure for synced Nota', () => {
  it('keeps client page and line UUIDs stable and records dependent page work', async () => {
    const storage = await bootstrappedStorage();
    const { gateway } = await restartOffline(storage);

    const page = await gateway.addNotaPage(NOTA_ID);
    expect(page).toBeDefined();
    expect(page?.lines).toHaveLength(15);
    expect(new Set(page?.lines.map((line) => line.id)).size).toBe(15);
    expect(page?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(page?.lines.every((line) => /^[0-9a-f-]{36}$/.test(line.id))).toBe(
      true,
    );

    await gateway.updateNotaLine(NOTA_ID, page!.id, page!.lines[0]!.id, {
      description: 'Baris Halaman Offline',
      quantity: 1,
    });
    await gateway.cancelNotaPage(NOTA_ID, page!.id);
    await gateway.restoreNotaPage(NOTA_ID, page!.id);

    const persisted = storage.value as unknown as CoreLocalEnvelope;
    const [create, line, cancel, restore] = persisted.deferredOutbox;
    expect(create).toMatchObject({
      kind: 'nota-mutation',
      sequence: 1,
      payload: {
        notaId: NOTA_ID,
        method: 'POST',
        path: CORE_API_PATHS.notaPages(NOTA_ID),
        body: {
          lifecycleVersion: '1',
          structureVersion: '1',
          clientPageId: page!.id,
          clientLineIds: page!.lines.map((item) => item.id),
        },
        dependsOn: [],
        targetKey: `nota:${NOTA_ID}:page-add:${page!.id}`,
        optimistic: expect.any(Object),
      },
    });
    expect(line).toMatchObject({
      kind: 'nota-mutation',
      sequence: 2,
      payload: expect.objectContaining({
        dependsOn: [create!.operationId],
        path: CORE_API_PATHS.notaLine(
          NOTA_ID,
          page!.id,
          page!.lines[0]!.id,
        ),
      }),
    });
    expect(cancel).toMatchObject({
      kind: 'nota-mutation',
      sequence: 3,
      payload: expect.objectContaining({
        dependsOn: [create!.operationId],
        path: `${CORE_API_PATHS.notaPage(NOTA_ID, page!.id)}/cancel`,
      }),
    });
    expect(restore).toMatchObject({
      kind: 'nota-mutation',
      sequence: 4,
      payload: expect.objectContaining({
        dependsOn: [create!.operationId],
        path: `${CORE_API_PATHS.notaPage(NOTA_ID, page!.id)}/restore`,
      }),
    });
    const projected = gateway.getSnapshot().notaTransactions
      .find((nota) => nota.id === NOTA_ID)
      ?.pages.find((candidate) => candidate.id === page!.id);
    expect(projected?.status).toBe('active');
    expect(projected?.lines[0]).toMatchObject({
      description: 'Baris Halaman Offline',
    });
    gateway.dispose();
  });
});

describe('Core offline Nota conflict resolution', () => {
  it('blocks every offline mutation entry point for a conflicted Nota after restart', async () => {
    const operations = [
      (gateway: ReturnType<typeof createCoreOperationsGateway>) =>
        gateway.updateNotaTransaction(NOTA_ID, { customerPlace: 'Ditolak' }),
      (gateway: ReturnType<typeof createCoreOperationsGateway>) =>
        gateway.updateNotaLine(NOTA_ID, PAGE_ID, LINE_ID, {
          description: 'Ditolak',
        }),
      (gateway: ReturnType<typeof createCoreOperationsGateway>) =>
        gateway.deleteNotaLine(NOTA_ID, PAGE_ID, LINE_ID),
      (gateway: ReturnType<typeof createCoreOperationsGateway>) =>
        gateway.addNotaPage(NOTA_ID),
      (gateway: ReturnType<typeof createCoreOperationsGateway>) =>
        gateway.cancelNotaPage(NOTA_ID, PAGE_ID),
      (gateway: ReturnType<typeof createCoreOperationsGateway>) =>
        gateway.restoreNotaPage(NOTA_ID, PAGE_ID),
    ];

    for (const operation of operations) {
      const storage = await storageWithPersistedNotaConflict();
      const { gateway } = await restartOffline(storage);
      const before = structuredClone(storage.value);

      await expect(operation(gateway)).rejects.toThrow('Nota memiliki konflik');
      expect(storage.value).toEqual(before);
      gateway.dispose();
    }
  });

  it('keeps an unrelated cached Nota editable while the conflicted Nota stays blocked offline', async () => {
    const secondNotaId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const secondPageId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const secondLineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const first = populatedBootstrap('7');
    const storage = await storageWithPersistedNotaConflict(
      populatedBootstrap('7', {
        notas: [
          ...first.notas,
          {
            ...first.notas[0]!,
            id: secondNotaId,
            notaNumber: 'CHU-20260729-0002',
            header: {
              customerName: 'Budi',
              customerPlace: 'Makassar',
              payment: 'cash',
            },
          },
        ],
        notaPages: [
          ...first.notaPages,
          { ...first.notaPages[0]!, id: secondPageId, notaId: secondNotaId },
        ],
        notaLines: [
          ...first.notaLines,
          {
            ...first.notaLines[0]!,
            id: secondLineId,
            notaId: secondNotaId,
            pageId: secondPageId,
          },
        ],
      }),
    );
    const { gateway } = await restartOffline(storage);

    await gateway.updateNotaTransaction(secondNotaId, {
      customerPlace: 'Parepare Offline',
    });

    expect(
      gateway.getSnapshot().notaTransactions.find(
        (nota) => nota.id === secondNotaId,
      )?.customerPlace,
    ).toBe('Parepare Offline');
    expect(
      (storage.value as unknown as CoreLocalEnvelope).deferredOutbox,
    ).toEqual([
      expect.objectContaining({ status: 'conflict' }),
      expect.objectContaining({
        kind: 'nota-mutation',
        payload: expect.objectContaining({ notaId: secondNotaId }),
      }),
    ]);
    gateway.dispose();
  });

  it('blocks only the conflicted Nota while another Nota continues replaying', async () => {
    const secondNotaId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const secondPageId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const secondLineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const firstBootstrap = populatedBootstrap('7');
    const secondNota = {
      ...firstBootstrap.notas[0]!,
      id: secondNotaId,
      notaNumber: 'CHU-20260729-0002',
      header: {
        customerName: 'Budi',
        customerPlace: 'Makassar',
        payment: 'cash',
      },
    };
    const secondPage = {
      ...firstBootstrap.notaPages[0]!,
      id: secondPageId,
      notaId: secondNotaId,
    };
    const secondLine = {
      ...firstBootstrap.notaLines[0]!,
      id: secondLineId,
      notaId: secondNotaId,
      pageId: secondPageId,
    };
    const twoNotas = populatedBootstrap('7', {
      notas: [...firstBootstrap.notas, secondNota],
      notaPages: [...firstBootstrap.notaPages, secondPage],
      notaLines: [...firstBootstrap.notaLines, secondLine],
    });
    const storage = await bootstrappedStorage(twoNotas);
    const offline = await restartOffline(storage);
    await offline.gateway.updateNotaTransaction(NOTA_ID, {
      customerName: 'Konflik Saya',
    });
    await offline.gateway.updateNotaTransaction(secondNotaId, {
      customerPlace: 'Parepare',
    });
    offline.gateway.dispose();

    const transport = new ScriptedTransport();
    transport.enqueue({ status: 200, body: { ...twoNotas, serverRevision: '8' } });
    transport.enqueue({
      status: 409,
      body: {
        code: 'CONFLICT',
        conflict: {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          entityType: 'nota',
          entityId: NOTA_ID,
          field: 'customerName',
          base: 'Amelia',
          mine: 'Konflik Saya',
          server: 'Perubahan Server',
        },
      },
    });
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '9',
        entityVersion: '1',
        entity: {
          ...(storage.value as unknown as CoreLocalEnvelope).state
            .notaTransactions.find((nota) => nota.id === secondNotaId)!,
          customerPlace: 'Parepare',
        },
        versionState: {
          notaId: secondNotaId,
          fieldVersions: {
            customerName: '1',
            customerPlace: '2',
            payment: '1',
          },
          structureVersion: '1',
          lifecycleVersion: '1',
          pageVersions: { [secondPageId]: '1' },
          pageLifecycleVersions: { [secondPageId]: '1' },
          lineVersions: { [secondLineId]: '1' },
        },
      },
    });
    const gateway = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
    );

    await gateway.initialize();

    expect(transport.requests.slice(1).map((request) => request.path)).toEqual([
      CORE_API_PATHS.notaHeader(NOTA_ID),
      CORE_API_PATHS.notaHeader(secondNotaId),
    ]);
    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'conflict',
      conflictCount: 1,
    });
    expect(
      gateway.getSnapshot().notaTransactions.find(
        (nota) => nota.id === secondNotaId,
      )?.customerPlace,
    ).toBe('Parepare');
    const requestCount = transport.requests.length;
    await expect(
      gateway.updateNotaTransaction(NOTA_ID, { payment: 'credit' }),
    ).rejects.toThrow('Nota memiliki konflik');
    await expect(gateway.flushNota(NOTA_ID)).rejects.toThrow(
      'Nota memiliki konflik',
    );
    expect(transport.requests).toHaveLength(requestCount);
    gateway.dispose();
  });

  it('uses the conflict endpoint and server choice discards an offline page with its dependents', async () => {
    const storage = await bootstrappedStorage();
    const offline = await restartOffline(storage);
    const page = (await offline.gateway.addNotaPage(NOTA_ID))!;
    await offline.gateway.updateNotaLine(NOTA_ID, page.id, page.lines[0]!.id, {
      description: 'Akan Dibuang',
      quantity: 1,
    });
    offline.gateway.dispose();
    const authoritative = (storage.value as unknown as CoreLocalEnvelope).state
      .notaTransactions.find((nota) => nota.id === NOTA_ID)!;
    const conflictId = '88888888-8888-4888-8888-888888888888';
    const transport = new ScriptedTransport();
    transport.enqueue({ status: 200, body: populatedBootstrap('8') });
    transport.enqueue({
      status: 409,
      body: {
        code: 'CONFLICT',
        conflict: {
          id: conflictId,
          entityType: 'nota',
          entityId: NOTA_ID,
          field: 'structureVersion',
          base: { structureVersion: '1' },
          mine: { action: 'add-page' },
          server: { structureVersion: '2' },
        },
      },
    });
    const gateway = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
    );
    await gateway.initialize();
    expect(gateway.getConflicts()).toEqual([
      expect.objectContaining({ id: conflictId, entityId: NOTA_ID }),
    ]);

    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '9',
        entityVersion: '1',
        entity: authoritative,
        versionState: versionState(
          {
            customerName: '1',
            customerPlace: '1',
            payment: '1',
          },
          '1',
        ),
      },
    });
    await gateway.resolveConflict(conflictId, 'server');

    expect(transport.requests.at(-1)).toMatchObject({
      method: 'POST',
      path: CORE_API_PATHS.resolveConflict(conflictId),
      body: { choice: 'server' },
      idempotencyKey: expect.any(String),
    });
    expect(
      (storage.value as unknown as CoreLocalEnvelope).deferredOutbox,
    ).toEqual([]);
    expect(
      gateway.getSnapshot().notaTransactions.find((nota) => nota.id === NOTA_ID)
        ?.pages.some((candidate) => candidate.id === page.id),
    ).toBe(false);
    gateway.dispose();
  });

  it('mine choice resolves the page conflict and rebases a dependent cancel before continuing', async () => {
    const storage = await bootstrappedStorage();
    const offline = await restartOffline(storage);
    const page = (await offline.gateway.addNotaPage(NOTA_ID))!;
    await offline.gateway.cancelNotaPage(NOTA_ID, page.id);
    const mineEntity = offline.gateway
      .getSnapshot()
      .notaTransactions.find((nota) => nota.id === NOTA_ID)!;
    offline.gateway.dispose();
    const conflictId = '99999999-9999-4999-8999-999999999999';
    const transport = new ScriptedTransport();
    transport.enqueue({ status: 200, body: populatedBootstrap('8') });
    transport.enqueue({
      status: 409,
      body: {
        code: 'CONFLICT',
        conflict: {
          id: conflictId,
          entityType: 'nota',
          entityId: NOTA_ID,
          field: 'structureVersion',
          base: { structureVersion: '1' },
          mine: { action: 'add-page' },
          server: { structureVersion: '2' },
        },
      },
    });
    const gateway = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
    );
    await gateway.initialize();

    const mineVersionState = {
      ...versionState(
        {
          customerName: '1',
          customerPlace: '1',
          payment: '1',
        },
        '1',
      ),
      structureVersion: '3',
      pageVersions: { [PAGE_ID]: '1', [page.id]: '1' },
      pageLifecycleVersions: { [PAGE_ID]: '1', [page.id]: '1' },
      lineVersions: {
        [LINE_ID]: '1',
        ...Object.fromEntries(page.lines.map((line) => [line.id, '1'])),
      },
    };
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '9',
        entityVersion: '1',
        entity: {
          ...mineEntity,
          pages: mineEntity.pages.map((candidate) =>
            candidate.id === page.id
              ? { ...candidate, status: 'active' }
              : candidate,
          ),
        },
        versionState: mineVersionState,
      },
    });
    transport.enqueue((request) => {
      expect(request.path).toBe(
        `${CORE_API_PATHS.notaPage(NOTA_ID, page.id)}/cancel`,
      );
      expect(request.body).toMatchObject({
        lifecycleVersion: '1',
        structureVersion: '3',
        pageVersion: '1',
      });
      return {
        status: 200,
        body: {
          serverRevision: '10',
          entityVersion: '2',
          entity: mineEntity,
          versionState: {
            ...mineVersionState,
            structureVersion: '4',
            pageVersions: { [PAGE_ID]: '1', [page.id]: '2' },
            pageLifecycleVersions: { [PAGE_ID]: '1', [page.id]: '2' },
          },
        },
      };
    });

    await gateway.resolveConflict(conflictId, 'mine');

    expect(transport.requests.at(-2)).toMatchObject({
      path: CORE_API_PATHS.resolveConflict(conflictId),
      body: { choice: 'mine' },
    });
    expect(
      (storage.value as unknown as CoreLocalEnvelope).deferredOutbox,
    ).toEqual([]);
    expect(
      gateway.getSnapshot().notaTransactions.find((nota) => nota.id === NOTA_ID)
        ?.pages.find((candidate) => candidate.id === page.id)?.status,
    ).toBe('cancelled');
    gateway.dispose();
  });
});
