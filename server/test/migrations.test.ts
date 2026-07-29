import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  MIGRATION_LOCK_NAME,
  runMigrations,
  splitMariaDbStatements,
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
  releaseConnectionCalls = 0;
  destroyConnectionCalls = 0;
  migrationStatementCount = 0;
  failOn: RegExp | undefined;
  unlockError: Error | undefined;
  unlockResult = 1;

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
          if (this.unlockError) {
            throw this.unlockError;
          }
          this.releaseLockCalls += 1;
          if (this.unlockResult === 1) {
            this.lockHeld = false;
          }
          return [{ released: this.unlockResult }] as T;
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
      release: () => {
        this.releaseConnectionCalls += 1;
      },
      destroy: () => {
        this.destroyConnectionCalls += 1;
        this.lockHeld = false;
      },
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

  it('recovers deterministically after a DDL statement fails mid-migration', async () => {
    const pool = new FakeMigrationPool();
    pool.failOn = /CREATE TABLE IF NOT EXISTS pairings/;

    await expect(runMigrations(pool)).rejects.toThrow(
      'deliberate migration failure',
    );

    expect(pool.applied.size).toBe(0);
    expect(pool.migrationStatementCount).toBeGreaterThan(0);
    expect(pool.lockHeld).toBe(false);
    expect(pool.releaseLockCalls).toBe(1);

    pool.failOn = undefined;
    await expect(runMigrations(pool)).resolves.toEqual({
      fromVersion: 0,
      toVersion: 1,
      appliedVersions: [1],
    });
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

  it('destroys the physical session when unlock returns a non-1 result', async () => {
    const pool = new FakeMigrationPool();
    pool.unlockResult = 0;

    await expect(runMigrations(pool)).rejects.toThrow(
      'Could not confirm release of the CH Core migration lock',
    );

    expect(pool.destroyConnectionCalls).toBe(1);
    expect(pool.releaseConnectionCalls).toBe(0);
    expect(pool.lockHeld).toBe(false);
  });

  it('destroys the physical session when unlock throws', async () => {
    const pool = new FakeMigrationPool();
    pool.unlockError = new Error('connection lost during unlock');

    await expect(runMigrations(pool)).rejects.toThrow(
      'connection lost during unlock',
    );

    expect(pool.destroyConnectionCalls).toBe(1);
    expect(pool.releaseConnectionCalls).toBe(0);
    expect(pool.lockHeld).toBe(false);
  });
});

describe('splitMariaDbStatements', () => {
  it('splits statements separated on the same line', () => {
    expect(
      splitMariaDbStatements(
        'CREATE TABLE one (id INT);CREATE TABLE two (id INT);',
      ),
    ).toEqual([
      'CREATE TABLE one (id INT)',
      'CREATE TABLE two (id INT)',
    ]);
  });

  it('does not split semicolons inside quoted values or comments', () => {
    const statements = splitMariaDbStatements(`
      INSERT INTO notes (body, label) VALUES ('first;
second', "third;fourth");
      -- a semicolon; inside a line comment
      # another; line comment
      /* a block; comment */
      CREATE TABLE \`semi;colon\` (id INT);
    `);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain(`'first;\nsecond'`);
    expect(statements[0]).toContain('"third;fourth"');
    expect(statements[1]).toContain('CREATE TABLE `semi;colon` (id INT)');
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

  it('rejects a Nota line whose page belongs to another Nota', async () => {
    const sql = await readFile(
      new URL('../migrations/001_initial.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toMatch(
      /UNIQUE KEY uq_nota_pages_id_nota \(id, nota_id\)/,
    );
    expect(sql).toMatch(
      /FOREIGN KEY \(page_id, nota_id\) REFERENCES nota_pages \(id, nota_id\)/,
    );
    expect(sql).not.toMatch(
      /FOREIGN KEY \(page_id\) REFERENCES nota_pages \(id\)/,
    );
  });
});
