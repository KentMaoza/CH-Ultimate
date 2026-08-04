import { describe, expect, it } from 'vitest';

import { writeNotaPosting } from '../src/nota/mariadb-posting-store.js';
import type { ProtocolConnection } from '../src/sync/idempotency.js';

describe('MariaDB Nota posting arithmetic preflight', () => {
  it('links each Nota movement to the resulting balance row version', async () => {
    let revision = 0n;
    let movementValues: readonly unknown[] | undefined;
    const connection = {
      query: async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        if (compact.includes('FROM stock_balances')) {
          return [{ quantity_pcs: 10n, row_version: 3n }] as T;
        }
        if (compact.startsWith('INSERT INTO stock_movements')) {
          movementValues = values;
        }
        if (compact.startsWith('INSERT INTO change_log')) {
          revision += 1n;
          return { insertId: revision } as T;
        }
        return [] as T;
      },
    } as Pick<ProtocolConnection, 'query'>;
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ];
    const skuId = '44444444-4444-4444-8444-444444444444';

    await writeNotaPosting(connection, () => ids.shift()!, {
      deviceId: '55555555-5555-4555-8555-555555555555',
      operationId: '66666666-6666-4666-8666-666666666666',
      notaId: '77777777-7777-4777-8777-777777777777',
      kind: 'complete',
      amount: 0n,
      snapshotLines: [],
      snapshotEffects: new Map([[skuId, -2n]]),
      trackedLineIds: {},
      movementEffects: new Map([[skuId, -2n]]),
      revenueDelta: 0n,
      lifecycleVersion: '2',
      now: new Date('2026-08-04T00:00:00.000Z'),
    });

    expect(movementValues).toEqual(expect.arrayContaining([skuId, -2n, 4n]));
  });

  it('rejects a resulting balance overflow before any insert or update', async () => {
    const writes: string[] = [];
    const connection = {
      query: async <T>(sql: string): Promise<T> => {
        if (/^\s*(INSERT|UPDATE)/.test(sql)) writes.push(sql);
        if (sql.includes('FROM stock_balances')) {
          return [{
            quantity_pcs: BigInt(Number.MAX_SAFE_INTEGER),
            row_version: 1n,
          }] as T;
        }
        return [] as T;
      },
    } as Pick<ProtocolConnection, 'query'>;

    await expect(
      writeNotaPosting(
        connection,
        () => '11111111-1111-4111-8111-111111111111',
        {
          deviceId: '22222222-2222-4222-8222-222222222222',
          operationId: '33333333-3333-4333-8333-333333333333',
          notaId: '44444444-4444-4444-8444-444444444444',
          kind: 'complete',
          amount: 0n,
          snapshotLines: [],
          snapshotEffects: new Map(),
          trackedLineIds: {},
          movementEffects: new Map([
            ['55555555-5555-4555-8555-555555555555', 1n],
          ]),
          revenueDelta: 0n,
          lifecycleVersion: '2',
          now: new Date('2026-07-30T00:00:00.000Z'),
        },
      ),
    ).rejects.toThrow('stock balance');
    expect(writes).toEqual([]);
  });
});
