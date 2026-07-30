import { createHash, randomUUID } from 'node:crypto';

import { databaseDate, nullableDatabaseDate } from '../auth/mariadb-row-utils.js';
import type {
  IdempotentMutation,
  ProtocolConnection,
} from '../sync/idempotency.js';
import { readSkuForUpdate } from './mariadb-sku-identifiers.js';
import {
  writeOperationAudit,
  writeOperationChange,
} from './mariadb-operation-writes.js';
import {
  CatalogueConflictError,
  CatalogueOperationError,
  skuPayload,
} from './sku-operation-payloads.js';

export interface SkuImageWriteStorage {
  writeImage(hash: string, bytes: Buffer): Promise<string>;
}

export interface SkuImageReplacement {
  rowVersion: string;
  base: {
    imageHash: string | null;
    sourceImageUrl: string | null;
  };
  bytes: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

interface Dependencies {
  uuid(): string;
  now(): Date;
}

const defaults: Dependencies = {
  uuid: randomUUID,
  now: () => new Date(),
};

export class MariaDbSkuImageOperationsRepository {
  private readonly dependencies: Dependencies;

  constructor(
    private readonly storage: SkuImageWriteStorage,
    dependencies: Partial<Dependencies> = {},
  ) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  async replace(
    connection: Pick<ProtocolConnection, 'query'>,
    deviceId: string,
    skuId: string,
    input: SkuImageReplacement,
  ): Promise<IdempotentMutation<Record<string, unknown>>> {
    const current = await readSkuForUpdate(connection, skuId);
    if (!current) {
      throw new CatalogueOperationError('SKU_NOT_FOUND', 404, 'SKU not found');
    }
    const currentVersion = BigInt(String(current.row_version)).toString();
    const hash = createHash('sha256').update(input.bytes).digest('hex');
    if (currentVersion !== input.rowVersion) {
      throw new CatalogueConflictError({
        id: this.dependencies.uuid(),
        entityType: 'sku',
        entityId: skuId,
        base: input.base,
        mine: { imageHash: hash, sourceImageUrl: null },
        server: {
          imageHash:
            current.image_hash === null || current.image_hash === undefined
              ? null
              : Buffer.from(current.image_hash as Uint8Array).toString('hex'),
          sourceImageUrl:
            current.source_image_url === null
              ? null
              : String(current.source_image_url),
          rowVersion: currentVersion,
        },
      });
    }

    const storagePath = await this.storage.writeImage(hash, input.bytes);
    await connection.query(
      `INSERT INTO image_assets
         (content_hash, mime_type, byte_size, width, height, storage_path)
       VALUES (UNHEX(?), ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE content_hash = VALUES(content_hash)`,
      [
        hash,
        input.mimeType,
        input.bytes.length,
        input.width,
        input.height,
        storagePath,
      ],
    );
    const now = this.dependencies.now();
    const nextVersion = (BigInt(currentVersion) + 1n).toString();
    await connection.query(
      `UPDATE skus
       SET image_hash = UNHEX(?), source_image_url = NULL,
           row_version = ?, updated_at = ?
       WHERE id = UNHEX(REPLACE(?, '-', '')) AND row_version = ?`,
      [hash, nextVersion, now, skuId, currentVersion],
    );
    await writeOperationAudit(
      connection,
      deviceId,
      'sku.image.replace',
      'sku',
      skuId,
      { imageHash: hash, rowVersion: nextVersion },
      now,
    );
    const entity = skuPayload(skuId, {
      skuNumber: String(current.primary_identifier),
      name: String(current.name),
      referencePrice: Number(current.price_rupiah),
      note: String(current.source_note ?? ''),
      imageHash: hash,
      sourceImageUrl: null,
      rowVersion: nextVersion,
      archivedAt:
        nullableDatabaseDate(current.archived_at)?.toISOString() ?? null,
      createdAt: databaseDate(current.created_at).toISOString(),
      updatedAt: now.toISOString(),
    });
    const revision = await writeOperationChange(
      connection,
      'sku',
      skuId,
      entity,
      now,
    );
    return {
      statusCode: 200,
      body: {
        serverRevision: revision,
        entityVersion: nextVersion,
        entity,
      },
      audits: [],
      changes: [],
    };
  }
}
