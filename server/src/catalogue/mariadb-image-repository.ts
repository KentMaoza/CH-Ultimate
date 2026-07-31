import { createHash } from 'node:crypto';

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
import { acquireBusinessWriteLock } from '../sync/business-write-lock.js';
import { CatalogueError } from './service.js';
import type {
  CatalogueImageAsset,
  CatalogueImageJob,
  CatalogueImageRepository,
} from './image-worker.js';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const PERMANENT_ERRORS = [
  'IMAGE_URL_NOT_ALLOWED',
  'IMAGE_ADDRESS_NOT_PUBLIC',
  'IMAGE_MIME_NOT_ALLOWED',
  'IMAGE_MAGIC_MISMATCH',
  'IMAGE_DIMENSIONS_NOT_ALLOWED',
  'IMAGE_TOO_LARGE',
  'IMAGE_TOO_MANY_REDIRECTS',
  'IMAGE_INVALID_REDIRECT',
] as const;

interface CatalogueImagePool extends ProtocolPool, SchemaQueryPool {}

export interface CatalogueImageReadStorage {
  readImage(storagePath: string): Promise<Buffer>;
  writeImage?(hash: string, bytes: Buffer): Promise<string>;
}

async function rollback(connection: ProtocolConnection): Promise<void> {
  try {
    await connection.rollback();
  } catch {
    // Preserve the original database failure.
  }
}

export class MariaDbCatalogueImageRepository
  implements CatalogueImageRepository
{
  constructor(
    private readonly pool: CatalogueImagePool,
    private readonly storage: CatalogueImageReadStorage,
  ) {}

  async claimNext(): Promise<CatalogueImageJob | null> {
    const connection = await this.pool.getConnection();
    let transactionStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const rows = await connection.query<
        Array<{
          id_hex: unknown;
          sku_id_hex: unknown;
          source_url: unknown;
          attempt_count: unknown;
        }>
      >(
        `SELECT HEX(id) AS id_hex, HEX(sku_id) AS sku_id_hex,
                source_url, attempt_count
         FROM image_jobs
         WHERE (
           status IN ('pending', 'retry')
           AND next_attempt_at <= CURRENT_TIMESTAMP(6)
         ) OR (
           status = 'processing'
           AND (
             claimed_at IS NULL
             OR claimed_at <= DATE_SUB(
               CURRENT_TIMESTAMP(6),
               INTERVAL 15 MINUTE
             )
           )
         )
         ORDER BY created_at, id
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
      );
      const row = rows[0];
      if (!row) {
        await connection.commit();
        transactionStarted = false;
        return null;
      }
      const id = hexToUuid(row.id_hex);
      await connection.query(
        `UPDATE image_jobs
         SET status = 'processing',
             attempt_count = attempt_count + 1,
             claimed_at = CURRENT_TIMESTAMP(6),
             last_error_code = NULL
         WHERE id = UNHEX(REPLACE(?, '-', ''))`,
        [id],
      );
      await connection.commit();
      transactionStarted = false;
      return {
        id,
        skuId: hexToUuid(row.sku_id_hex),
        sourceUrl: String(row.source_url),
        attemptCount: Number(row.attempt_count) + 1,
      };
    } catch (error) {
      if (transactionStarted) await rollback(connection);
      throw error;
    } finally {
      await connection.release();
    }
  }

  async complete(
    job: CatalogueImageJob,
    asset: CatalogueImageAsset,
  ): Promise<void> {
    const connection = await this.pool.getConnection();
    let transactionStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      await acquireBusinessWriteLock(connection);
      const hash = Buffer.from(asset.contentHash, 'hex');
      await connection.query(
        `INSERT INTO image_assets
           (content_hash, mime_type, byte_size, width, height, storage_path)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE content_hash = VALUES(content_hash)`,
        [
          hash,
          asset.mimeType,
          asset.byteSize,
          asset.width,
          asset.height,
          asset.storagePath,
        ],
      );
      await connection.query(
        `UPDATE image_jobs
         SET status = 'stored', content_hash = ?, claimed_at = NULL,
             last_error_code = NULL
         WHERE id = UNHEX(REPLACE(?, '-', ''))`,
        [hash, job.id],
      );
      await connection.query(
        `UPDATE skus
         SET image_hash = ?, row_version = row_version + 1
         WHERE id = UNHEX(REPLACE(?, '-', ''))`,
        [hash, job.skuId],
      );
      const skuRows = await connection.query<Array<Record<string, unknown>>>(
        `SELECT HEX(id) AS id_hex, primary_identifier, name, price_rupiah,
                image_hash, source_image_url, source_note,
                source_created_at, row_version, archived_at,
                created_at, updated_at
         FROM skus
         WHERE id = UNHEX(REPLACE(?, '-', ''))`,
        [job.skuId],
      );
      const sku = skuRows[0];
      if (!sku) throw new Error('Image job references a missing SKU');
      await connection.query(
        `INSERT INTO change_log
           (entity_type, entity_id, operation, payload_json)
         VALUES
           (?, UNHEX(REPLACE(?, '-', '')), 'upsert', ?)`,
        [
          'sku',
          job.skuId,
          JSON.stringify({
            id: hexToUuid(sku.id_hex),
            primaryIdentifier: String(sku.primary_identifier),
            name: String(sku.name),
            priceRupiah: String(sku.price_rupiah),
            imageHash: Buffer.from(
              sku.image_hash as Uint8Array,
            ).toString('hex'),
            sourceImageUrl:
              sku.source_image_url === null
                ? null
                : String(sku.source_image_url),
            sourceNote:
              sku.source_note === null ? '' : String(sku.source_note),
            sourceCreatedAt:
              sku.source_created_at === null
                ? ''
                : String(sku.source_created_at),
            rowVersion: String(sku.row_version),
            archivedAt:
              nullableDatabaseDate(sku.archived_at)?.toISOString() ?? null,
            createdAt: databaseDate(sku.created_at).toISOString(),
            updatedAt: databaseDate(sku.updated_at).toISOString(),
          }),
        ],
      );
      await connection.commit();
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) await rollback(connection);
      throw error;
    } finally {
      await connection.release();
    }
  }

  async fail(job: CatalogueImageJob, errorCode: string): Promise<void> {
    await this.pool.query(
      `UPDATE image_jobs
       SET status = CASE
             WHEN attempt_count < 5
              AND ? NOT IN (${PERMANENT_ERRORS.map(() => '?').join(', ')})
             THEN 'retry'
             ELSE 'failed'
           END,
           last_error_code = ?,
           claimed_at = NULL,
           next_attempt_at = DATE_ADD(
             CURRENT_TIMESTAMP(6),
             INTERVAL LEAST(POWER(2, attempt_count), 24) HOUR
           )
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [
        errorCode,
        ...PERMANENT_ERRORS,
        errorCode,
        job.id,
      ],
    );
  }

  async read(hash: string): Promise<{ bytes: Buffer; mimeType: string }> {
    if (!HASH_PATTERN.test(hash)) {
      throw new CatalogueError(
        'INVALID_IMAGE_HASH',
        400,
        'Hash gambar tidak valid.',
      );
    }
    const rows = await this.pool.query<
      Array<{
        mime_type: unknown;
        storage_path: unknown;
        byte_size: unknown;
      }>
    >(
      `SELECT mime_type, storage_path, byte_size
       FROM image_assets
       WHERE content_hash = ?`,
      [Buffer.from(hash, 'hex')],
    );
    const row = rows[0];
    if (!row) {
      throw new CatalogueError(
        'IMAGE_NOT_FOUND',
        404,
        'Gambar tidak ditemukan.',
      );
    }
    const bytes = await this.storage.readImage(String(row.storage_path));
    if (
      bytes.length !== Number(row.byte_size) ||
      createHash('sha256').update(bytes).digest('hex') !== hash
    ) {
      throw new CatalogueError(
        'IMAGE_STORAGE_MISMATCH',
        500,
        'Gambar tersimpan tidak sesuai.',
      );
    }
    return { bytes, mimeType: String(row.mime_type) };
  }
}
