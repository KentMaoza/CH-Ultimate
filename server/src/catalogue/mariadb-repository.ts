import { createHash, randomUUID } from 'node:crypto';

import {
  databaseDate,
  hexToUuid,
  nullableDatabaseDate,
} from '../auth/mariadb-row-utils.js';
import type { SchemaQueryPool } from '../db/migrate.js';
import type {
  ProtocolConnection,
  ProtocolPool,
} from '../sync/idempotency.js';
import {
  CatalogueError,
  type CatalogueCommitResult,
  type CatalogueImportRecord,
  type CatalogueRepository,
} from './service.js';
import type {
  CataloguePreview,
  CatalogueRow,
  CatalogueWorkbook,
} from './workbook.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BULK_ROWS = 100;

interface CataloguePool extends ProtocolPool, SchemaQueryPool {}

interface RepositoryOptions {
  randomUuid?: () => string;
}

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

interface PreparedRow {
  source: CatalogueRow;
  skuId: string;
  primaryIdentifierId: string;
  productIdentifierId: string;
  imageJobId: string | null;
  priceHistoryId: string;
}

function json(value: unknown): unknown {
  if (typeof value === 'string') return JSON.parse(value);
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString('utf8'));
  return value;
}

function validResult(value: unknown): CatalogueCommitResult | null {
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
    result: validResult(row.result_json),
  };
}

function identifierHash(value: string): Buffer {
  return createHash('sha256')
    .update(value.toLocaleLowerCase('id-ID'), 'utf8')
    .digest();
}

function placeholders(rows: number, columns: string): string {
  return Array.from({ length: rows }, () => `(${columns})`).join(', ');
}

async function insertChunks<T>(
  connection: ProtocolConnection,
  table: string,
  columns: string,
  rowPlaceholders: string,
  rows: T[],
  values: (row: T) => readonly unknown[],
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += BULK_ROWS) {
    const chunk = rows.slice(offset, offset + BULK_ROWS);
    await connection.query(
      `INSERT INTO ${table} (${columns})
       VALUES ${placeholders(chunk.length, rowPlaceholders)}`,
      chunk.flatMap((row) => [...values(row)]),
    );
  }
}

function skuPayload(row: PreparedRow, committedAt: Date) {
  return {
    id: row.skuId,
    primaryIdentifier: row.source.primarySku,
    name: row.source.name,
    priceRupiah: row.source.selectedPrice.toString(),
    imageHash: null,
    sourceImageUrl: row.source.imageSourceUrl,
    sourceNote: row.source.note,
    sourceCreatedAt: row.source.sourceCreatedAt,
    rowVersion: '1',
    archivedAt: null,
    createdAt: committedAt.toISOString(),
    updatedAt: committedAt.toISOString(),
  };
}

function identifierPayload(
  id: string,
  row: PreparedRow,
  value: string,
  kind: string,
  committedAt: Date,
) {
  return {
    id,
    skuId: row.skuId,
    identifierValue: value,
    identifierKind: kind,
    createdAt: committedAt.toISOString(),
  };
}

function balancePayload(row: PreparedRow, committedAt: Date) {
  return {
    skuId: row.skuId,
    quantityPcs: row.source.stockPcs.toString(),
    rowVersion: '1',
    updatedAt: committedAt.toISOString(),
  };
}

async function rollback(connection: ProtocolConnection): Promise<void> {
  try {
    await connection.rollback();
  } catch {
    // Preserve the original database failure.
  }
}

export class MariaDbCatalogueRepository implements CatalogueRepository {
  private readonly randomUuid: () => string;

  constructor(
    private readonly pool: CataloguePool,
    options: RepositoryOptions = {},
  ) {
    this.randomUuid = options.randomUuid ?? randomUUID;
  }

  async findByHash(sha256: string): Promise<CatalogueImportRecord | null> {
    const rows = await this.pool.query<ImportRow[]>(
      `${this.importSelect()}
       WHERE workbook_sha256 = ?
       LIMIT 1`,
      [Buffer.from(sha256, 'hex')],
    );
    return rows[0] ? mapImport(rows[0]) : null;
  }

  async findById(id: string): Promise<CatalogueImportRecord | null> {
    const rows = await this.pool.query<ImportRow[]>(
      `${this.importSelect()}
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

  async commit(
    record: CatalogueImportRecord,
    workbook: CatalogueWorkbook,
    committedAt: Date,
  ): Promise<CatalogueCommitResult> {
    const connection = await this.pool.getConnection();
    let transactionStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const locked = await connection.query<
        Array<{ status: unknown; result_json: unknown }>
      >(
        `SELECT status, result_json
         FROM imports
         WHERE id = UNHEX(REPLACE(?, '-', ''))
         FOR UPDATE`,
        [record.id],
      );
      if (!locked[0]) {
        throw new CatalogueError(
          'IMPORT_NOT_FOUND',
          404,
          'Import tidak ditemukan.',
        );
      }
      if (String(locked[0].status) === 'committed') {
        const replay = validResult(locked[0].result_json);
        if (!replay) {
          throw new Error('Committed catalogue import has no result');
        }
        await connection.commit();
        transactionStarted = false;
        return { ...replay, replayed: true };
      }

      const liveRows = await connection.query<
        Array<{ has_live_transactions: unknown }>
      >(
        `SELECT EXISTS(
           SELECT 1 FROM notas
           UNION ALL
           SELECT 1 FROM stock_movements
           UNION ALL
           SELECT 1 FROM price_history
           WHERE source <> 'catalogue_import'
           LIMIT 1
         ) AS has_live_transactions`,
      );
      if (Number(liveRows[0]?.has_live_transactions) === 1) {
        throw new CatalogueError(
          'LIVE_TRANSACTIONS_EXIST',
          409,
          'Import penuh diblokir setelah transaksi berjalan.',
        );
      }

      const existingRows = await connection.query<
        Array<{ has_existing_catalogue: unknown }>
      >(
        `SELECT EXISTS(
           SELECT 1 FROM imports
           WHERE status = 'committed'
             AND id <> UNHEX(REPLACE(?, '-', ''))
           LIMIT 1
         ) AS has_existing_catalogue`,
        [record.id],
      );
      if (Number(existingRows[0]?.has_existing_catalogue) === 1) {
        await this.removePreTransactionCatalogue(connection);
      }

      const prepared = workbook.rows.map((source) => ({
        source,
        skuId: this.uuid(),
        primaryIdentifierId: this.uuid(),
        productIdentifierId: this.uuid(),
        imageJobId: source.imageSourceUrl ? this.uuid() : null,
        priceHistoryId: this.uuid(),
      }));
      await this.insertCatalogue(
        connection,
        record,
        prepared,
        committedAt,
      );
      const result: CatalogueCommitResult = {
        importId: record.id,
        workbookSha256: record.workbookSha256,
        rowCount: workbook.preview.rowCount,
        imageJobCount: workbook.preview.imageJobCount,
        committedAt: committedAt.toISOString(),
        replayed: false,
      };
      await connection.query(
        `UPDATE imports
         SET status = 'committed', result_json = ?, committed_at = ?
         WHERE id = UNHEX(REPLACE(?, '-', ''))`,
        [JSON.stringify(result), committedAt, record.id],
      );
      await connection.query(
        `INSERT INTO audit_events
           (id, device_id, action, entity_type, entity_id, detail_json)
         VALUES
           (UNHEX(REPLACE(UUID(), '-', '')),
            UNHEX(REPLACE(?, '-', '')), 'catalogue.import_committed',
            'import', UNHEX(REPLACE(?, '-', '')), ?)`,
        [
          record.createdByDeviceId,
          record.id,
          JSON.stringify({
            workbookSha256: record.workbookSha256,
            rowCount: result.rowCount,
            imageJobCount: result.imageJobCount,
          }),
        ],
      );
      await connection.commit();
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) await rollback(connection);
      throw error;
    } finally {
      await connection.release();
    }
  }

  private importSelect(): string {
    return `SELECT HEX(id) AS id_hex, workbook_sha256, source_file_name,
                   staged_path, status, preview_json,
                   HEX(created_by_device_id) AS created_by_device_id_hex,
                   created_at, expires_at, committed_at, result_json
            FROM imports`;
  }

  private uuid(): string {
    const value = this.randomUuid();
    if (!UUID_PATTERN.test(value)) {
      throw new Error('Catalogue repository generated an invalid UUID');
    }
    return value;
  }

  private async removePreTransactionCatalogue(
    connection: ProtocolConnection,
  ): Promise<void> {
    await connection.query('DELETE FROM change_log');
    await connection.query(
      `DELETE FROM price_history
       WHERE source = 'catalogue_import'`,
    );
    await connection.query('DELETE FROM stock_balances');
    await connection.query('DELETE FROM sku_identifiers');
    await connection.query('DELETE FROM skus');
  }

  private async insertCatalogue(
    connection: ProtocolConnection,
    record: CatalogueImportRecord,
    rows: PreparedRow[],
    committedAt: Date,
  ): Promise<void> {
    await insertChunks(
      connection,
      'skus',
      `id, primary_identifier, name, price_rupiah, source_image_url,
       source_import_id, source_note, source_created_at, created_at, updated_at`,
      `UNHEX(REPLACE(?, '-', '')), ?, ?, ?, ?,
       UNHEX(REPLACE(?, '-', '')), ?, ?, ?, ?`,
      rows,
      (row) => [
        row.skuId,
        row.source.primarySku,
        row.source.name,
        row.source.selectedPrice,
        row.source.imageSourceUrl,
        record.id,
        row.source.note,
        row.source.sourceCreatedAt,
        committedAt,
        committedAt,
      ],
    );
    const identifiers = rows.flatMap((row) => [
      {
        id: row.primaryIdentifierId,
        row,
        value: row.source.primarySku,
        kind: 'primary',
      },
      {
        id: row.productIdentifierId,
        row,
        value: row.source.productCode,
        kind: 'product_code',
      },
    ]);
    await insertChunks(
      connection,
      'sku_identifiers',
      `id, sku_id, identifier_value, identifier_hash, identifier_kind,
       created_at`,
      `UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
       ?, ?, ?, ?`,
      identifiers,
      (identifier) => [
        identifier.id,
        identifier.row.skuId,
        identifier.value,
        identifierHash(identifier.value),
        identifier.kind,
        committedAt,
      ],
    );
    await insertChunks(
      connection,
      'stock_balances',
      'sku_id, quantity_pcs, row_version, updated_at',
      `UNHEX(REPLACE(?, '-', '')), ?, 1, ?`,
      rows,
      (row) => [row.skuId, row.source.stockPcs, committedAt],
    );
    await insertChunks(
      connection,
      'price_history',
      `id, sku_id, price_rupiah, source, changed_by_device_id,
       effective_at`,
      `UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
       ?, ?, UNHEX(REPLACE(?, '-', '')), ?`,
      rows,
      (row) => [
        row.priceHistoryId,
        row.skuId,
        row.source.selectedPrice,
        'catalogue_import',
        record.createdByDeviceId,
        committedAt,
      ],
    );
    const imageRows = rows.filter(
      (row): row is PreparedRow & { imageJobId: string } =>
        row.imageJobId !== null && row.source.imageSourceUrl !== null,
    );
    await insertChunks(
      connection,
      'image_jobs',
      'id, import_id, sku_id, source_url, status, next_attempt_at',
      `UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
       UNHEX(REPLACE(?, '-', '')), ?, 'pending', ?`,
      imageRows,
      (row) => [
        row.imageJobId,
        record.id,
        row.skuId,
        row.source.imageSourceUrl,
        committedAt,
      ],
    );
    const changes = rows.flatMap((row) => [
      {
        entityType: 'sku',
        entityId: row.skuId,
        payload: skuPayload(row, committedAt),
      },
      {
        entityType: 'sku_identifier',
        entityId: row.primaryIdentifierId,
        payload: identifierPayload(
          row.primaryIdentifierId,
          row,
          row.source.primarySku,
          'primary',
          committedAt,
        ),
      },
      {
        entityType: 'sku_identifier',
        entityId: row.productIdentifierId,
        payload: identifierPayload(
          row.productIdentifierId,
          row,
          row.source.productCode,
          'product_code',
          committedAt,
        ),
      },
      {
        entityType: 'stock_balance',
        entityId: row.skuId,
        payload: balancePayload(row, committedAt),
      },
    ]);
    await insertChunks(
      connection,
      'change_log',
      'entity_type, entity_id, operation, payload_json, created_at',
      `?, UNHEX(REPLACE(?, '-', '')), 'upsert', ?, ?`,
      changes,
      (change) => [
        change.entityType,
        change.entityId,
        JSON.stringify(change.payload),
        committedAt,
      ],
    );
  }
}
