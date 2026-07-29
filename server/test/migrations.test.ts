import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  MIGRATION_LOCK_NAME,
  runMigrations,
  type MigrationConnection,
  type MigrationPool,
} from '../src/db/migrate.js';

interface AppliedMigration {
  version: number;
  name: string;
  checksum: Buffer;
}

class FakeMigrationPool implements MigrationPool {
  readonly applied = new Map<number, AppliedMigration>();
  lockHeld = false;
  releaseLockCalls = 0;
  migrationStatementCount = 0;
  rollbackCount = 0;
  failOn: RegExp | undefined;

  constructor(version = 0) {
    if (version > 0) {
      this.applied.set(version, {
        version,
        name: `${version.toString().padStart(3, '0')}_future.sql`,
        checksum: Buffer.alloc(32),
      });
    }
  }

  async getConnection(): Promise<MigrationConnection> {
    return {
      query: async <T>(
        sql: string,
        values: readonly unknown[] = [],
      ): Promise<T> => {
        if (sql.startsWith('SELECT GET_LOCK')) {
          if (this.lockHeld) {
            return [{ acquired: 0 }] as T;
          }
          this.lockHeld = true;
          return [{ acquired: 1 }] as T;
        }

        if (sql.startsWith('SELECT RELEASE_LOCK')) {
          this.releaseLockCalls += 1;
          this.lockHeld = false;
          return [{ released: 1 }] as T;
        }

        if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
          return [] as T;
        }

        if (sql.startsWith('SELECT version, name, checksum')) {
          return [...this.applied.values()].sort(
            (left, right) => left.version - right.version,
          ) as T;
        }

        if (sql.startsWith('INSERT INTO schema_migrations')) {
          const version = Number(values[0]);
          this.applied.set(version, {
            version,
            name: String(values[1]),
            checksum: values[2] as Buffer,
          });
          return { affectedRows: 1 } as T;
        }

        if (this.failOn?.test(sql)) {
          throw new Error('deliberate migration failure');
        }

        this.migrationStatementCount += 1;
        return [] as T;
      },
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => {
        this.rollbackCount += 1;
      },
      release: () => undefined,
    };
  }
}

describe('runMigrations', () => {
  it('applies the initial migration once and makes the second run a no-op', async () => {
    const pool = new FakeMigrationPool();

    const first = await runMigrations(pool);
    const statementsAfterFirstRun = pool.migrationStatementCount;
    const second = await runMigrations(pool);

    expect(first).toEqual({
      fromVersion: 0,
      toVersion: 1,
      appliedVersions: [1],
    });
    expect(second).toEqual({
      fromVersion: 1,
      toVersion: 1,
      appliedVersions: [],
    });
    expect(pool.applied.size).toBe(1);
    expect(pool.migrationStatementCount).toBe(statementsAfterFirstRun);
  });

  it('releases the advisory lock when a migration statement fails', async () => {
    const pool = new FakeMigrationPool();
    pool.failOn = /CREATE TABLE IF NOT EXISTS devices/;

    await expect(runMigrations(pool)).rejects.toThrow(
      'deliberate migration failure',
    );

    expect(pool.rollbackCount).toBe(1);
    expect(pool.lockHeld).toBe(false);
    expect(pool.releaseLockCalls).toBe(1);
  });

  it('refuses a database schema newer than this binary and releases the lock', async () => {
    const pool = new FakeMigrationPool(2);

    await expect(runMigrations(pool)).rejects.toThrow(
      'Database schema version 2 is newer than supported version 1',
    );

    expect(pool.lockHeld).toBe(false);
    expect(pool.releaseLockCalls).toBe(1);
  });

  it('uses the dedicated advisory lock name', () => {
    expect(MIGRATION_LOCK_NAME).toBe('ch-core-schema-migrations');
  });
});

describe('initial schema', () => {
  it('declares every foundation table needed by later CH Core slices', async () => {
    const sql = await readFile(
      new URL('../migrations/001_initial.sql', import.meta.url),
      'utf8',
    );
    const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(
      ([, table]) => table,
    );

    expect(tables).toEqual(
      expect.arrayContaining([
        'schema_migrations',
        'devices',
        'pairings',
        'owner_recovery',
        'skus',
        'sku_identifiers',
        'stock_movements',
        'stock_balances',
        'price_history',
        'notas',
        'nota_pages',
        'nota_lines',
        'nota_postings',
        'templates',
        'imports',
        'idempotency_receipts',
        'audit_events',
        'client_cursor_acknowledgements',
        'change_log',
      ]),
    );
  });

  it('uses an ordered MariaDB BIGINT change sequence and UTC timestamps', async () => {
    const sql = await readFile(
      new URL('../migrations/001_initial.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS change_log \(\s*sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT/,
    );
    expect(sql).toContain('TIMESTAMP(6)');
    expect(sql).not.toMatch(/\b(?:TINYINT|INT)\s+UNSIGNED\s+NOT NULL\s+AUTO_INCREMENT\s+PRIMARY KEY,\s+entity_type/);
  });
});
