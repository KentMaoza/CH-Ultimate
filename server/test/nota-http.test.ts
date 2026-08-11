import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { IdentityError } from '../src/auth/identity.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const NOTA_ID = '22222222-2222-4222-8222-222222222222';
const PAGE_ID = '33333333-3333-4333-8333-333333333333';
const LINE_ID = '44444444-4444-4444-8444-444444444444';
const KEY = '55555555-5555-4555-8555-555555555555';

function harness() {
  const device = {
    id: DEVICE_ID,
    installationId: '66666666-6666-4666-8666-666666666666',
    role: 'client' as const,
    displayName: 'Laptop',
    platform: 'windows',
    tokenExpiresAt: '2027-01-25T00:00:00.000Z',
    approvedAt: '2026-07-29T00:00:00.000Z',
    revokedAt: null,
    tokenKind: 'current' as const,
  };
  const nota = {
    create: vi.fn(async () => ({ serverRevision: '1' })),
    addPage: vi.fn(async () => ({ serverRevision: '2' })),
    cancelPage: vi.fn(async () => ({ serverRevision: '3' })),
    restorePage: vi.fn(async () => ({ serverRevision: '4' })),
    updateHeader: vi.fn(async () => ({ serverRevision: '5' })),
    updateLine: vi.fn(async () => ({ serverRevision: '6' })),
    deleteLine: vi.fn(async () => ({ serverRevision: '7' })),
    complete: vi.fn(async () => ({ serverRevision: '8' })),
    reopen: vi.fn(async () => ({ serverRevision: '9' })),
    cancel: vi.fn(async () => ({ serverRevision: '10' })),
    restore: vi.fn(async () => ({ serverRevision: '11' })),
    resolveConflict: vi.fn(async () => ({ serverRevision: '12' })),
  };
  const identity = {
    bootstrapOwner: vi.fn(),
    authenticate: vi.fn(async (token: string) => {
      if (token === 'token') return device;
      throw new IdentityError('UNAUTHORIZED', 401, 'Unauthorized');
    }),
    createPairing: vi.fn(),
    inspectPairing: vi.fn(),
    claimPairing: vi.fn(),
    approvePairing: vi.fn(),
    completePairing: vi.fn(),
    listDevices: vi.fn(),
    revokeDevice: vi.fn(),
    rotateDeviceToken: vi.fn(),
  };
  const app = buildApp({
    pool: { query: async <T>() => [{ version: 8 }] as T },
    protocol: {
      identity,
      sync: { bootstrap: vi.fn(), changes: vi.fn() },
    },
    nota,
  });
  return { app, device, nota };
}

const headers = {
  authorization: 'Bearer token',
  'idempotency-key': KEY,
};

describe('Nota HTTP boundary', () => {
  it('creates a Nota through the authenticated idempotent route', async () => {
    const { app, device, nota } = harness();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/notas',
      headers,
      payload: {},
    });

    expect(response.statusCode).toBe(201);
    expect(nota.create).toHaveBeenCalledWith(
      { deviceId: device.id, idempotencyKey: KEY },
      {},
    );
    await app.close();
  });

  it('accepts client-selected page and exactly fifteen unique line UUIDs', async () => {
    const { app, device, nota } = harness();
    const clientLineIds = Array.from(
      { length: 15 },
      (_, index) =>
        `70000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    const payload = {
      lifecycleVersion: '1',
      structureVersion: '1',
      clientPageId: PAGE_ID,
      clientLineIds,
    };

    const response = await app.inject({
      method: 'POST',
      url: `/v1/notas/${NOTA_ID}/pages`,
      headers,
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(nota.addPage).toHaveBeenCalledWith(
      { deviceId: device.id, idempotencyKey: KEY },
      NOTA_ID,
      payload,
    );

    const malformed = await app.inject({
      method: 'POST',
      url: `/v1/notas/${NOTA_ID}/pages`,
      headers: { ...headers, 'idempotency-key': DEVICE_ID },
      payload: { ...payload, clientLineIds: clientLineIds.slice(0, 14) },
    });
    expect(malformed.statusCode).toBe(400);

    const colliding = await app.inject({
      method: 'POST',
      url: `/v1/notas/${NOTA_ID}/pages`,
      headers: {
        ...headers,
        'idempotency-key': '99999999-9999-4999-8999-999999999999',
      },
      payload: {
        ...payload,
        clientLineIds: [PAGE_ID, ...clientLineIds.slice(1)],
      },
    });
    expect(colliding.statusCode).toBe(400);
    await app.close();
  });

  it.each([
    {
      description: 'Produk Uji',
      kind: '',
    },
    {
      description: '',
      kind: 'Ukuran Besar',
    },
  ])('accepts an in-progress Nota line while the operator is still typing', async ({ description, kind }) => {
    const { app, nota } = harness();
    const payload = {
      lifecycleVersion: '1',
      pageVersion: '1',
      lineVersion: '1',
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
      mine: {
        linePosition: 0,
        skuId: null,
        description,
        kind,
        quantity: 0,
        unit: 'pcs',
        pcsPrice: 0,
        lsnPrice: 0,
      },
    };

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/notas/${NOTA_ID}/pages/${PAGE_ID}/lines/${LINE_ID}`,
      headers,
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(nota.updateLine).toHaveBeenCalledWith(
      { deviceId: DEVICE_ID, idempotencyKey: KEY },
      NOTA_ID,
      PAGE_ID,
      LINE_ID,
      payload,
    );
    await app.close();
  });

  it('accepts clearing a partially typed Nota line', async () => {
    const { app, nota } = harness();
    const payload = {
      lifecycleVersion: '1',
      pageVersion: '1',
      lineVersion: '2',
      base: {
        linePosition: 0,
        skuId: null,
        description: 'Produk Uji',
        kind: '',
        quantity: 0,
        unit: 'pcs',
        pcsPrice: 0,
        lsnPrice: 0,
      },
    };

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/notas/${NOTA_ID}/pages/${PAGE_ID}/lines/${LINE_ID}`,
      headers,
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(nota.deleteLine).toHaveBeenCalledWith(
      { deviceId: DEVICE_ID, idempotencyKey: KEY },
      NOTA_ID,
      PAGE_ID,
      LINE_ID,
      payload,
    );
    await app.close();
  });

  it.each([
    {
      method: 'POST',
      url: `/v1/notas/${NOTA_ID}/pages`,
      payload: { lifecycleVersion: '1', structureVersion: '1' },
    },
    {
      method: 'POST',
      url: `/v1/notas/${NOTA_ID}/pages/${PAGE_ID}/cancel`,
      payload: { lifecycleVersion: '1', structureVersion: '1', pageVersion: '1' },
    },
    {
      method: 'POST',
      url: `/v1/notas/${NOTA_ID}/pages/${PAGE_ID}/restore`,
      payload: { lifecycleVersion: '1', structureVersion: '1', pageVersion: '1' },
    },
    {
      method: 'PATCH',
      url: `/v1/notas/${NOTA_ID}/header`,
      payload: {
        lifecycleVersion: '1',
        fields: {
          customerName: { version: '1', base: '', mine: 'Amelia' },
        },
      },
    },
    {
      method: 'PATCH',
      url: `/v1/notas/${NOTA_ID}/pages/${PAGE_ID}/lines/${LINE_ID}`,
      payload: {
        lifecycleVersion: '1',
        pageVersion: '1',
        lineVersion: null,
        base: null,
        mine: {
          linePosition: 0,
          skuId: null,
          description: 'Kopi',
          kind: 'Minuman',
          quantity: 2,
          unit: 'pcs',
          pcsPrice: 12000,
          lsnPrice: 144000,
        },
      },
    },
    {
      method: 'DELETE',
      url: `/v1/notas/${NOTA_ID}/pages/${PAGE_ID}/lines/${LINE_ID}`,
      payload: {
        lifecycleVersion: '1',
        pageVersion: '1',
        lineVersion: '1',
        base: {
          linePosition: 0,
          skuId: null,
          description: 'Kopi',
          kind: 'Minuman',
          quantity: 2,
          unit: 'pcs',
          pcsPrice: 12000,
          lsnPrice: 144000,
        },
      },
    },
    {
      method: 'POST',
      url: `/v1/notas/${NOTA_ID}/complete`,
      payload: { lifecycleVersion: '1', destination: 'archive' },
    },
    {
      method: 'POST',
      url: `/v1/notas/${NOTA_ID}/reopen`,
      payload: { lifecycleVersion: '1' },
    },
    {
      method: 'POST',
      url: `/v1/notas/${NOTA_ID}/cancel`,
      payload: { lifecycleVersion: '1' },
    },
    {
      method: 'POST',
      url: `/v1/notas/${NOTA_ID}/restore`,
      payload: { lifecycleVersion: '1' },
    },
    {
      method: 'POST',
      url: `/v1/conflicts/${NOTA_ID}/resolve`,
      payload: { choice: 'mine' },
    },
  ])('accepts strict $method $url', async ({ method, url, payload }) => {
    const { app } = harness();
    const response = await app.inject({
      method: method as 'POST' | 'PATCH' | 'DELETE',
      url,
      headers,
      payload,
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('rejects malformed, unbounded, and unversioned bodies', async () => {
    const { app, nota } = harness();
    const cases = [
      { url: '/v1/notas', payload: { clientNumber: 'CHU-FAKE' } },
      {
        url: `/v1/notas/${NOTA_ID}/pages`,
        payload: { structureVersion: '01' },
      },
      {
        method: 'PATCH',
        url: `/v1/notas/${NOTA_ID}/header`,
        payload: {
          lifecycleVersion: '1',
          fields: { customerName: { mine: 'A' } },
        },
      },
      {
        method: 'PATCH',
        url: `/v1/notas/${NOTA_ID}/pages/${PAGE_ID}/lines/${LINE_ID}`,
        payload: {
          lifecycleVersion: '1',
          pageVersion: '1',
          lineVersion: null,
          base: null,
          mine: {
            linePosition: 15,
            skuId: null,
            description: 'X',
            kind: '',
            quantity: 1,
            unit: 'pcs',
            pcsPrice: 1,
            lsnPrice: 12,
          },
        },
      },
      {
        method: 'PATCH',
        url: `/v1/notas/${NOTA_ID}/header`,
        payload: {
          lifecycleVersion: '1',
          fields: {
            payment: { version: '1', base: 'cash', mine: 'poison' },
          },
        },
      },
      {
        method: 'PATCH',
        url: `/v1/notas/${NOTA_ID}/header`,
        payload: {
          lifecycleVersion: '1',
          fields: {
            transactionDate: {
              version: '1',
              base: '2026-07-30',
              mine: '30/07/2026',
            },
          },
        },
      },
      {
        method: 'PATCH',
        url: `/v1/notas/${NOTA_ID}/pages/${PAGE_ID}/lines/${LINE_ID}`,
        payload: {
          lifecycleVersion: '1',
          pageVersion: '1',
          lineVersion: null,
          base: null,
          mine: {
            linePosition: 0,
            skuId: null,
            description: 'Overflow',
            kind: '',
            quantity: Number.MAX_SAFE_INTEGER,
            unit: 'lsn',
            pcsPrice: 1,
            lsnPrice: Number.MAX_SAFE_INTEGER,
          },
        },
      },
      {
        url: `/v1/notas/${NOTA_ID}/complete`,
        payload: { lifecycleVersion: '1', destination: 'outside' },
      },
    ];
    for (const entry of cases) {
      const response = await app.inject({
        method: (entry.method ?? 'POST') as 'POST' | 'PATCH',
        url: entry.url,
        headers,
        payload: entry.payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(nota.create).not.toHaveBeenCalled();
    await app.close();
  });
});
