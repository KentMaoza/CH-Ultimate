import { describe, expect, it } from 'vitest';

import type { LabelTemplate } from '../../src/domain/types';
import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import {
  SKU_ID,
  TEMPLATE_ID,
  MemoryStorage,
  ScriptedTransport,
  TestClock,
  deferred,
  populatedBootstrap,
} from './core-gateway-test-support';

const SERVER_LABEL_TEMPLATE = {
  medium: 'thermal' as const,
  widthMm: 50,
  heightMm: 30,
  columns: 1,
  marginMm: 2,
  gapMm: 2,
  fontSize: 9,
  alignment: 'center' as const,
  fields: ['qr' as const, 'name' as const],
};

function labelTemplateRow(
  rowVersion: string,
  definition: LabelTemplate = SERVER_LABEL_TEMPLATE,
) {
  return {
    id: TEMPLATE_ID,
    templateKind: 'label',
    name: 'Label',
    definition,
    rowVersion,
    archivedAt: null,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  };
}

function setup(bootstrap = populatedBootstrap('1')) {
  const transport = new ScriptedTransport();
  const gateway = createCoreOperationsGateway(
    transport,
    new MemoryStorage(),
    new TestClock(),
  );
  transport.enqueue({ status: 200, body: bootstrap });
  return { gateway, transport };
}

describe('Core authoritative catalogue version tracking', () => {
  it('sends the bootstrap SKU row version and advances it from acknowledgements', async () => {
    const { gateway, transport } = setup(
      populatedBootstrap('7', {
        skus: [
          {
            ...populatedBootstrap().skus[0]!,
            rowVersion: '12',
          },
        ],
      }),
    );
    await gateway.initialize();
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '8',
        entityVersion: '13',
        entity: {
          ...populatedBootstrap().skus[0]!,
          name: 'Produk 13',
          rowVersion: '13',
        },
      },
    });
    transport.enqueue({
      status: 200,
      body: { serverRevision: '8', nextAfter: '7', changes: [] },
    });

    await gateway.updateSku(SKU_ID, { name: 'Produk 13' });
    expect(transport.requests[1]).toMatchObject({
      method: 'PATCH',
      path: `/v1/skus/${SKU_ID}`,
      body: {
        rowVersion: '12',
        base: { name: 'Produk Core' },
        patch: { name: 'Produk 13' },
      },
    });

    transport.enqueue({
      status: 200,
      body: { serverRevision: '9', entityVersion: '14' },
    });
    transport.enqueue({
      status: 200,
      body: { serverRevision: '9', nextAfter: '7', changes: [] },
    });
    await gateway.updateSku(SKU_ID, { name: 'Produk 14' });
    expect(transport.requests[3]).toMatchObject({
      body: {
        rowVersion: '13',
        base: { name: 'Produk 13' },
        patch: { name: 'Produk 14' },
      },
    });
  });

  it('rebases a never-sent queued SKU edit with the acknowledged version and base', async () => {
    const { gateway, transport } = setup(
      populatedBootstrap('7', {
        skus: [
          {
            ...populatedBootstrap().skus[0]!,
            rowVersion: '12',
          },
        ],
      }),
    );
    await gateway.initialize();
    const firstResponse = deferred<{ status: number; body: unknown }>();
    const firstStarted = deferred<void>();
    transport.enqueue((request) => {
      expect(request.body).toMatchObject({ rowVersion: '12' });
      firstStarted.resolve();
      return firstResponse.promise;
    });
    transport.enqueue({
      status: 200,
      body: { serverRevision: '8', nextAfter: '7', changes: [] },
    });
    transport.enqueue((request) => {
      expect(request.body).toMatchObject({
        rowVersion: '13',
        base: { name: 'Produk 13' },
        patch: { name: 'Produk 14' },
      });
      return {
        status: 200,
        body: { serverRevision: '9', entityVersion: '14' },
      };
    });
    transport.enqueue({
      status: 200,
      body: { serverRevision: '9', nextAfter: '7', changes: [] },
    });

    const first = gateway.updateSku(SKU_ID, { name: 'Produk 13' });
    await firstStarted.promise;
    const second = gateway.updateSku(SKU_ID, { name: 'Produk 14' });
    firstResponse.resolve({
      status: 200,
      body: {
        serverRevision: '8',
        entityVersion: '13',
        entity: {
          ...populatedBootstrap().skus[0]!,
          name: 'Produk 13',
          rowVersion: '13',
        },
      },
    });

    await Promise.all([first, second]);
  });

  it('uses null only for an absent template and then advances its acknowledgement version', async () => {
    const { gateway, transport } = setup();
    await gateway.initialize();
    const template = {
      ...gateway.getSnapshot().labelTemplate,
      fontSize: 11,
    };
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '2',
        entityVersion: '1',
        entityId: TEMPLATE_ID,
        entity: labelTemplateRow('1', template),
      },
    });
    transport.enqueue({
      status: 200,
      body: { serverRevision: '2', nextAfter: '1', changes: [] },
    });

    await gateway.setLabelTemplate(template);

    expect(transport.requests[1]).toMatchObject({
      path: '/v1/templates/label',
      body: { rowVersion: null, base: null, definition: template },
    });
    const next = { ...template, fontSize: 12 };
    transport.enqueue({
      status: 200,
      body: { serverRevision: '3', entityVersion: '2', entityId: TEMPLATE_ID },
    });
    transport.enqueue({
      status: 200,
      body: { serverRevision: '3', nextAfter: '1', changes: [] },
    });
    await gateway.setLabelTemplate(next);
    expect(transport.requests[3]).toMatchObject({
      body: { rowVersion: '1', base: template, definition: next },
    });
  });

  it('fails closed on cached template state until a bootstrap confirms its version', async () => {
    const storage = new MemoryStorage();
    const onlineTransport = new ScriptedTransport();
    const online = createCoreOperationsGateway(
      onlineTransport,
      storage,
      new TestClock(),
    );
    onlineTransport.enqueue({
      status: 200,
      body: populatedBootstrap('1', {
        templates: [labelTemplateRow('4')],
      }),
    });
    await online.initialize();
    online.dispose();

    const offlineTransport = new ScriptedTransport();
    const offline = createCoreOperationsGateway(
      offlineTransport,
      storage,
      new TestClock(),
    );
    offlineTransport.enqueue(new Error('LAN unavailable'));
    await offline.initialize();

    await expect(
      offline.setLabelTemplate({
        ...offline.getSnapshot().labelTemplate,
        fontSize: 12,
      }),
    ).rejects.toThrow('Versi template belum tersedia');
    expect(offlineTransport.requests).toHaveLength(1);
  });

  it('retries a potentially-sent restored template command byte-for-byte', async () => {
    const storage = new MemoryStorage();
    const firstTransport = new ScriptedTransport();
    const first = createCoreOperationsGateway(
      firstTransport,
      storage,
      new TestClock(),
    );
    firstTransport.enqueue({
      status: 200,
      body: populatedBootstrap('1', {
        templates: [labelTemplateRow('1')],
      }),
    });
    await first.initialize();
    firstTransport.enqueue(new Error('LAN unavailable'));
    const queuedTemplate = {
      ...first.getSnapshot().labelTemplate,
      fontSize: 12,
    };
    await expect(first.setLabelTemplate(queuedTemplate)).rejects.toThrow(
      'LAN unavailable',
    );
    first.dispose();
    const pendingBefore = structuredClone(
      (storage.value as { outbox: Array<Record<string, unknown>> }).outbox[0],
    );

    const secondTransport = new ScriptedTransport();
    const second = createCoreOperationsGateway(
      secondTransport,
      storage,
      new TestClock(),
    );
    secondTransport.enqueue({
      status: 200,
      body: populatedBootstrap('2', {
        templates: [labelTemplateRow('2')],
      }),
    });
    await second.initialize();
    expect(
      (storage.value as { outbox: Array<Record<string, unknown>> }).outbox[0],
    ).toEqual(pendingBefore);

    secondTransport.enqueue((request) => {
      expect(request.idempotencyKey).toBe(pendingBefore?.idempotencyKey);
      expect(request.body).toEqual(pendingBefore?.body);
      return {
        status: 200,
        body: {
          serverRevision: '2',
          entityVersion: '2',
          entity: labelTemplateRow('2', queuedTemplate),
        },
      };
    });
    secondTransport.enqueue({
      status: 200,
      body: { serverRevision: '3', nextAfter: '2', changes: [] },
    });
    await second.retryPending();
  });

  it('keeps a restored stale template base and stores the peer-edit conflict', async () => {
    const storage = new MemoryStorage();
    const firstTransport = new ScriptedTransport();
    const first = createCoreOperationsGateway(
      firstTransport,
      storage,
      new TestClock(),
    );
    firstTransport.enqueue({
      status: 200,
      body: populatedBootstrap('1', {
        templates: [labelTemplateRow('1')],
      }),
    });
    await first.initialize();
    firstTransport.enqueue(new Error('response lost'));
    const mine = { ...SERVER_LABEL_TEMPLATE, fontSize: 12 };
    await expect(first.setLabelTemplate(mine)).rejects.toThrow('response lost');
    first.dispose();
    const original = structuredClone(
      (storage.value as { outbox: Array<Record<string, unknown>> }).outbox[0],
    );
    const peer = { ...SERVER_LABEL_TEMPLATE, fontSize: 11 };

    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
    );
    transport.enqueue({
      status: 200,
      body: populatedBootstrap('3', {
        templates: [labelTemplateRow('3', peer)],
      }),
    });
    await gateway.initialize();
    transport.enqueue((request) => {
      expect(request.idempotencyKey).toBe(original?.idempotencyKey);
      expect(request.body).toEqual(original?.body);
      return {
        status: 409,
        body: {
          code: 'CONFLICT',
          conflict: {
            id: '88888888-8888-4888-8888-888888888888',
            entityType: 'template',
            entityId: TEMPLATE_ID,
            base: SERVER_LABEL_TEMPLATE,
            mine,
            server: peer,
          },
        },
      };
    });

    await expect(gateway.retryPending()).rejects.toThrow('CONFLICT');
    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'conflict',
      conflictCount: 1,
    });
  });

  it('rebases a never-sent queued template with the acknowledged definition', async () => {
    const { gateway, transport } = setup(
      populatedBootstrap('1', {
        templates: [labelTemplateRow('1')],
      }),
    );
    await gateway.initialize();
    const firstResponse = deferred<{ status: number; body: unknown }>();
    const firstStarted = deferred<void>();
    const middle = { ...SERVER_LABEL_TEMPLATE, fontSize: 11 };
    const final = { ...SERVER_LABEL_TEMPLATE, fontSize: 12 };
    transport.enqueue(() => {
      firstStarted.resolve();
      return firstResponse.promise;
    });
    transport.enqueue({
      status: 200,
      body: { serverRevision: '2', nextAfter: '1', changes: [] },
    });
    transport.enqueue((request) => {
      expect(request.body).toEqual({
        rowVersion: '2',
        base: middle,
        definition: final,
      });
      return {
        status: 200,
        body: {
          serverRevision: '3',
          entityVersion: '3',
          entity: labelTemplateRow('3', final),
        },
      };
    });
    transport.enqueue({
      status: 200,
      body: { serverRevision: '3', nextAfter: '1', changes: [] },
    });

    const first = gateway.setLabelTemplate(middle);
    await firstStarted.promise;
    const second = gateway.setLabelTemplate(final);
    firstResponse.resolve({
      status: 200,
      body: {
        serverRevision: '2',
        entityVersion: '2',
        entity: labelTemplateRow('2', middle),
      },
    });

    await Promise.all([first, second]);
  });

  it('fails closed before transport when a SKU row version is unavailable', async () => {
    const { gateway, transport } = setup(populatedBootstrap('1', { skus: [] }));
    await gateway.initialize();

    await expect(
      gateway.updateSku(SKU_ID, { name: 'Tidak boleh dikirim' }),
    ).rejects.toThrow('Versi SKU belum tersedia');
    expect(transport.requests).toHaveLength(1);
  });

  it('sends stock changes only as signed deltas, never replacement balances', async () => {
    const { gateway, transport } = setup();
    await gateway.initialize();
    transport.enqueue({
      status: 200,
      body: { serverRevision: '2', entityVersion: '2' },
    });
    transport.enqueue({
      status: 200,
      body: { serverRevision: '2', nextAfter: '1', changes: [] },
    });

    await gateway.adjustStock(SKU_ID, -4);

    expect(transport.requests[1]).toMatchObject({
      body: { delta: -4 },
    });
    expect(transport.requests[1]?.body).not.toHaveProperty('quantity');
    expect(transport.requests[1]?.body).not.toHaveProperty('balance');
  });

  it('queues one durable idempotent SKU image replacement command', async () => {
    const { gateway, transport } = setup();
    await gateway.initialize();
    const bytesBase64 = 'iVBORw0KGgoAAAAAAAAASUhEUgAAACAAAAAY';
    const nextHash = 'b'.repeat(64);
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '2',
        entityVersion: '2',
        entity: {
          ...populatedBootstrap().skus[0]!,
          imageHash: nextHash,
          sourceImageUrl: null,
          rowVersion: '2',
        },
      },
    });
    transport.enqueue({
      status: 200,
      body: { serverRevision: '2', nextAfter: '1', changes: [] },
    });

    await gateway.updateSku(SKU_ID, {
      imageUrl: `data:image/png;base64,${bytesBase64}`,
    });

    expect(transport.requests[1]).toMatchObject({
      method: 'POST',
      path: `/v1/skus/${SKU_ID}/image`,
      idempotencyKey: expect.any(String),
      body: {
        rowVersion: '1',
        base: {
          imageHash: 'a'.repeat(64),
          sourceImageUrl: 'https://res.bigseller.pro/a.png',
        },
        mimeType: 'image/png',
        bytesBase64,
      },
    });
    expect(transport.requests).toHaveLength(3);
  });

  it('restarts and replays the exact durable image command after a lost response', async () => {
    const storage = new MemoryStorage();
    const firstTransport = new ScriptedTransport();
    const first = createCoreOperationsGateway(
      firstTransport,
      storage,
      new TestClock(),
    );
    firstTransport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await first.initialize();
    firstTransport.enqueue(new Error('response lost'));
    const bytesBase64 = 'iVBORw0KGgoAAAAAAAAASUhEUgAAACAAAAAY';
    await expect(
      first.updateSku(SKU_ID, {
        imageUrl: `data:image/png;base64,${bytesBase64}`,
      }),
    ).rejects.toThrow('response lost');
    first.dispose();
    const pending = structuredClone(
      (storage.value as { outbox: Array<Record<string, unknown>> }).outbox[0],
    );
    expect(pending).toMatchObject({
      path: `/v1/skus/${SKU_ID}/image`,
      idempotencyKey: expect.any(String),
    });

    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
    );
    transport.enqueue({
      status: 200,
      body: populatedBootstrap('2', {
        skus: [
          {
            ...populatedBootstrap().skus[0]!,
            imageHash: 'b'.repeat(64),
            sourceImageUrl: null,
            rowVersion: '2',
          },
        ],
      }),
    });
    await gateway.initialize();
    transport.enqueue((request) => {
      expect(request.idempotencyKey).toBe(pending?.idempotencyKey);
      expect(request.body).toEqual(pending?.body);
      return {
        status: 200,
        body: {
          serverRevision: '2',
          entityVersion: '2',
          entity: {
            ...populatedBootstrap().skus[0]!,
            imageHash: 'b'.repeat(64),
            sourceImageUrl: null,
            rowVersion: '2',
          },
        },
      };
    });
    transport.enqueue({
      status: 200,
      body: { serverRevision: '2', nextAfter: '2', changes: [] },
    });

    await gateway.retryPending();
    expect(gateway.getSyncSnapshot().pendingCount).toBe(0);
  });

  it('maps image hash and private source metadata from bootstrap and changes', async () => {
    const { gateway, transport } = setup();
    await gateway.initialize();
    expect(gateway.getSnapshot().skus[0]).toMatchObject({
      imageHash: 'a'.repeat(64),
      sourceImageUrl: 'https://res.bigseller.pro/a.png',
    });
    transport.enqueue({
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
              imageHash: 'b'.repeat(64),
              sourceImageUrl: null,
              rowVersion: '2',
            },
            createdAt: '2026-07-30T03:00:00.000Z',
          },
        ],
      },
    });

    await gateway.retryPending();

    expect(gateway.getSnapshot().skus[0]).toMatchObject({
      imageHash: 'b'.repeat(64),
      sourceImageUrl: null,
    });
  });

  it('drops a permanent identifier rejection and returns actionable Indonesian copy', async () => {
    const { gateway, transport } = setup();
    await gateway.initialize();
    transport.enqueue({
      status: 409,
      body: { code: 'IDENTIFIER_CONFLICT' },
    });

    await expect(
      gateway.updateSku(SKU_ID, { skuNumber: 'DUPLIKAT' }),
    ).rejects.toThrow('Nomor SKU atau alias sudah digunakan.');
    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'online',
      pendingCount: 0,
    });
  });

  it('hydrates authoritative price and stock history from bootstrap rows', async () => {
    const { gateway } = setup(
      populatedBootstrap('5', {
        priceHistory: [
          {
            id: '88888888-8888-4888-8888-888888888888',
            skuId: SKU_ID,
            priceRupiah: '27000',
            beforePriceRupiah: '25000',
            source: 'manual',
            changedByDeviceId: '66666666-6666-4666-8666-666666666666',
            effectiveAt: '2026-07-30T05:00:00.000Z',
          },
        ],
        stockMovements: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            skuId: SKU_ID,
            deltaPcs: '-2',
            reason: 'manual_adjustment',
            deviceId: '66666666-6666-4666-8666-666666666666',
            operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            createdAt: '2026-07-30T05:01:00.000Z',
            beforeQuantityPcs: '14',
            afterQuantityPcs: '12',
          },
        ],
      }),
    );

    await gateway.initialize();

    expect(gateway.getSnapshot().priceChanges).toEqual([
      expect.objectContaining({ before: 25000, after: 27000 }),
    ]);
    expect(gateway.getSnapshot().adjustments).toEqual([
      expect.objectContaining({ quantity: -2, before: 14, after: 12 }),
    ]);
  });
});
