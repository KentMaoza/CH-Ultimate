import { describe, expect, it, vi } from 'vitest';

import { CatalogueOperationsService } from '../src/catalogue/operations-service.js';
import type { ProtocolConnection, ProtocolPool } from '../src/sync/idempotency.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const KEY = '22222222-2222-4222-8222-222222222222';
const SKU_ID = '33333333-3333-4333-8333-333333333333';

function harness() {
  const order: string[] = [];
  const connection = {
    beginTransaction: vi.fn(async () => order.push('begin')),
    commit: vi.fn(async () => order.push('commit')),
    rollback: vi.fn(),
    release: vi.fn(),
    query: vi.fn(async <T>(sql: string) => {
      const compact = sql.replace(/\s+/g, ' ').trim();
      if (compact.startsWith('DELETE FROM idempotency_receipts')) return [] as T;
      if (compact.startsWith('INSERT INTO idempotency_receipts')) {
        order.push('receipt');
        return { affectedRows: 1 } as T;
      }
      if (compact.includes('FROM business_write_lock')) {
        order.push('business-lock');
        return [{ singleton_id: 1 }] as T;
      }
      if (compact.startsWith('UPDATE idempotency_receipts')) return [] as T;
      return [] as T;
    }),
  } as unknown as ProtocolConnection;
  const pool = {
    getConnection: vi.fn(async () => connection),
  } satisfies ProtocolPool;
  const mutation = {
    statusCode: 200,
    body: { serverRevision: '9' },
    audits: [],
    changes: [],
  };
  const sku = {
    create: vi.fn(async () => {
      order.push('repository');
      return { ...mutation, statusCode: 201 };
    }),
    update: vi.fn(async () => {
      order.push('repository');
      return mutation;
    }),
  };
  const stock = {
    adjust: vi.fn(async () => {
      order.push('repository');
      return mutation;
    }),
  };
  const templates = {
    update: vi.fn(async () => {
      order.push('repository');
      return mutation;
    }),
  };
  const service = new CatalogueOperationsService(pool, {
    sku,
    stock,
    templates,
  });
  return { order, service, sku, stock, templates };
}

describe('catalogue operations service', () => {
  it('acquires the shared business lock before the first repository access', async () => {
    const { order, service } = harness();

    await service.adjustStock(
      { deviceId: DEVICE_ID, idempotencyKey: KEY },
      SKU_ID,
      { delta: 2 },
    );

    expect(order).toEqual([
      'begin',
      'receipt',
      'business-lock',
      'repository',
      'commit',
    ]);
  });

  it('binds the full command payload and operation UUID to the durable receipt', async () => {
    const { service, stock } = harness();

    await service.adjustStock(
      { deviceId: DEVICE_ID, idempotencyKey: KEY },
      SKU_ID,
      { delta: -3 },
    );

    expect(stock.adjust).toHaveBeenCalledWith(
      expect.anything(),
      DEVICE_ID,
      KEY,
      SKU_ID,
      { delta: -3 },
    );
  });
});
