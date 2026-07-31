import { describe, expect, it } from 'vitest';

import { MariaDbSyncStore } from '../src/sync/mariadb-sync-store.js';
import type {
  ProtocolConnection,
  ProtocolPool,
} from '../src/sync/idempotency.js';

function createPool() {
  const events: string[] = [];
  const connection: ProtocolConnection = {
    beginTransaction: async () => {
      throw new Error('consistent reads must use explicit snapshot SQL');
    },
    commit: async () => {
      events.push('commit');
    },
    rollback: async () => {
      events.push('rollback');
    },
    release: () => {
      events.push('release');
    },
    query: async <T>(
      sql: string,
      values: readonly unknown[] = [],
    ): Promise<T> => {
      const compact = sql.replace(/\s+/g, ' ').trim();
      events.push(compact);
      if (sql.includes('MAX(sequence)')) {
        return [{ watermark: 7n }] as T;
      }
      if (sql.includes('MIN(sequence) AS minimum_revision')) {
        return [{ minimum_revision: 3n }] as T;
      }
      if (sql.includes('FROM change_log') && sql.includes('payload_json')) {
        expect(values).toEqual(['2', '7', 5]);
        return [
          {
            revision: 3n,
            entity_type: 'sku',
            entity_id_hex: '11111111111141118111111111111111',
            operation: 'upsert',
            payload_json: '{"priceRupiah":"25000"}',
            created_at: new Date('2026-07-29T00:00:00.000Z'),
          },
        ] as T;
      }
      if (sql.startsWith('DELETE FROM change_log')) {
        return { affectedRows: 12 } as T;
      }
      return [] as T;
    },
  };
  const pool: ProtocolPool = {
    getConnection: async () => connection,
  };
  return { pool, events };
}

describe('MariaDbSyncStore', () => {
  it('reads watermark and changes on one repeatable read-only snapshot', async () => {
    const { pool, events } = createPool();
    const store = new MariaDbSyncStore(pool);

    const result = await store.readConsistent(async (session) => ({
      watermark: await session.getWatermark(),
      minimum: await session.getMinimumRevision(),
      changes: await session.getChanges(2n, 7n, 5),
    }));

    expect(result).toEqual({
      watermark: 7n,
      minimum: 3n,
      changes: [
        {
          revision: 3n,
          entityType: 'sku',
          entityId: '11111111-1111-4111-8111-111111111111',
          operation: 'upsert',
          payload: { priceRupiah: '25000' },
          createdAt: new Date('2026-07-29T00:00:00.000Z'),
        },
      ],
    });
    expect(events.slice(0, 2)).toEqual([
      'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
      'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY',
    ]);
    expect(events.at(-2)).toBe('commit');
    expect(events.at(-1)).toBe('release');
  });

  it('prunes only rows older than 180 days and outside the newest 250000', async () => {
    const { pool, events } = createPool();
    const store = new MariaDbSyncStore(pool);

    await expect(store.pruneRetainedChanges()).resolves.toBe(12);

    const deletion = events.find((event) =>
      event.startsWith('DELETE FROM change_log'),
    );
    expect(deletion).toContain('INTERVAL 180 DAY');
    expect(deletion).toContain('OFFSET 249999');
  });
});
