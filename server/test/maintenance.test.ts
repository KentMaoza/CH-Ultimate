import { describe, expect, it, vi } from 'vitest';

import { ProtocolMaintenance } from '../src/maintenance.js';
import type {
  ProtocolConnection,
  ProtocolPool,
} from '../src/sync/idempotency.js';

function createPool(acquired = 1) {
  const events: string[] = [];
  const connection: ProtocolConnection = {
    beginTransaction: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
    release: () => {
      events.push('release');
    },
    query: async <T>(sql: string): Promise<T> => {
      const compact = sql.replace(/\s+/g, ' ').trim();
      events.push(compact);
      if (sql.startsWith('SELECT GET_LOCK')) {
        return [{ acquired }] as T;
      }
      if (sql.startsWith('DELETE FROM change_log')) {
        return { affectedRows: 12 } as T;
      }
      if (sql.startsWith('DELETE FROM idempotency_receipts')) {
        return { affectedRows: 5 } as T;
      }
      if (sql.startsWith('SELECT RELEASE_LOCK')) {
        return [{ released: 1 }] as T;
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const pool: ProtocolPool = {
    getConnection: async () => connection,
  };
  return { pool, events };
}

describe('ProtocolMaintenance', () => {
  it('prunes changes and expired receipts under one advisory lock', async () => {
    const { pool, events } = createPool();
    const maintenance = new ProtocolMaintenance(pool);

    await expect(maintenance.runOnce()).resolves.toEqual({
      changes: 12,
      receipts: 5,
    });

    expect(events[0]).toContain('GET_LOCK');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.stringContaining('DELETE FROM change_log'),
        expect.stringContaining('INTERVAL 180 DAY'),
        expect.stringContaining('OFFSET 249999'),
        expect.stringContaining('DELETE FROM idempotency_receipts'),
        expect.stringContaining('expires_at <= UTC_TIMESTAMP(6)'),
        expect.stringContaining('RELEASE_LOCK'),
      ]),
    );
    expect(events.at(-1)).toBe('release');
  });

  it('skips pruning when another process owns the maintenance lock', async () => {
    const { pool, events } = createPool(0);
    const maintenance = new ProtocolMaintenance(pool);

    await expect(maintenance.runOnce()).resolves.toBeNull();

    expect(events).not.toEqual(
      expect.arrayContaining([expect.stringContaining('DELETE FROM')]),
    );
    expect(events.at(-1)).toBe('release');
  });

  it('starts one unref interval and clears it on stop', () => {
    const { pool } = createPool();
    const unref = vi.fn();
    const handle = { unref };
    const schedule = vi.fn(() => handle);
    const clear = vi.fn();
    const maintenance = new ProtocolMaintenance(pool, {
      intervalMs: 60_000,
      schedule,
      clear,
    });

    maintenance.start();
    maintenance.start();
    maintenance.stop();

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(unref).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledWith(handle);
  });
});
