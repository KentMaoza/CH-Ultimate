import {
  databaseDate,
  hexToUuid,
  nullableDatabaseDate,
} from '../auth/mariadb-row-utils.js';
import type { SchemaQueryPool } from '../db/migrate.js';
import type {
  CatalogueCommitResult,
  CatalogueImportRecord,
} from './service.js';
import type { CataloguePreview } from './workbook.js';

interface ImportRow extends Record<string, unknown> {
  id_hex: unknown;
  workbook_sha256: unknown;
  source_file_name: unknown;
  staged_path: unknown;
  status: unknown;
  preview_json: unknown;
  created_by_device_id_hex: unknown;
  created_at: unknown;
  expires_at: unknown;
  committed_at: unknown;
  result_json: unknown;
}

function json(value: unknown): unknown {
  if (typeof value === 'string') return JSON.parse(value);
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString('utf8'));
  return value;
}

export function parseCatalogueCommitResult(
  value: unknown,
): CatalogueCommitResult | null {
  if (value === null || value === undefined) return null;
  const candidate = json(value);
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof Reflect.get(candidate, 'importId') !== 'string' ||
    typeof Reflect.get(candidate, 'workbookSha256') !== 'string' ||
    typeof Reflect.get(candidate, 'rowCount') !== 'number' ||
    typeof Reflect.get(candidate, 'imageJobCount') !== 'number' ||
    typeof Reflect.get(candidate, 'committedAt') !== 'string'
  ) {
    throw new Error('Database returned an invalid catalogue result');
  }
  return {
    importId: Reflect.get(candidate, 'importId'),
    workbookSha256: Reflect.get(candidate, 'workbookSha256'),
    rowCount: Reflect.get(candidate, 'rowCount'),
    imageJobCount: Reflect.get(candidate, 'imageJobCount'),
    committedAt: Reflect.get(candidate, 'committedAt'),
    replayed: Reflect.get(candidate, 'replayed') === true,
  };
}

function mapImport(row: ImportRow): CatalogueImportRecord {
  const status = String(row.status);
  if (status !== 'staged' && status !== 'committed') {
    throw new Error('Database returned an invalid catalogue import status');
  }
  const workbookHash = Buffer.from(row.workbook_sha256 as Uint8Array).toString(
    'hex',
  );
  if (!/^[0-9a-f]{64}$/.test(workbookHash)) {
    throw new Error('Database returned an invalid workbook hash');
  }
  const preview = json(row.preview_json) as CataloguePreview;
  if (
    typeof preview !== 'object' ||
    preview === null ||
    !Number.isSafeInteger(preview.rowCount)
  ) {
    throw new Error('Database returned an invalid catalogue preview');
  }
  return {
    id: hexToUuid(row.id_hex),
    workbookSha256: workbookHash,
    sourceFileName: String(row.source_file_name),
    stagedPath: String(row.staged_path),
    status,
    preview,
    createdByDeviceId: hexToUuid(row.created_by_device_id_hex),
    createdAt: databaseDate(row.created_at).toISOString(),
    expiresAt: databaseDate(row.expires_at).toISOString(),
    committedAt: nullableDatabaseDate(row.committed_at)?.toISOString() ?? null,
    result: parseCatalogueCommitResult(row.result_json),
  };
}

function importSelect(): string {
  return `SELECT HEX(id) AS id_hex, workbook_sha256, source_file_name,
                 staged_path, status, preview_json,
                 HEX(created_by_device_id) AS created_by_device_id_hex,
                 created_at, expires_at, committed_at, result_json
          FROM imports`;
}

export class MariaDbCatalogueImportStore {
  constructor(private readonly pool: SchemaQueryPool) {}

  async findByHash(sha256: string): Promise<CatalogueImportRecord | null> {
    const rows = await this.pool.query<ImportRow[]>(
      `${importSelect()}
       WHERE workbook_sha256 = ?
       LIMIT 1`,
      [Buffer.from(sha256, 'hex')],
    );
    return rows[0] ? mapImport(rows[0]) : null;
  }

  async findById(id: string): Promise<CatalogueImportRecord | null> {
    const rows = await this.pool.query<ImportRow[]>(
      `${importSelect()}
       WHERE id = UNHEX(REPLACE(?, '-', ''))
       LIMIT 1`,
      [id],
    );
    return rows[0] ? mapImport(rows[0]) : null;
  }

  async createStage(
    record: CatalogueImportRecord,
  ): Promise<CatalogueImportRecord> {
    try {
      await this.pool.query(
        `INSERT INTO imports
           (id, workbook_sha256, source_file_name, status, staged_path,
            preview_json, created_by_device_id, created_at, expires_at)
         VALUES
           (UNHEX(REPLACE(?, '-', '')), ?, ?, 'staged', ?, ?,
            UNHEX(REPLACE(?, '-', '')), ?, ?)`,
        [
          record.id,
          Buffer.from(record.workbookSha256, 'hex'),
          record.sourceFileName,
          record.stagedPath,
          JSON.stringify(record.preview),
          record.createdByDeviceId,
          new Date(record.createdAt),
          new Date(record.expiresAt),
        ],
      );
      return record;
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        Reflect.get(error, 'code') !== 'ER_DUP_ENTRY'
      ) {
        throw error;
      }
      const existing = await this.findByHash(record.workbookSha256);
      if (!existing) throw error;
      return existing;
    }
  }

  async refreshStage(
    record: CatalogueImportRecord,
  ): Promise<CatalogueImportRecord> {
    await this.pool.query(
      `UPDATE imports
       SET source_file_name = ?, staged_path = ?, status = 'staged',
           preview_json = ?, created_by_device_id = UNHEX(REPLACE(?, '-', '')),
           created_at = ?, expires_at = ?, committed_at = NULL,
           result_json = NULL
       WHERE id = UNHEX(REPLACE(?, '-', ''))
         AND status = 'staged'`,
      [
        record.sourceFileName,
        record.stagedPath,
        JSON.stringify(record.preview),
        record.createdByDeviceId,
        new Date(record.createdAt),
        new Date(record.expiresAt),
        record.id,
      ],
    );
    return record;
  }

  async listExpiredStagePaths(expiredAt: Date): Promise<string[]> {
    const rows = await this.pool.query<Array<{ staged_path: unknown }>>(
      `SELECT staged_path
       FROM imports
       WHERE expires_at <= ?
       ORDER BY expires_at, id`,
      [expiredAt],
    );
    return rows.map((row) => String(row.staged_path));
  }
}
