import { randomUUID } from 'node:crypto';

import type { SchemaQueryPool } from '../db/migrate.js';
import { acquireBusinessWriteLock } from '../sync/business-write-lock.js';
import type { ProtocolConnection, ProtocolPool } from '../sync/idempotency.js';
import {
  MariaDbCatalogueImportStore,
  parseCatalogueCommitResult,
} from './catalogue-import-store.js';
import { insertCatalogue } from './catalogue-writer.js';
import {
  reconcileCatalogue,
  type ExistingCatalogueRow,
} from './catalogue-reconciliation.js';
import {
  CatalogueError,
  type CatalogueCommitResult,
  type CatalogueImportRecord,
  type CatalogueRepository,
} from './service.js';
import type { CatalogueWorkbook } from './workbook.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CataloguePool extends ProtocolPool, SchemaQueryPool {}

interface RepositoryOptions {
  randomUuid?: () => string;
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
  private readonly imports: MariaDbCatalogueImportStore;

  constructor(
    private readonly pool: CataloguePool,
    options: RepositoryOptions = {},
  ) {
    this.randomUuid = options.randomUuid ?? randomUUID;
    this.imports = new MariaDbCatalogueImportStore(pool);
  }

  findByHash(sha256: string): Promise<CatalogueImportRecord | null> {
    return this.imports.findByHash(sha256);
  }

  findById(id: string): Promise<CatalogueImportRecord | null> {
    return this.imports.findById(id);
  }

  createStage(record: CatalogueImportRecord): Promise<CatalogueImportRecord> {
    return this.imports.createStage(record);
  }

  refreshStage(record: CatalogueImportRecord): Promise<CatalogueImportRecord> {
    return this.imports.refreshStage(record);
  }

  listExpiredStagePaths(expiredAt: Date): Promise<string[]> {
    return this.imports.listExpiredStagePaths(expiredAt);
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
      await acquireBusinessWriteLock(connection);
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
        const replay = parseCatalogueCommitResult(locked[0].result_json);
        if (!replay) {
          throw new Error('Committed catalogue import has no result');
        }
        await connection.commit();
        transactionStarted = false;
        return { ...replay, replayed: true };
      }

      const existingRows = await connection.query<ExistingCatalogueRow[]>(
        `SELECT HEX(s.id) AS sku_id_hex, s.row_version, s.price_rupiah,
                sb.row_version AS balance_row_version,
                sb.quantity_pcs, s.created_at,
                HEX(s.image_hash) AS image_hash_hex, s.archived_at,
                HEX(si.id) AS identifier_id_hex, si.identifier_value,
                si.identifier_kind,
                si.created_at AS identifier_created_at
         FROM skus s
         LEFT JOIN sku_identifiers si ON si.sku_id = s.id
         LEFT JOIN stock_balances sb ON sb.sku_id = s.id
         ORDER BY s.created_at, s.id, si.created_at, si.id
         FOR UPDATE`,
      );
      const reconciliation = reconcileCatalogue(
        workbook.rows,
        existingRows,
        () => this.uuid(),
      );
      const writeSummary = await insertCatalogue(
        connection,
        record,
        reconciliation.rows,
        committedAt,
      );
      const result: CatalogueCommitResult = {
        importId: record.id,
        workbookSha256: record.workbookSha256,
        rowCount: workbook.preview.rowCount,
        imageJobCount: workbook.preview.imageJobCount,
        matchedExistingCount: reconciliation.matchedExistingCount,
        createdSkuCount: reconciliation.createdSkuCount,
        untouchedExistingCount: reconciliation.untouchedExistingCount,
        stockAdjustedCount: writeSummary.stockAdjustedCount,
        zeroDeltaMatchedCount: writeSummary.zeroDeltaMatchedCount,
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
            matchedExistingCount: reconciliation.matchedExistingCount,
            createdSkuCount: reconciliation.createdSkuCount,
            untouchedExistingCount: reconciliation.untouchedExistingCount,
            stockAdjustedCount: writeSummary.stockAdjustedCount,
            zeroDeltaMatchedCount: writeSummary.zeroDeltaMatchedCount,
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

  private uuid(): string {
    const value = this.randomUuid();
    if (!UUID_PATTERN.test(value)) {
      throw new Error('Catalogue repository generated an invalid UUID');
    }
    return value;
  }
}
