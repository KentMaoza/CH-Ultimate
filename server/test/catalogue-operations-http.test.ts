import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { IdentityError } from '../src/auth/identity.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const SKU_ID = '22222222-2222-4222-8222-222222222222';
const KEY = '33333333-3333-4333-8333-333333333333';

function harness() {
  const device = {
    id: DEVICE_ID,
    installationId: '44444444-4444-4444-8444-444444444444',
    role: 'client' as const,
    displayName: 'Phone',
    platform: 'android',
    tokenExpiresAt: '2027-01-25T00:00:00.000Z',
    approvedAt: '2026-07-29T00:00:00.000Z',
    revokedAt: null,
    tokenKind: 'current' as const,
  };
  const operations = {
    createSku: vi.fn(async () => ({ serverRevision: '1' })),
    updateSku: vi.fn(async () => ({ serverRevision: '2' })),
    adjustStock: vi.fn(async () => ({ serverRevision: '3' })),
    updateTemplate: vi.fn(async () => ({ serverRevision: '4' })),
  };
  const identity = {
    bootstrapOwner: vi.fn(),
    authenticate: vi.fn(async (token: string) => {
      if (token === 'token') return device;
      throw new IdentityError('UNAUTHORIZED', 401, 'Unauthorized');
    }),
    createPairing: vi.fn(),
    claimPairing: vi.fn(),
    approvePairing: vi.fn(),
    completePairing: vi.fn(),
    listDevices: vi.fn(),
    revokeDevice: vi.fn(),
    rotateDeviceToken: vi.fn(),
  };
  const app = buildApp({
    pool: { query: async <T>() => [{ version: 7 }] as T },
    protocol: {
      identity,
      sync: { bootstrap: vi.fn(), changes: vi.fn() },
    },
    operations,
  });
  return { app, device, operations };
}

const headers = {
  authorization: 'Bearer token',
  'idempotency-key': KEY,
};

describe('catalogue operation HTTP boundary', () => {
  it('requires authentication and a UUID idempotency key', async () => {
    const { app, operations } = harness();
    const payload = {
      skuNumber: 'CH-001',
      name: 'Beras',
      referencePrice: 12000,
      openingStock: 2,
      tracked: true,
    };

    expect(
      (await app.inject({ method: 'POST', url: '/v1/skus', payload }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/skus',
          headers: { authorization: 'Bearer token' },
          payload,
        })
      ).statusCode,
    ).toBe(400);
    expect(operations.createSku).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts strict SKU create and versioned patch contracts', async () => {
    const { app, device, operations } = harness();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/skus',
      headers,
      payload: {
        skuNumber: 'CH-001',
        name: 'Beras',
        referencePrice: 12000,
        openingStock: -2,
        tracked: true,
        note: '',
        imageUrl: 'https://example.test/beras.png',
      },
    });
    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/skus/${SKU_ID}`,
      headers,
      payload: {
        rowVersion: '7',
        base: { name: 'Beras', referencePrice: 12000 },
        patch: { name: 'Beras Premium', referencePrice: 13000 },
      },
    });

    expect(created.statusCode).toBe(201);
    expect(operations.createSku).toHaveBeenCalledWith(
      { deviceId: device.id, idempotencyKey: KEY },
      expect.objectContaining({ skuNumber: 'CH-001', openingStock: -2 }),
    );
    expect(patched.statusCode).toBe(200);
    expect(operations.updateSku).toHaveBeenCalledWith(
      { deviceId: device.id, idempotencyKey: KEY },
      SKU_ID,
      {
        rowVersion: '7',
        base: { name: 'Beras', referencePrice: 12000 },
        patch: { name: 'Beras Premium', referencePrice: 13000 },
      },
    );
    await app.close();
  });

  it.each([
    {
      method: 'POST' as const,
      url: '/v1/skus',
      payload: {
        skuNumber: '   ',
        name: 'Beras',
        referencePrice: 1,
        openingStock: 0,
        tracked: true,
      },
    },
    {
      method: 'PATCH' as const,
      url: `/v1/skus/${SKU_ID}`,
      payload: { rowVersion: '01', patch: { name: 'Beras' } },
    },
    {
      method: 'PATCH' as const,
      url: `/v1/skus/${SKU_ID}`,
      payload: { rowVersion: '1', patch: { name: 'Beras' } },
    },
    {
      method: 'PATCH' as const,
      url: `/v1/skus/${SKU_ID}`,
      payload: { rowVersion: '1', patch: {} },
    },
    {
      method: 'POST' as const,
      url: `/v1/skus/${SKU_ID}/stock-adjustments`,
      payload: { delta: 0 },
    },
    {
      method: 'POST' as const,
      url: '/v1/skus/not-a-uuid/stock-adjustments',
      payload: { delta: 2 },
    },
    {
      method: 'PATCH' as const,
      url: '/v1/templates/receipt',
      payload: { rowVersion: null, definition: {} },
    },
    {
      method: 'PATCH' as const,
      url: '/v1/templates/label',
      payload: {
        rowVersion: null,
        base: null,
        definition: {
          medium: 'thermal',
          widthMm: 50,
          heightMm: 30,
          columns: 1,
          marginMm: 2,
          gapMm: 1,
          fontSize: 10,
          alignment: 'center',
          fields: ['qr', 'qr'],
        },
      },
    },
    {
      method: 'PATCH' as const,
      url: '/v1/templates/invoice',
      payload: {
        rowVersion: null,
        base: null,
        definition: {
          widthMm: 210,
          heightMm: 297,
          fontSize: 10,
          logoUrl: '',
          bankAccount: '',
          address: '',
          phone: '',
          elements: [
            { id: 'logo', visible: true },
            { id: 'logo', visible: false },
          ],
        },
      },
    },
  ])('rejects invalid mutation $url', async ({ method, url, payload }) => {
    const { app, operations } = harness();
    const response = await app.inject({
      method,
      url,
      headers,
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: 'INVALID_REQUEST' });
    expect(operations.updateSku).not.toHaveBeenCalled();
    expect(operations.adjustStock).not.toHaveBeenCalled();
    expect(operations.updateTemplate).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts signed stock deltas and bounded template definitions', async () => {
    const { app, device, operations } = harness();
    const stock = await app.inject({
      method: 'POST',
      url: `/v1/skus/${SKU_ID}/stock-adjustments`,
      headers,
      payload: { delta: -5 },
    });
    const template = await app.inject({
      method: 'PATCH',
      url: '/v1/templates/label',
      headers,
      payload: {
        rowVersion: null,
        base: null,
        definition: {
          medium: 'thermal',
          widthMm: 50,
          heightMm: 30,
          columns: 1,
          marginMm: 2,
          gapMm: 1,
          fontSize: 10,
          alignment: 'center',
          fields: ['qr', 'name'],
        },
      },
    });

    expect(stock.statusCode).toBe(200);
    expect(operations.adjustStock).toHaveBeenCalledWith(
      { deviceId: device.id, idempotencyKey: KEY },
      SKU_ID,
      { delta: -5 },
    );
    expect(template.statusCode).toBe(200);
    expect(operations.updateTemplate).toHaveBeenCalledWith(
      { deviceId: device.id, idempotencyKey: KEY },
      'label',
      expect.objectContaining({ rowVersion: null, base: null }),
    );
    await app.close();
  });
});
