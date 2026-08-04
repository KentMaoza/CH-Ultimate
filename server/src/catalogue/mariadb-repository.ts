import { randomUUID } from 'node:crypto';

import type { SchemaQueryPool } from '../db/migrate.js';
import { acquireBusinessWriteLock } from '../sync/business-write-lock.js';
import type {
  ProtocolConnection,
  ProtocolPool,
} from '../sync/idempotency.js';
import {
  MariaDbCatalogueImportStore,
  parseCatalogueCommitResult,
} from './catalogue-import-store.js';
import {
  insertCatalogue,
  removePreTransactionCatalogue,
  type PreparedCatalogueRow,
} from './catalogue-writer.js';
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

  createStage(
    record: CatalogueImportRecord,
  ): Promise<CatalogueImportRecord> {
    return this.imports.createStage(record);
  }

  refreshStage(
    record: CatalogueImportRecord,
  ): Promise<CatalogueImportRecord> {
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
        const replay = parseCatalogueCommitResult(
          locked[0].result_json,
        );
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
           SELECT 1 FROM stock_checks
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
        await removePreTransactionCatalogue(
          connection,
          record,
          committedAt,
        );
      }

      const prepared: PreparedCatalogueRow[] = workbook.rows.map(
        (source) => ({
          source,
          skuId: this.uuid(),
          primaryIdentifierId: this.uuid(),
          productIdentifierId: this.uuid(),
          imageJobId: source.imageSourceUrl ? this.uuid() : null,
          priceHistoryId: this.uuid(),
        }),
      );
      await insertCatalogue(
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

  private uuid(): string {
    const value = this.randomUuid();
    if (!UUID_PATTERN.test(value)) {
      throw new Error('Catalogue repository generated an invalid UUID');
    }
    return value;
  }
}
