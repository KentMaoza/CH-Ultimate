import { randomUUID } from 'node:crypto';

import type { PoolConnection } from 'mariadb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadServerConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';

const databaseUrl = process.env.CH_CORE_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'CH_CORE_TEST_DATABASE_URL must point to an explicitly isolated chu_test database',
  );
}

const parsedDatabaseUrl = new URL(databaseUrl);
if (parsedDatabaseUrl.pathname !== '/chu_test') {
  throw new Error('Integration tests refuse any database except chu_test');
}

const pool = createPool(
  loadServerConfig({ CH_CORE_DATABASE_URL: databaseUrl }),
);

const tables = [
  'change_log',
  'client_cursor_acknowledgements',
  'audit_events',
  'idempotency_receipts',
  'imports',
  'templates',
  'nota_postings',
  'nota_lines',
  'nota_pages',
  'notas',
  'price_history',
  'stock_balances',
  'stock_movements',
  'sku_identifiers',
  'skus',
  'owner_recovery',
  'pairings',
  'devices',
  'schema_migrations',
];

async function resetIsolatedSchema(): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of tables) {
      await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
    }
  } finally {
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    connection.release();
  }
}

describe('MariaDB migrations against isolated chu_test', () => {
  beforeAll(resetIsolatedSchema);

  afterAll(async () => {
    await pool.end();
  });

  it('applies once, is a no-op on the second run, and releases its lock', async () => {
    const first = await runMigrations(pool);
    const second = await runMigrations(pool);
    const rows = await pool.query<Array<{ migration_count: bigint }>>(
      'SELECT COUNT(*) AS migration_count FROM schema_migrations',
    );
    const lockRows = await pool.query<Array<{ is_free: number }>>(
      'SELECT IS_FREE_LOCK(?) AS is_free',
      ['ch-core-schema-migrations'],
    );

    expect(first.appliedVersions).toEqual([1]);
    expect(second.appliedVersions).toEqual([]);
    expect(Number(rows[0]?.migration_count)).toBe(1);
    expect(Number(lockRows[0]?.is_free)).toBe(1);
  });

  it('rolls back a deliberately failing transaction without partial rows', async () => {
    const deviceId = randomUUID().replaceAll('-', '');
    let connection: PoolConnection | undefined;
    let insertedBeforeFailure = false;
    let transactionError: unknown;

    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      await connection.query(
        `INSERT INTO devices (id, display_name, platform, token_hash, token_expires_at)
         VALUES (UNHEX(?), ?, ?, UNHEX(SHA2(?, 256)), UTC_TIMESTAMP(6))`,
        [deviceId, 'Rollback probe', 'test', 'temporary-token'],
      );
      insertedBeforeFailure = true;
      await connection.query('INSERT INTO table_that_does_not_exist VALUES (1)');
      await connection.commit();
    } catch (error) {
      transactionError = error;
      await connection?.rollback();
    } finally {
      connection?.release();
    }

    const rows = await pool.query<Array<{ device_count: bigint }>>(
      'SELECT COUNT(*) AS device_count FROM devices WHERE id = UNHEX(?)',
      [deviceId],
    );
    expect(insertedBeforeFailure).toBe(true);
    expect(transactionError).toBeInstanceOf(Error);
    expect(Number(rows[0]?.device_count)).toBe(0);
  });
});
