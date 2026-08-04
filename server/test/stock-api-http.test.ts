import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const SKU_ID = '33333333-3333-4333-8333-333333333333';
const IDENTIFIER_ID = '44444444-4444-4444-8444-444444444444';
const KEY = '55555555-5555-4555-8555-555555555555';
const CANONICAL_SKU_ID = 'a3333333-b333-4333-8333-c33333333333';
const CANONICAL_IDENTIFIER_ID = 'd4444444-e444-4444-8444-f44444444444';

function device(id: string, role: 'owner' | 'client') {
  return {
    id,
    installationId: '66666666-6666-4666-8666-666666666666',
    role,
    displayName: role === 'owner' ? 'Owner Mac' : 'HP Gudang',
    platform: role === 'owner' ? 'macos' : 'android',
    tokenExpiresAt: '2027-08-04T00:00:00.000Z',
    approvedAt: '2026-08-04T00:00:00.000Z',
    revokedAt: null,
    tokenKind: 'current' as const,
  };
}

function harness() {
  const owner = device(OWNER_ID, 'owner');
  const client = device(CLIENT_ID, 'client');
  const identity = {
    authenticate: vi.fn(async (token: string) => token === 'owner-token' ? owner : client),
  };
  const stockChecks = {
    checkOnline: vi.fn(
      async (_context: unknown, _skuId: string, _input: unknown) => ({ apiSchemaVersion: 2 }),
    ),
    checkOffline: vi.fn(
      async (_context: unknown, _input: { skuId: string }) => ({ apiSchemaVersion: 2 }),
    ),
  };
  const packageBarcodes = {
    register: vi.fn(
      async (_context: unknown, _skuId: string, _identifierValue: string) => ({ apiSchemaVersion: 2 }),
    ),
    remove: vi.fn(
      async (_context: unknown, _identifierId: string) => ({ apiSchemaVersion: 2 }),
    ),
    reassign: vi.fn(
      async (_context: unknown, _identifierId: string, _skuId: string) => ({ apiSchemaVersion: 2 }),
    ),
  };
  const app = buildApp({
    pool: { async query<T>() { return [{ version: 10 }] as T; } },
    protocol: {
      identity,
      sync: { bootstrap: vi.fn(), changes: vi.fn() },
    } as never,
    stockChecks,
    packageBarcodes,
  });
  return { app, stockChecks, packageBarcodes, owner, client };
}

const clientHeaders = {
  authorization: 'Bearer client-token',
  'idempotency-key': KEY,
};
const ownerHeaders = {
  authorization: 'Bearer owner-token',
  'idempotency-key': KEY,
};

describe('stock-check and package-barcode HTTP routes', () => {
  it('accepts online and forced-offline stock checks from any paired device', async () => {
    const { app, stockChecks, client } = harness();
    const online = await app.inject({
      method: 'POST',
      url: `/v1/skus/${SKU_ID}/stock-checks`,
      headers: clientHeaders,
      payload: {
        observedQuantityPcs: 7,
        countedQuantityPcs: 8,
        baseBalanceVersion: '4',
        countedAt: '2026-08-04T01:10:00.000Z',
        note: '  Rak utara  ',
      },
    });
    const offline = await app.inject({
      method: 'POST',
      url: '/v1/offline/stock-checks',
      headers: clientHeaders,
      payload: {
        skuId: SKU_ID,
        observedQuantityPcs: 10,
        countedQuantityPcs: 8,
        baseBalanceVersion: '3',
        countedAt: '2026-08-04T01:10:00.000Z',
      },
    });

    expect(online.statusCode).toBe(200);
    expect(offline.statusCode).toBe(200);
    expect(stockChecks.checkOnline).toHaveBeenCalledWith(
      {
        deviceId: client.id,
        deviceDisplayName: 'HP Gudang',
        idempotencyKey: KEY,
      },
      SKU_ID,
      expect.objectContaining({ note: 'Rak utara' }),
    );
    expect(stockChecks.checkOffline).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: client.id }),
      expect.objectContaining({ skuId: SKU_ID, countedQuantityPcs: 8 }),
    );
    await app.close();
  });

  it('keeps registration open to paired clients but remove and reassign owner-only', async () => {
    const { app, packageBarcodes, client } = harness();
    const registered = await app.inject({
      method: 'POST',
      url: `/v1/skus/${SKU_ID}/package-barcodes`,
      headers: clientHeaders,
      payload: { identifierValue: ' 8990001234567 ' },
    });
    const clientRemove = await app.inject({
      method: 'DELETE',
      url: `/v1/package-barcodes/${IDENTIFIER_ID}`,
      headers: clientHeaders,
    });
    const clientReassign = await app.inject({
      method: 'PATCH',
      url: `/v1/package-barcodes/${IDENTIFIER_ID}`,
      headers: clientHeaders,
      payload: { skuId: SKU_ID },
    });
    const ownerRemove = await app.inject({
      method: 'DELETE',
      url: `/v1/package-barcodes/${IDENTIFIER_ID}`,
      headers: ownerHeaders,
    });
    const ownerReassign = await app.inject({
      method: 'PATCH',
      url: `/v1/package-barcodes/${IDENTIFIER_ID}`,
      headers: ownerHeaders,
      payload: { skuId: SKU_ID },
    });

    expect(registered.statusCode).toBe(200);
    expect(packageBarcodes.register).toHaveBeenCalledWith(
      { deviceId: client.id, idempotencyKey: KEY },
      SKU_ID,
      '8990001234567',
    );
    expect(clientRemove.statusCode).toBe(403);
    expect(clientReassign.statusCode).toBe(403);
    expect(ownerRemove.statusCode).toBe(200);
    expect(ownerReassign.statusCode).toBe(200);
    expect(packageBarcodes.remove).toHaveBeenCalledTimes(1);
    expect(packageBarcodes.reassign).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('canonicalizes uppercase stock-check path and body UUIDs', async () => {
    const { app, stockChecks } = harness();
    const uppercaseSkuId = CANONICAL_SKU_ID.toUpperCase();

    await app.inject({
      method: 'POST',
      url: `/v1/skus/${uppercaseSkuId}/stock-checks`,
      headers: clientHeaders,
      payload: {
        observedQuantityPcs: 7,
        countedQuantityPcs: 8,
        baseBalanceVersion: '4',
        countedAt: '2026-08-04T01:10:00.000Z',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/offline/stock-checks',
      headers: clientHeaders,
      payload: {
        skuId: uppercaseSkuId,
        observedQuantityPcs: 7,
        countedQuantityPcs: 8,
        countedAt: '2026-08-04T01:10:00.000Z',
      },
    });

    expect({
      onlineSkuId: stockChecks.checkOnline.mock.calls[0]?.[1],
      offlineSkuId: stockChecks.checkOffline.mock.calls[0]?.[1].skuId,
    }).toEqual({
      onlineSkuId: CANONICAL_SKU_ID,
      offlineSkuId: CANONICAL_SKU_ID,
    });
    await app.close();
  });

  it('canonicalizes uppercase barcode relation path and body UUIDs', async () => {
    const { app, packageBarcodes } = harness();
    const uppercaseSkuId = CANONICAL_SKU_ID.toUpperCase();
    const uppercaseIdentifierId = CANONICAL_IDENTIFIER_ID.toUpperCase();

    await app.inject({
      method: 'POST',
      url: `/v1/skus/${uppercaseSkuId}/package-barcodes`,
      headers: clientHeaders,
      payload: { identifierValue: '8990001234567' },
    });
    await app.inject({
      method: 'DELETE',
      url: `/v1/package-barcodes/${uppercaseIdentifierId}`,
      headers: ownerHeaders,
    });
    await app.inject({
      method: 'PATCH',
      url: `/v1/package-barcodes/${uppercaseIdentifierId}`,
      headers: ownerHeaders,
      payload: { skuId: uppercaseSkuId },
    });

    expect({
      registeredSkuId: packageBarcodes.register.mock.calls[0]?.[1],
      removedIdentifierId: packageBarcodes.remove.mock.calls[0]?.[1],
      reassignedIdentifierId: packageBarcodes.reassign.mock.calls[0]?.[1],
      reassignedSkuId: packageBarcodes.reassign.mock.calls[0]?.[2],
    }).toEqual({
      registeredSkuId: CANONICAL_SKU_ID,
      removedIdentifierId: CANONICAL_IDENTIFIER_ID,
      reassignedIdentifierId: CANONICAL_IDENTIFIER_ID,
      reassignedSkuId: CANONICAL_SKU_ID,
    });
    await app.close();
  });

  it('rejects unsafe quantities, overlong notes, and a parallel v2 namespace', async () => {
    const { app, stockChecks } = harness();
    for (const payload of [
      {
        observedQuantityPcs: Number.MAX_SAFE_INTEGER + 1,
        countedQuantityPcs: 8,
        baseBalanceVersion: '4',
        countedAt: '2026-08-04T01:10:00.000Z',
      },
      {
        observedQuantityPcs: 7,
        countedQuantityPcs: 8,
        baseBalanceVersion: '4',
        countedAt: '2026-08-04T01:10:00.000Z',
        note: 'x'.repeat(513),
      },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/skus/${SKU_ID}/stock-checks`,
        headers: clientHeaders,
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    const v2 = await app.inject({
      method: 'POST',
      url: `/v2/skus/${SKU_ID}/stock-checks`,
      headers: clientHeaders,
      payload: {},
    });
    expect(v2.statusCode).toBe(404);
    expect(stockChecks.checkOnline).not.toHaveBeenCalled();
    await app.close();
  });
});
