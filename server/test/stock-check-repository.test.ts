import { describe, expect, it } from 'vitest';

import { MariaDbStockCheckRepository } from '../src/stock-check/mariadb-repository.js';
import type { ProtocolConnection } from '../src/sync/idempotency.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const SKU_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';
const CHECK_ID = '44444444-4444-4444-8444-444444444444';
const MOVEMENT_ID = '55555555-5555-4555-8555-555555555555';
const COUNTED_AT = '2026-08-04T01:10:00.000Z';
const APPLIED_AT = new Date('2026-08-04T01:15:00.000Z');

type Query = { sql: string; values: readonly unknown[] };

function harness(options: { quantity?: bigint; version?: bigint; archived?: boolean } = {}) {
  let quantity = options.quantity ?? 7n;
  let version = options.version ?? 4n;
  const queries: Query[] = [];
  let nextRevision = 40n;
  const connection = {
    async query<T>(sql: string, values: readonly unknown[] = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: compact, values });
      if (compact.includes('FROM skus') && compact.includes('FOR UPDATE')) {
        return options.archived
          ? [] as T
          : [{ id_hex: SKU_ID.replaceAll('-', '') }] as T;
      }
      if (compact.includes('FROM stock_balances') && compact.includes('FOR UPDATE')) {
        return [{ quantity_pcs: quantity, row_version: version }] as T;
      }
      if (compact.startsWith('UPDATE stock_balances')) {
        quantity = BigInt(String(values[0]));
        version += 1n;
        return { affectedRows: 1 } as T;
      }
      if (compact.startsWith('INSERT INTO change_log')) {
        nextRevision += 1n;
        return { insertId: nextRevision } as T;
      }
      return [] as T;
    },
  } as Pick<ProtocolConnection, 'query'>;
  const ids = [CHECK_ID, MOVEMENT_ID];
  const repository = new MariaDbStockCheckRepository({
    now: () => APPLIED_AT,
    uuid: () => ids.shift() ?? '66666666-6666-4666-8666-666666666666',
  });
  return { connection, queries, repository, state: () => ({ quantity, version }) };
}

describe('MariaDB stock-check repository', () => {
  it('forces captured offline 10 to 8 over server 7 and records the complete audit', async () => {
    const test = harness();

    const result = await test.repository.apply(
      test.connection,
      { deviceId: DEVICE_ID, deviceDisplayName: 'HP Gudang' },
      OPERATION_ID,
      {
        skuId: SKU_ID,
        observedQuantityPcs: 10,
        countedQuantityPcs: 8,
        baseBalanceVersion: '3',
        countedAt: COUNTED_AT,
        note: '  Rak utara  ',
      },
      true,
    );

    expect(test.state()).toEqual({ quantity: 8n, version: 5n });
    expect(result.body).toMatchObject({
      apiSchemaVersion: 2,
      entityVersion: '5',
      entity: {
        id: CHECK_ID,
        skuId: SKU_ID,
        observedQuantityPcs: '10',
        countedQuantityPcs: '8',
        serverQuantityBeforePcs: '7',
        appliedDeltaPcs: '1',
        baseBalanceVersion: '3',
        forcedOffline: true,
        countedAt: COUNTED_AT,
        appliedAt: APPLIED_AT.toISOString(),
        deviceId: DEVICE_ID,
        deviceDisplayName: 'HP Gudang',
        note: 'Rak utara',
      },
    });
    const movement = test.queries.find(({ sql }) =>
      sql.startsWith('INSERT INTO stock_movements'),
    );
    expect(movement?.values).toEqual(
      expect.arrayContaining([MOVEMENT_ID, SKU_ID, 1n, DEVICE_ID, OPERATION_ID, 5n]),
    );
  });

  it('rejects an online count when the observed quantity or base version is stale', async () => {
    const test = harness();

    await expect(
      test.repository.apply(
        test.connection,
        { deviceId: DEVICE_ID, deviceDisplayName: 'Owner Mac' },
        OPERATION_ID,
        {
          skuId: SKU_ID,
          observedQuantityPcs: 10,
          countedQuantityPcs: 8,
          baseBalanceVersion: '3',
          countedAt: COUNTED_AT,
        },
        false,
      ),
    ).rejects.toMatchObject({ code: 'STOCK_CHECK_STALE', statusCode: 409 });
    expect(test.queries.some(({ sql }) => sql.startsWith('UPDATE stock_balances'))).toBe(false);
  });

  it('records unchanged online counts and a new version without a zero movement', async () => {
    const test = harness();

    const result = await test.repository.apply(
      test.connection,
      { deviceId: DEVICE_ID, deviceDisplayName: 'Owner Mac' },
      OPERATION_ID,
      {
        skuId: SKU_ID,
        observedQuantityPcs: 7,
        countedQuantityPcs: 7,
        baseBalanceVersion: '4',
        countedAt: COUNTED_AT,
      },
      false,
    );

    expect(test.state()).toEqual({ quantity: 7n, version: 5n });
    expect(test.queries.some(({ sql }) => sql.startsWith('INSERT INTO stock_checks'))).toBe(true);
    expect(test.queries.some(({ sql }) => sql.startsWith('INSERT INTO stock_movements'))).toBe(false);
    expect(result.body).toMatchObject({ entityVersion: '5', entity: { appliedDeltaPcs: '0' } });
  });

  it('rejects archived SKU before locking or changing its balance', async () => {
    const test = harness({ archived: true });

    await expect(
      test.repository.apply(
        test.connection,
        { deviceId: DEVICE_ID, deviceDisplayName: 'Owner Mac' },
        OPERATION_ID,
        {
          skuId: SKU_ID,
          observedQuantityPcs: 7,
          countedQuantityPcs: 7,
          baseBalanceVersion: '4',
          countedAt: COUNTED_AT,
        },
        false,
      ),
    ).rejects.toMatchObject({ code: 'SKU_NOT_ACTIVE', statusCode: 409 });
    expect(test.queries.some(({ sql }) => sql.includes('FROM stock_balances'))).toBe(false);
  });

  it('rejects an applied delta that cannot cross the client safe-integer boundary', async () => {
    const test = harness({ quantity: BigInt(Number.MIN_SAFE_INTEGER) });

    await expect(
      test.repository.apply(
        test.connection,
        { deviceId: DEVICE_ID, deviceDisplayName: 'HP Gudang' },
        OPERATION_ID,
        {
          skuId: SKU_ID,
          observedQuantityPcs: Number.MIN_SAFE_INTEGER,
          countedQuantityPcs: Number.MAX_SAFE_INTEGER,
          countedAt: COUNTED_AT,
        },
        true,
      ),
    ).rejects.toMatchObject({ code: 'STOCK_OUT_OF_RANGE', statusCode: 422 });
    expect(test.queries.some(({ sql }) => sql.startsWith('UPDATE stock_balances'))).toBe(false);
  });
});
