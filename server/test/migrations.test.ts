import { createHash } from 'node:crypto';
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

const ORIGINAL_V1_CHECKSUM =
  'e22cfbbf1af7b72e0091c9bf8a399ac2570fc6f971723330d085d0954cf68b69';
const ORIGINAL_V2_CHECKSUM =
  '39fd3afbe56aef8fa4b5c317753622998f73877925f1eed24996686721f17923';
const ORIGINAL_V3_CHECKSUM =
  'cb1ab6f8382317cf9e3abfde5f9f4edf6883eea75f06cc0c6b1d4ac54dbde581';

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

function seedOriginalVersionOne(pool: FakeMigrationPool): void {
  pool.applied.set(1, {
    version: 1,
    name: '001_initial.sql',
    checksum: Buffer.from(ORIGINAL_V1_CHECKSUM, 'hex'),
  });
}

function seedOriginalVersionTwo(pool: FakeMigrationPool): void {
  seedOriginalVersionOne(pool);
  pool.applied.set(2, {
    version: 2,
    name: '002_nota_line_page_ownership.sql',
    checksum: Buffer.from(ORIGINAL_V2_CHECKSUM, 'hex'),
  });
}

function seedOriginalVersionThree(pool: FakeMigrationPool): void {
  seedOriginalVersionTwo(pool);
  pool.applied.set(3, {
    version: 3,
    name: '003_identity_sync_protocol.sql',
    checksum: Buffer.from(ORIGINAL_V3_CHECKSUM, 'hex'),
  });
}

describe('runMigrations', () => {
  it('applies versions 1 through 8 once and makes the second run a no-op', async () => {
    const pool = new FakeMigrationPool();

    const first = await runMigrations(pool);
    const statementsAfterFirstRun = pool.migrationStatementCount;
    const second = await runMigrations(pool);

    expect(first).toEqual({
      fromVersion: 0,
      toVersion: 8,
      appliedVersions: [1, 2, 3, 4, 5, 6, 7, 8],
    });
    expect(second).toEqual({
      fromVersion: 8,
      toVersion: 8,
      appliedVersions: [],
    });
    expect(pool.applied.size).toBe(8);
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
      toVersion: 8,
      appliedVersions: [1, 2, 3, 4, 5, 6, 7, 8],
    });
  });

  it('refuses a database schema newer than this binary and releases the lock', async () => {
    const pool = new FakeMigrationPool(9);

    await expect(runMigrations(pool)).rejects.toThrow(
      'Database schema version 9 is newer than supported version 8',
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

  it('upgrades an original version 1 receipt by applying versions 2 through 4', async () => {
    const pool = new FakeMigrationPool();
    seedOriginalVersionOne(pool);

    await expect(runMigrations(pool)).resolves.toEqual({
      fromVersion: 1,
      toVersion: 8,
      appliedVersions: [2, 3, 4, 5, 6, 7, 8],
    });

    expect(pool.applied.size).toBe(8);
    expect(pool.migrationStatementCount).toBeGreaterThan(2);
  });

  it('reruns version 2 after its first DDL statement committed', async () => {
    const pool = new FakeMigrationPool();
    seedOriginalVersionOne(pool);
    pool.failOn = /ALTER TABLE nota_lines/;

    await expect(runMigrations(pool)).rejects.toThrow(
      'deliberate migration failure',
    );
    expect([...pool.applied.keys()]).toEqual([1]);

    pool.failOn = undefined;
    await expect(runMigrations(pool)).resolves.toEqual({
      fromVersion: 1,
      toVersion: 8,
      appliedVersions: [2, 3, 4, 5, 6, 7, 8],
    });
  });

  it('upgrades an original version 2 receipt with versions 3 and 4', async () => {
    const pool = new FakeMigrationPool();
    seedOriginalVersionTwo(pool);

    await expect(runMigrations(pool)).resolves.toEqual({
      fromVersion: 2,
      toVersion: 8,
      appliedVersions: [3, 4, 5, 6, 7, 8],
    });
  });

  it('reruns version 3 after an earlier replay-safe DDL statement committed', async () => {
    const pool = new FakeMigrationPool();
    seedOriginalVersionTwo(pool);
    pool.failOn = /UPDATE devices/;

    await expect(runMigrations(pool)).rejects.toThrow(
      'deliberate migration failure',
    );
    expect([...pool.applied.keys()]).toEqual([1, 2]);

    pool.failOn = undefined;
    await expect(runMigrations(pool)).resolves.toEqual({
      fromVersion: 2,
      toVersion: 8,
      appliedVersions: [3, 4, 5, 6, 7, 8],
    });
  });

  it('reruns version 4 after its approval backfill committed', async () => {
    const pool = new FakeMigrationPool();
    seedOriginalVersionThree(pool);
    pool.failOn = /ALTER TABLE devices/;

    await expect(runMigrations(pool)).rejects.toThrow(
      'deliberate migration failure',
    );
    expect([...pool.applied.keys()]).toEqual([1, 2, 3]);

    pool.failOn = undefined;
    await expect(runMigrations(pool)).resolves.toEqual({
      fromVersion: 3,
      toVersion: 8,
      appliedVersions: [4, 5, 6, 7, 8],
    });
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
  it('enforces one active template per kind in v7', async () => {
    const sql = await readFile(
      new URL(
        '../migrations/007_active_template_kind.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(sql).toMatch(
      /active_template_kind[\s\S]*GENERATED ALWAYS AS[\s\S]*archived_at IS NULL[\s\S]*template_kind[\s\S]*STORED/,
    );
    expect(sql).toMatch(
      /UNIQUE (?:KEY|INDEX) IF NOT EXISTS uq_templates_active_kind\s+\(active_template_kind\)/,
    );
  });

  it('installs the singleton business lock and image processing lease', async () => {
    const sql = await readFile(
      new URL('../migrations/006_business_write_safety.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS business_write_lock');
    expect(sql).toContain(
      'INSERT IGNORE INTO business_write_lock (singleton_id) VALUES (1)',
    );
    expect(sql).toContain('claimed_at TIMESTAMP(6) NULL');
  });

  it('preserves the exact published version 1 checksum', async () => {
    const sql = await readFile(
      new URL('../migrations/001_initial.sql', import.meta.url),
    );

    expect(createHash('sha256').update(sql).digest('hex')).toBe(
      ORIGINAL_V1_CHECKSUM,
    );
  });

  it('preserves the exact published version 2 checksum', async () => {
    const sql = await readFile(
      new URL('../migrations/002_nota_line_page_ownership.sql', import.meta.url),
    );

    expect(createHash('sha256').update(sql).digest('hex')).toBe(
      ORIGINAL_V2_CHECKSUM,
    );
  });

  it('preserves the exact published version 3 checksum', async () => {
    const sql = await readFile(
      new URL('../migrations/003_identity_sync_protocol.sql', import.meta.url),
    );

    expect(createHash('sha256').update(sql).digest('hex')).toBe(
      ORIGINAL_V3_CHECKSUM,
    );
  });

  it('adds replay-safe identity fields and backfills device approval in v4', async () => {
    const sql = await readFile(
      new URL('../migrations/004_replay_safe_protocol.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toMatch(
      /UPDATE devices[\s\S]*SET approved_at = created_at[\s\S]*WHERE approved_at IS NULL/,
    );
    expect(sql).toMatch(/MODIFY approved_at TIMESTAMP\(6\) NOT NULL/);
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS request_id BINARY\(16\) NULL/,
    );
    expect(sql).toMatch(
      /ADD UNIQUE INDEX IF NOT EXISTS uq_pairings_request_id \(request_id\)/,
    );
  });

  it('adds catalogue provenance and bounded image job tables in v5', async () => {
    const sql = await readFile(
      new URL('../migrations/005_catalogue_import.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toMatch(/ALTER TABLE imports[\s\S]*source_file_name/);
    expect(sql).toMatch(/ALTER TABLE imports[\s\S]*preview_json/);
    expect(sql).toMatch(/ALTER TABLE skus[\s\S]*source_import_id/);
    expect(sql).toMatch(/ALTER TABLE skus[\s\S]*source_note/);
    expect(sql).toMatch(/ALTER TABLE skus[\s\S]*source_created_at/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS image_assets/);
    expect(sql).toMatch(/content_hash BINARY\(32\) NOT NULL PRIMARY KEY/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS image_jobs/);
    expect(sql).toMatch(/UNIQUE KEY uq_image_jobs_import_sku/);
    expect(sql).toMatch(/FOREIGN KEY \(import_id\) REFERENCES imports \(id\)/);
    expect(sql).toMatch(/FOREIGN KEY \(sku_id\) REFERENCES skus \(id\)/);
  });

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
      new URL(
        '../migrations/002_nota_line_page_ownership.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const statements = splitMariaDbStatements(sql);

    expect(statements).toHaveLength(2);
    expect(sql).toMatch(
      /ADD UNIQUE INDEX IF NOT EXISTS uq_nota_pages_id_nota \(id, nota_id\)/,
    );
    expect(sql).toMatch(
      /ADD CONSTRAINT fk_nota_lines_page_nota\s+FOREIGN KEY IF NOT EXISTS \(page_id, nota_id\)\s+REFERENCES nota_pages \(id, nota_id\)/,
    );
  });

  it('adds identity protocol fields without modifying published migrations', async () => {
    const sql = await readFile(
      new URL('../migrations/003_identity_sync_protocol.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS role VARCHAR\(16\)/);
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS installation_id BINARY\(16\)/,
    );
    expect(sql).toMatch(
      /UPDATE devices[\s\S]*installation_id = UNHEX\(REPLACE\(UUID\(\), '-', ''\)\)[\s\S]*WHERE installation_id IS NULL/,
    );
    expect(sql).toMatch(/MODIFY installation_id BINARY\(16\) NOT NULL/);
    expect(sql).toMatch(/ADD UNIQUE INDEX IF NOT EXISTS uq_devices_installation/);
    expect(sql).toMatch(
      /active_owner_slot TINYINT[\s\S]*role = 'owner' AND revoked_at IS NULL[\s\S]*uq_devices_active_owner/,
    );
    expect(sql).toMatch(/MODIFY requested_display_name VARCHAR\(160\) NULL/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS claim_hash BINARY\(32\) NULL/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMP\(6\) NULL/);
  });
});
