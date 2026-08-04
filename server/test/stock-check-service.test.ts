import { describe, expect, it, vi } from 'vitest';

import { StockCheckService } from '../src/stock-check/service.js';
import type { ProtocolConnection, ProtocolPool } from '../src/sync/idempotency.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const KEY = '22222222-2222-4222-8222-222222222222';
const SKU_ID = '33333333-3333-4333-8333-333333333333';

describe('stock-check service', () => {
  it('runs the repository inside the shared idempotent transaction', async () => {
    const order: string[] = [];
    const connection = {
      beginTransaction: vi.fn(async () => order.push('begin')),
      commit: vi.fn(async () => order.push('commit')),
      rollback: vi.fn(),
      release: vi.fn(),
      query: vi.fn(async <T>(sql: string) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        if (compact.startsWith('INSERT INTO idempotency_receipts')) order.push('receipt');
        if (compact.includes('FROM business_write_lock')) {
          order.push('business-lock');
          return [{ singleton_id: 1 }] as T;
        }
        return [] as T;
      }),
    } as unknown as ProtocolConnection;
    const pool = { getConnection: vi.fn(async () => connection) } satisfies ProtocolPool;
    const repository = {
      apply: vi.fn(async () => {
        order.push('repository');
        return {
          statusCode: 200,
          body: { apiSchemaVersion: 2, serverRevision: '9' },
          audits: [],
          changes: [],
        };
      }),
    };
    const service = new StockCheckService(pool, repository);

    await service.checkOnline(
      { deviceId: DEVICE_ID, deviceDisplayName: 'Owner Mac', idempotencyKey: KEY },
      SKU_ID,
      {
        observedQuantityPcs: 7,
        countedQuantityPcs: 8,
        baseBalanceVersion: '4',
        countedAt: '2026-08-04T01:10:00.000Z',
      },
    );

    expect(order).toEqual(['begin', 'receipt', 'business-lock', 'repository', 'commit']);
    expect(repository.apply).toHaveBeenCalledWith(
      connection,
      { deviceId: DEVICE_ID, deviceDisplayName: 'Owner Mac' },
      KEY,
      expect.objectContaining({ skuId: SKU_ID, countedQuantityPcs: 8 }),
      false,
    );
  });
});
