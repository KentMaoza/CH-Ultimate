import { describe, expect, it, vi } from 'vitest';

import { NotaConflictError, NotaOperationsService } from '../src/nota/service.js';
import type { ProtocolConnection, ProtocolPool } from '../src/sync/idempotency.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const KEY = '22222222-2222-4222-8222-222222222222';
const NOTA_ID = '33333333-3333-4333-8333-333333333333';
const CONFLICT_ID = '44444444-4444-4444-8444-444444444444';

function harness(statusCode = 200) {
  const order: string[] = [];
  const conflict = {
    id: CONFLICT_ID,
    entityType: 'nota',
    entityId: NOTA_ID,
    field: 'customerName',
    base: 'Base',
    mine: 'Mine',
    server: 'Server',
  };
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
    create: vi.fn(async () => {
      order.push('repository');
      return {
        statusCode,
        body:
          statusCode === 409
            ? { code: 'CONFLICT', conflict }
            : { serverRevision: '9' },
        audits: [],
        changes: [],
      };
    }),
  };
  const pool = {
    getConnection: vi.fn(async () => connection),
  } satisfies ProtocolPool;
  return {
    order,
    repository,
    service: new NotaOperationsService(pool, repository),
  };
}

describe('Nota operations service', () => {
  it('acquires the shared lock before a Nota repository mutation', async () => {
    const { order, service } = harness();
    await service.create(
      { deviceId: DEVICE_ID, idempotencyKey: KEY },
      {},
    );
    expect(order).toEqual([
      'begin',
      'receipt',
      'business-lock',
      'repository',
      'commit',
    ]);
  });

  it('commits a durable conflict receipt before returning typed HTTP conflict', async () => {
    const { order, service } = harness(409);
    await expect(
      service.create({ deviceId: DEVICE_ID, idempotencyKey: KEY }, {}),
    ).rejects.toBeInstanceOf(NotaConflictError);
    expect(order.at(-1)).toBe('commit');
  });
});
