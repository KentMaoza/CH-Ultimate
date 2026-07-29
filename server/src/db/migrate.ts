import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const LATEST_SCHEMA_VERSION = 1;
export const MIGRATION_LOCK_NAME = 'ch-core-schema-migrations';

const MIGRATION_LOCK_TIMEOUT_SECONDS = 30;
const migrations = [{ version: 1, name: '001_initial.sql' }] as const;

export interface SchemaQueryPool {
  query<T = unknown>(sql: string, values?: readonly unknown[]): Promise<T>;
}

export interface MigrationConnection extends SchemaQueryPool {
  release(): void | Promise<void>;
  destroy(): void;
}

export interface MigrationPool {
  getConnection(): Promise<MigrationConnection>;
}

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  appliedVersions: number[];
}

interface AppliedMigration {
  version: unknown;
  name: string;
  checksum: Buffer;
}

function parseSchemaVersion(value: unknown): number {
  const version =
    typeof value === 'bigint'
      ? Number(value)
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : value;

  if (
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 0
  ) {
    throw new Error('Database returned an invalid schema version');
  }

  return version;
}

type SqlLexicalState =
  | 'normal'
  | 'single-quote'
  | 'double-quote'
  | 'backtick'
  | 'line-comment'
  | 'block-comment';

export function splitMariaDbStatements(sql: string): string[] {
  const statements: string[] = [];
  let statement = '';
  let state: SqlLexicalState = 'normal';
  let hasExecutableToken = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    const next = sql[index + 1];

    if (state === 'line-comment') {
      statement += character;
      if (character === '\n') {
        state = 'normal';
      }
      continue;
    }

    if (state === 'block-comment') {
      statement += character;
      if (character === '*' && next === '/') {
        statement += next;
        index += 1;
        state = 'normal';
      }
      continue;
    }

    if (state !== 'normal') {
      statement += character;
      if (character === '\\' && next !== undefined) {
        statement += next;
        index += 1;
        continue;
      }

      const quote =
        state === 'single-quote'
          ? "'"
          : state === 'double-quote'
            ? '"'
            : '`';
      if (character === quote && next === quote) {
        statement += next;
        index += 1;
      } else if (character === quote) {
        state = 'normal';
      }
      continue;
    }

    if (
      character === '-' &&
      next === '-' &&
      (sql[index + 2] === undefined || /\s/.test(sql[index + 2]!))
    ) {
      statement += '--';
      index += 1;
      state = 'line-comment';
      continue;
    }

    if (character === '#') {
      statement += character;
      state = 'line-comment';
      continue;
    }

    if (character === '/' && next === '*') {
      statement += '/*';
      index += 1;
      state = 'block-comment';
      continue;
    }

    if (character === ';') {
      if (hasExecutableToken) {
        statements.push(statement.trim());
      }
      statement = '';
      hasExecutableToken = false;
      continue;
    }

    statement += character;
    if (character === "'") {
      state = 'single-quote';
      hasExecutableToken = true;
    } else if (character === '"') {
      state = 'double-quote';
      hasExecutableToken = true;
    } else if (character === '`') {
      state = 'backtick';
      hasExecutableToken = true;
    } else if (!/\s/.test(character)) {
      hasExecutableToken = true;
    }
  }

  if (state !== 'normal' && state !== 'line-comment') {
    throw new Error('Migration SQL contains an unterminated quoted value or comment');
  }
  if (hasExecutableToken) {
    statements.push(statement.trim());
  }

  return statements;
}

async function loadMigration(migration: (typeof migrations)[number]): Promise<{
  sql: string;
  checksum: Buffer;
}> {
  const sql = await readFile(
    new URL(`../../migrations/${migration.name}`, import.meta.url),
    'utf8',
  );
  return {
    sql,
    checksum: createHash('sha256').update(sql).digest(),
  };
}

function checksumsMatch(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right);
}

export async function runMigrations(pool: MigrationPool): Promise<MigrationResult> {
  const connection = await pool.getConnection();
  let lockAcquired = false;
  let safeToReturnToPool = false;

  try {
    const lockRows = await connection.query<Array<{ acquired: unknown }>>(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [MIGRATION_LOCK_NAME, MIGRATION_LOCK_TIMEOUT_SECONDS],
    );
    if (Number(lockRows[0]?.acquired) !== 1) {
      safeToReturnToPool = true;
      throw new Error('Could not acquire the CH Core migration lock');
    }
    lockAcquired = true;

    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version BIGINT UNSIGNED NOT NULL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        checksum BINARY(32) NOT NULL,
        applied_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const applied = await connection.query<AppliedMigration[]>(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
    );
    const currentVersion =
      applied.length > 0
        ? parseSchemaVersion(applied[applied.length - 1]?.version)
        : 0;

    if (currentVersion > LATEST_SCHEMA_VERSION) {
      throw new Error(
        `Database schema version ${currentVersion} is newer than supported version ${LATEST_SCHEMA_VERSION}`,
      );
    }

    const loadedMigrations = await Promise.all(
      migrations.map(async (migration) => ({
        ...migration,
        ...(await loadMigration(migration)),
      })),
    );
    for (const existing of applied) {
      const known = loadedMigrations.find(
        (migration) => migration.version === parseSchemaVersion(existing.version),
      );
      if (known && !checksumsMatch(Buffer.from(existing.checksum), known.checksum)) {
        throw new Error(`Applied migration ${known.version} checksum does not match`);
      }
    }

    const appliedVersions: number[] = [];
    for (const migration of loadedMigrations) {
      if (migration.version <= currentVersion) {
        continue;
      }

      for (const statement of splitMariaDbStatements(migration.sql)) {
        await connection.query(statement);
      }
      await connection.query(
        `INSERT INTO schema_migrations (version, name, checksum)
         VALUES (?, ?, ?)`,
        [migration.version, migration.name, migration.checksum],
      );
      appliedVersions.push(migration.version);
    }

    return {
      fromVersion: currentVersion,
      toVersion:
        appliedVersions[appliedVersions.length - 1] ?? currentVersion,
      appliedVersions,
    };
  } finally {
    try {
      if (lockAcquired) {
        const releaseRows = await connection.query<Array<{ released: unknown }>>(
          'SELECT RELEASE_LOCK(?) AS released',
          [MIGRATION_LOCK_NAME],
        );
        if (Number(releaseRows[0]?.released) !== 1) {
          throw new Error(
            'Could not confirm release of the CH Core migration lock',
          );
        }
        safeToReturnToPool = true;
      }
      if (!safeToReturnToPool) {
        connection.destroy();
      } else {
        await connection.release();
      }
    } catch (error) {
      connection.destroy();
      throw error;
    }
  }
}

export async function assertSchemaCompatible(
  pool: SchemaQueryPool,
): Promise<void> {
  const rows = await pool.query<Array<{ version: unknown }>>(
    'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1',
  );
  const currentVersion = rows[0] ? parseSchemaVersion(rows[0].version) : 0;

  if (currentVersion !== LATEST_SCHEMA_VERSION) {
    throw new Error('Database schema is not compatible with this CH Core binary');
  }
}
