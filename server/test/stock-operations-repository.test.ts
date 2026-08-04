import { describe, expect, it } from 'vitest';

import { MariaDbStockOperationsRepository } from '../src/catalogue/mariadb-stock-operations-repository.js';
import type { ProtocolConnection } from '../src/sync/idempotency.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const SKU_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';

type Query = { sql: string; values: readonly unknown[] };

function harness(initial = 2) {
  let quantity = initial;
  let version = 4;
  const queries: Query[] = [];
  const connection = {
    async query<T>(sql: string, values: readonly unknown[] = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: compact, values });
      if (compact.includes('FROM skus') && compact.includes('FOR UPDATE')) {
        return [{ id_hex: SKU_ID.replaceAll('-', '') }] as T;
      }
      if (
        compact.includes('FROM stock_balances') &&
        compact.includes('FOR UPDATE')
      ) {
        return [{ quantity_pcs: quantity, row_version: version }] as T;
      }
      if (compact.startsWith('UPDATE stock_balances')) {
        quantity += Number(values[0]);
        version += 1;
        return { affectedRows: 1 } as T;
      }
      if (compact.startsWith('INSERT INTO change_log')) {
        return { insertId: 31n } as T;
      }
      return [] as T;
    },
  } as Pick<ProtocolConnection, 'query'>;
  return {
    connection,
    queries,
    state: () => ({ quantity, version }),
  };
}

describe('MariaDB authoritative stock repository', () => {
  it('applies a signed delta under row locks and permits a negative result', async () => {
    const test = harness(2);
    const repository = new MariaDbStockOperationsRepository({
      now: () => new Date('2026-07-30T03:00:00.000Z'),
    });

    const result = await repository.adjust(
      test.connection,
      DEVICE_ID,
      OPERATION_ID,
      SKU_ID,
      { delta: -5 },
    );

    expect(test.state()).toEqual({ quantity: -3, version: 5 });
    expect(result.body).toEqual({
      serverRevision: '31',
      entityVersion: '5',
      entity: {
        skuId: SKU_ID,
        quantityPcs: '-3',
        rowVersion: '5',
        updatedAt: '2026-07-30T03:00:00.000Z',
      },
    });
    expect(
      test.queries.filter(({ sql }) => sql.includes('FOR UPDATE')),
    ).toHaveLength(2);
  });

  it('records one immutable movement linked to the idempotency operation', async () => {
    const test = harness();
    const repository = new MariaDbStockOperationsRepository();

    await repository.adjust(
      test.connection,
      DEVICE_ID,
      OPERATION_ID,
      SKU_ID,
      { delta: 6 },
    );

    const movement = test.queries.find(({ sql }) =>
      sql.startsWith('INSERT INTO stock_movements'),
    );
    expect(movement?.values).toEqual(
      expect.arrayContaining([SKU_ID, 6, DEVICE_ID, OPERATION_ID, 5n]),
    );
    expect(movement?.sql).toContain('balance_row_version_after');
    expect(
      test.queries.some(({ sql }) => sql.startsWith('DELETE FROM stock_movements')),
    ).toBe(false);
  });

  it('allows two sequentially locked deltas to accumulate without replacement writes', async () => {
    const test = harness(10);
    const repository = new MariaDbStockOperationsRepository();

    await repository.adjust(
      test.connection,
      DEVICE_ID,
      OPERATION_ID,
      SKU_ID,
      { delta: 3 },
    );
    await repository.adjust(
      test.connection,
      DEVICE_ID,
      '44444444-4444-4444-8444-444444444444',
      SKU_ID,
      { delta: -4 },
    );

    expect(test.state().quantity).toBe(9);
    const updates = test.queries.filter(({ sql }) =>
      sql.startsWith('UPDATE stock_balances'),
    );
    expect(updates).toHaveLength(2);
    expect(updates.every(({ sql }) => sql.includes('quantity_pcs + ?'))).toBe(
      true,
    );
  });

  it('rejects archived or missing SKUs before touching the balance', async () => {
    const queries: string[] = [];
    const connection = {
      async query<T>(sql: string) {
        queries.push(sql.replace(/\s+/g, ' ').trim());
        return [] as T;
      },
    } as Pick<ProtocolConnection, 'query'>;
    const repository = new MariaDbStockOperationsRepository();

    await expect(
      repository.adjust(
        connection,
        DEVICE_ID,
        OPERATION_ID,
        SKU_ID,
        { delta: 1 },
      ),
    ).rejects.toMatchObject({ code: 'SKU_NOT_ACTIVE', statusCode: 409 });
    expect(queries.some((sql) => sql.includes('stock_balances'))).toBe(false);
  });
});
