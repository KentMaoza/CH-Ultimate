import { describe, expect, it } from 'vitest';

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
      body: { serverRevision: '8', entityVersion: '13' },
    });
    transport.enqueue({
      status: 200,
      body: { serverRevision: '8', nextAfter: '7', changes: [] },
    });

    await gateway.updateSku(SKU_ID, { name: 'Produk 13' });
    expect(transport.requests[1]).toMatchObject({
      method: 'PATCH',
      path: `/v1/skus/${SKU_ID}`,
      body: { rowVersion: '12', patch: { name: 'Produk 13' } },
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
      body: { rowVersion: '13', patch: { name: 'Produk 14' } },
    });
  });

  it('rebases a queued SKU edit after the preceding acknowledgement', async () => {
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
      expect(request.body).toMatchObject({ rowVersion: '13' });
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
    const second = gateway.updateSku(SKU_ID, { note: 'Perubahan lanjutan' });
    firstResponse.resolve({
      status: 200,
      body: { serverRevision: '8', entityVersion: '13' },
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
      },
    });
    transport.enqueue({
      status: 200,
      body: { serverRevision: '2', nextAfter: '1', changes: [] },
    });

    await gateway.setLabelTemplate(template);

    expect(transport.requests[1]).toMatchObject({
      path: '/v1/templates/label',
      body: { rowVersion: null, definition: template },
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
      body: { rowVersion: '1', definition: next },
    });
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
