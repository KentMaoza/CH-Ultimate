import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { IdentityError } from '../src/auth/identity.js';
import { OfflineOperationsService } from '../src/offline/service.js';
import type { OfflineNotaRequest } from '../src/offline/validation.js';
import type {
  ProtocolConnection,
  ProtocolPool,
} from '../src/sync/idempotency.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const KEY = '22222222-2222-4222-8222-222222222222';
const PROVISIONAL_ID = '33333333-3333-4333-8333-333333333333';
const PAGE_ID = '44444444-4444-4444-8444-444444444444';
const LINE_ID = '55555555-5555-4555-8555-555555555555';
const SKU_ID = '66666666-6666-4666-8666-666666666666';

function notaPayload(): OfflineNotaRequest {
  return {
    provisionalId: PROVISIONAL_ID,
    completed: true,
    destination: 'archive',
    skuSnapshots: [
      {
        skuId: SKU_ID,
        identifier: 'SKU-001',
        name: 'Produk',
        referencePrice: 25_000,
      },
    ],
    snapshot: {
      id: PROVISIONAL_ID,
      baseNumber: 'OFFLINE-33333333',
      customerName: 'Toko',
      customerPlace: 'Samarinda',
      transactionDate: '2026-07-30',
      payment: 'cash',
      status: 'completed',
      completionDestination: 'archive',
      completedAt: '2026-07-30T02:00:00.000Z',
      nextNoteIndex: 1,
      pages: [
        {
          id: PAGE_ID,
          suffix: 'A',
          status: 'active',
          lines: [
            {
              id: LINE_ID,
              skuId: SKU_ID,
              description: 'Produk',
              kind: '',
              quantity: 2,
              unit: 'pcs',
              pcsPrice: 25_000,
              lsnPrice: 300_000,
            },
          ],
        },
      ],
      postedLines: [],
      postedStockEffects: {},
      postedTrackedLineIds: {},
    },
  };
}

function harness() {
  const device = {
    id: DEVICE_ID,
    installationId: '77777777-7777-4777-8777-777777777777',
    role: 'client' as const,
    displayName: 'Android',
    platform: 'android',
    tokenExpiresAt: '2027-01-25T00:00:00.000Z',
    approvedAt: '2026-07-29T00:00:00.000Z',
    revokedAt: null,
    tokenKind: 'current' as const,
  };
  const offline = {
    importNota: vi.fn(async () => ({ serverRevision: '10' })),
    adjustStock: vi.fn(async () => ({ serverRevision: '11' })),
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
    offline,
  });
  return { app, device, offline };
}

const headers = {
  authorization: 'Bearer token',
  'idempotency-key': KEY,
};

describe('offline command HTTP boundary', () => {
  it('accepts one bounded full Nota snapshot under authenticated idempotency', async () => {
    const { app, device, offline } = harness();
    const payload = notaPayload();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/offline/notas',
      headers,
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(offline.importNota).toHaveBeenCalledWith(
      { deviceId: device.id, idempotencyKey: KEY },
      payload,
    );
    await app.close();
  });

  it('accepts a reasoned signed stock delta with its captured SKU snapshot', async () => {
    const { app, device, offline } = harness();
    const payload = {
      skuId: SKU_ID,
      skuIdentifier: 'SKU-001',
      skuName: 'Produk',
      referencePrice: 25_000,
      delta: -3,
      reason: 'Barang rusak',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/offline/stock-adjustments',
      headers,
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(offline.adjustStock).toHaveBeenCalledWith(
      { deviceId: device.id, idempotencyKey: KEY },
      payload,
    );
    await app.close();
  });

  it('rejects mismatched completion and malformed stock commands before service code', async () => {
    const { app, offline } = harness();
    const mismatched = notaPayload();
    mismatched.completed = false;
    const responses = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/offline/notas',
        headers,
        payload: mismatched,
      }),
      app.inject({
        method: 'POST',
        url: '/v1/offline/stock-adjustments',
        headers,
        payload: {
          skuId: SKU_ID,
          skuIdentifier: 'SKU-001',
          skuName: 'Produk',
          referencePrice: 25_000,
          delta: 0,
          reason: '',
        },
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([
      400, 400,
    ]);
    expect(offline.importNota).not.toHaveBeenCalled();
    expect(offline.adjustStock).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('offline command service transaction', () => {
  it('executes the exact full Nota payload behind the shared idempotency lock', async () => {
    const order: string[] = [];
    const connection = {
      beginTransaction: vi.fn(async () => order.push('begin')),
      commit: vi.fn(async () => order.push('commit')),
      rollback: vi.fn(),
      release: vi.fn(),
      query: vi.fn(async <T>(sql: string) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        if (compact.startsWith('INSERT INTO idempotency_receipts')) {
          order.push('receipt');
          return { affectedRows: 1 } as T;
        }
        if (compact.includes('FROM business_write_lock')) {
          order.push('business-lock');
          return [{ singleton_id: 1 }] as T;
        }
        return [] as T;
      }),
    } as unknown as ProtocolConnection;
    const repository = {
      importNota: vi.fn(async () => {
        order.push('repository');
        return {
          statusCode: 201,
          body: { serverRevision: '10' },
          audits: [],
          changes: [],
        };
      }),
    };
    const service = new OfflineOperationsService(
      {
        getConnection: vi.fn(async () => connection),
      } satisfies ProtocolPool,
      repository,
    );
    const payload = notaPayload();

    await service.importNota(
      { deviceId: DEVICE_ID, idempotencyKey: KEY },
      payload,
    );

    expect(repository.importNota).toHaveBeenCalledWith(
      connection,
      DEVICE_ID,
      KEY,
      payload,
    );
    expect(order).toEqual([
      'begin',
      'receipt',
      'business-lock',
      'repository',
      'commit',
    ]);
  });
});
