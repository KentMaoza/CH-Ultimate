import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { PoolConnection } from 'mariadb';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadServerConfig } from '../src/config.js';
import {
  runMigrations,
  splitMariaDbStatements,
  type MigrationConnection,
  type MigrationPool,
} from '../src/db/migrate.js';
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
const originalVersionOneChecksum =
  'e22cfbbf1af7b72e0091c9bf8a399ac2570fc6f971723330d085d0954cf68b69';

const tables = [
  'change_log',
  'business_write_lock',
  'client_cursor_acknowledgements',
  'audit_events',
  'idempotency_receipts',
  'nota_conflicts',
  'revenue_postings',
  'nota_daily_sequences',
  'image_jobs',
  'image_assets',
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
    await connection.release();
  }
}

async function applyOriginalVersionOne(): Promise<void> {
  const sql = await readFile(
    new URL('../migrations/001_initial.sql', import.meta.url),
    'utf8',
  );
  const checksum = createHash('sha256').update(sql).digest('hex');
  if (checksum !== originalVersionOneChecksum) {
    throw new Error('Version 1 migration bytes do not match the published checksum');
  }

  const connection = await pool.getConnection();
  try {
    for (const statement of splitMariaDbStatements(sql)) {
      await connection.query(statement);
    }
    await connection.query(
      `INSERT INTO schema_migrations (version, name, checksum)
       VALUES (1, '001_initial.sql', UNHEX(?))`,
      [originalVersionOneChecksum],
    );
  } finally {
    await connection.release();
  }
}

function interruptMigrationOnce(sqlFragment: string): MigrationPool {
  let interrupted = false;

  return {
    async getConnection(): Promise<MigrationConnection> {
      const connection = await pool.getConnection();
      return {
        query: async <T>(
          sql: string,
          values: readonly unknown[] = [],
        ): Promise<T> => {
          if (
            !interrupted &&
            sql.includes(sqlFragment)
          ) {
            interrupted = true;
            throw new Error('deliberate mid-migration interruption');
          }
          return connection.query<T, readonly unknown[]>(sql, values);
        },
        release: () => connection.release(),
        destroy: () => connection.destroy(),
      };
    },
  };
}

describe('MariaDB migrations against isolated chu_test', () => {
  beforeEach(resetIsolatedSchema);

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

    expect(first.appliedVersions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(second.appliedVersions).toEqual([]);
    expect(Number(rows[0]?.migration_count)).toBe(9);
    expect(Number(lockRows[0]?.is_free)).toBe(1);
  });

  it('reruns to completion after real DDL commits before an interruption', async () => {
    await expect(
      runMigrations(
        interruptMigrationOnce('CREATE TABLE IF NOT EXISTS pairings'),
      ),
    ).rejects.toThrow('deliberate mid-migration interruption');

    const partialTables = await pool.query<Array<{ table_count: bigint }>>(
      `SELECT COUNT(*) AS table_count
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'devices'`,
    );
    const partialReceipts = await pool.query<
      Array<{ migration_count: bigint }>
    >('SELECT COUNT(*) AS migration_count FROM schema_migrations');

    expect(Number(partialTables[0]?.table_count)).toBe(1);
    expect(Number(partialReceipts[0]?.migration_count)).toBe(0);

    const recovered = await runMigrations(pool);
    const finalTables = await pool.query<Array<{ table_count: bigint }>>(
      `SELECT COUNT(*) AS table_count
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'change_log'`,
    );
    const finalReceipts = await pool.query<Array<{ migration_count: bigint }>>(
      'SELECT COUNT(*) AS migration_count FROM schema_migrations',
    );

    expect(recovered.appliedVersions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(Number(finalTables[0]?.table_count)).toBe(1);
    expect(Number(finalReceipts[0]?.migration_count)).toBe(9);
  });

  it('reruns version 2 after its first real ALTER TABLE committed', async () => {
    await applyOriginalVersionOne();

    await expect(
      runMigrations(interruptMigrationOnce('ALTER TABLE nota_lines')),
    ).rejects.toThrow('deliberate mid-migration interruption');

    const partialReceipts = await pool.query<
      Array<{ migration_count: bigint }>
    >('SELECT COUNT(*) AS migration_count FROM schema_migrations');
    expect(Number(partialReceipts[0]?.migration_count)).toBe(1);

    await expect(runMigrations(pool)).resolves.toEqual({
      fromVersion: 1,
      toVersion: 9,
      appliedVersions: [2, 3, 4, 5, 6, 7, 8, 9],
    });
  });

  it('rolls back a deliberately failing transaction without partial rows', async () => {
    await runMigrations(pool);
    const deviceId = randomUUID().replaceAll('-', '');
    let connection: PoolConnection | undefined;
    let insertedBeforeFailure = false;
    let transactionError: unknown;

    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      await connection.query(
        `INSERT INTO devices
           (id, installation_id, display_name, platform, token_hash,
            token_expires_at)
         VALUES
           (UNHEX(?), UNHEX(?), ?, ?, UNHEX(SHA2(?, 256)),
            UTC_TIMESTAMP(6))`,
        [deviceId, deviceId, 'Rollback probe', 'test', 'temporary-token'],
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

  it('rejects pre-existing active template duplicates before recording v7', async () => {
    await applyOriginalVersionOne();
    const firstId = randomUUID().replaceAll('-', '');
    const secondId = randomUUID().replaceAll('-', '');
    await pool.query(
      `INSERT INTO templates
         (id, template_kind, name, definition_json)
       VALUES
         (UNHEX(?), 'label', 'First', JSON_OBJECT()),
         (UNHEX(?), 'label', 'Second', JSON_OBJECT())`,
      [firstId, secondId],
    );

    await expect(runMigrations(pool)).rejects.toThrow();
    const partial = await pool.query<
      Array<{ latest_version: bigint; active_count: bigint }>
    >(
      `SELECT
         (SELECT MAX(version) FROM schema_migrations) AS latest_version,
         (SELECT COUNT(*) FROM templates
          WHERE template_kind = 'label' AND archived_at IS NULL)
           AS active_count`,
    );
    expect(Number(partial[0]?.latest_version)).toBe(6);
    expect(Number(partial[0]?.active_count)).toBe(2);

    await pool.query(
      'UPDATE templates SET archived_at = UTC_TIMESTAMP(6) WHERE id = UNHEX(?)',
      [secondId],
    );
    await expect(runMigrations(pool)).resolves.toEqual({
      fromVersion: 6,
      toVersion: 9,
      appliedVersions: [7, 8, 9],
    });
  });

  it('upgrades an original v1 schema through v9 and rejects a cross-Nota line', async () => {
    await applyOriginalVersionOne();
    await expect(runMigrations(pool)).resolves.toEqual({
      fromVersion: 1,
      toVersion: 9,
      appliedVersions: [2, 3, 4, 5, 6, 7, 8, 9],
    });
    const deviceId = randomUUID().replaceAll('-', '');
    const notaAId = randomUUID().replaceAll('-', '');
    const notaBId = randomUUID().replaceAll('-', '');
    const pageAId = randomUUID().replaceAll('-', '');
    const lineId = randomUUID().replaceAll('-', '');

    await pool.query(
      `INSERT INTO devices
         (id, installation_id, display_name, platform, token_hash,
          token_expires_at)
       VALUES
         (UNHEX(?), UNHEX(?), 'Constraint probe', 'test',
          UNHEX(SHA2(?, 256)), DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))`,
      [deviceId, deviceId, randomUUID()],
    );
    await pool.query(
      `INSERT INTO notas
         (id, nota_number, business_date, status, header_json, field_versions,
          created_by_device_id)
       VALUES
         (UNHEX(?), 'TEST-A', UTC_DATE(), 'draft', JSON_OBJECT(), JSON_OBJECT(),
          UNHEX(?)),
         (UNHEX(?), 'TEST-B', UTC_DATE(), 'draft', JSON_OBJECT(), JSON_OBJECT(),
          UNHEX(?))`,
      [notaAId, deviceId, notaBId, deviceId],
    );
    await pool.query(
      `INSERT INTO nota_pages (id, nota_id, page_position)
       VALUES (UNHEX(?), UNHEX(?), 1)`,
      [pageAId, notaAId],
    );

    await expect(
      pool.query(
        `INSERT INTO nota_lines
           (id, nota_id, page_id, line_position, sku_identifier_snapshot,
            sku_name_snapshot, quantity_pcs, unit_price_rupiah,
            line_total_rupiah)
         VALUES
           (UNHEX(?), UNHEX(?), UNHEX(?), 1, 'TEST-SKU', 'Test SKU', 1, 1000,
            1000)`,
        [lineId, notaBId, pageAId],
      ),
    ).rejects.toThrow();

    const rows = await pool.query<Array<{ line_count: bigint }>>(
      'SELECT COUNT(*) AS line_count FROM nota_lines WHERE id = UNHEX(?)',
      [lineId],
    );
    expect(Number(rows[0]?.line_count)).toBe(0);
  });
});
