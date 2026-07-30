import { randomUUID } from 'node:crypto';

import { databaseDate, hexToUuid, nullableDatabaseDate } from '../auth/mariadb-row-utils.js';
import type { IdempotentMutation, ProtocolConnection } from '../sync/idempotency.js';
import type {
  CreateSkuRequest,
  UpdateSkuRequest,
} from './operations-validation.js';
import { identifierHash } from './catalogue-writer.js';
import {
  writeOperationAudit,
  writeOperationChange,
} from './mariadb-operation-writes.js';

export class CatalogueOperationError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'CatalogueOperationError';
  }
}

export interface CatalogueConflict {
  id: string;
  entityType: string;
  entityId: string;
  base: unknown;
  mine: unknown;
  server: unknown;
}

export class CatalogueConflictError extends CatalogueOperationError {
  constructor(readonly conflict: CatalogueConflict) {
    super('CONFLICT', 409, 'Stale row version');
    this.name = 'CatalogueConflictError';
  }
}

interface SkuRow extends Record<string, unknown> {
  id_hex: unknown;
  primary_identifier: unknown;
  name: unknown;
  price_rupiah: unknown;
  source_image_url: unknown;
  source_note: unknown;
  row_version: unknown;
  archived_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface RepositoryDependencies {
  uuid(): string;
  now(): Date;
}

const defaults: RepositoryDependencies = {
  uuid: randomUUID,
  now: () => new Date(),
};

function skuPayload(
  id: string,
  values: {
    skuNumber: string;
    name: string;
    referencePrice: number;
    note: string;
    imageUrl: string;
    rowVersion: string;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
  },
) {
  return {
    id,
    primaryIdentifier: values.skuNumber,
    name: values.name,
    priceRupiah: values.referencePrice.toString(),
    imageHash: null,
    sourceImageUrl: values.imageUrl || null,
    sourceNote: values.note,
    sourceCreatedAt: '',
    rowVersion: values.rowVersion,
    archivedAt: values.archivedAt,
    createdAt: values.createdAt,
    updatedAt: values.updatedAt,
  };
}

function identifierPayload(
  id: string,
  skuId: string,
  value: string,
  kind: string,
  now: Date,
) {
  return {
    id,
    skuId,
    identifierValue: value,
    identifierKind: kind,
    createdAt: now.toISOString(),
  };
}

function balancePayload(skuId: string, quantity: number, now: Date) {
  return {
    skuId,
    quantityPcs: quantity.toString(),
    rowVersion: '1',
    updatedAt: now.toISOString(),
  };
}

export class MariaDbSkuOperationsRepository {
  private readonly dependencies: RepositoryDependencies;

  constructor(dependencies: Partial<RepositoryDependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  async create(
    connection: Pick<ProtocolConnection, 'query'>,
    deviceId: string,
    input: CreateSkuRequest,
  ): Promise<IdempotentMutation<Record<string, unknown>>> {
    const now = this.dependencies.now();
    const skuId = this.dependencies.uuid();
    const identifierId = this.dependencies.uuid();
    const priceHistoryId = this.dependencies.uuid();
    const balanceId = input.tracked ? skuId : null;
    const hash = identifierHash(input.skuNumber);
    await this.assertIdentifierAvailable(connection, hash);

    await connection.query(
      `INSERT INTO skus
         (id, primary_identifier, name, price_rupiah, source_image_url,
          source_note, row_version, created_at, updated_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), ?, ?, ?, NULLIF(?, ''), ?, 1, ?, ?)`,
      [
        skuId,
        input.skuNumber,
        input.name,
        input.referencePrice,
        input.imageUrl ?? '',
        input.note ?? '',
        now,
        now,
      ],
    );
    await connection.query(
      `INSERT INTO sku_identifiers
         (id, sku_id, identifier_value, identifier_hash, identifier_kind,
          created_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
          ?, ?, 'primary', ?)`,
      [identifierId, skuId, input.skuNumber, hash, now],
    );
    if (balanceId) {
      await connection.query(
        `INSERT INTO stock_balances
           (sku_id, quantity_pcs, row_version, updated_at)
         VALUES (UNHEX(REPLACE(?, '-', '')), ?, 1, ?)`,
        [skuId, input.openingStock, now],
      );
    }
    await connection.query(
      `INSERT INTO price_history
         (id, sku_id, price_rupiah, source, changed_by_device_id, effective_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?,
          'manual', UNHEX(REPLACE(?, '-', '')), ?)`,
      [priceHistoryId, skuId, input.referencePrice, deviceId, now],
    );
    await writeOperationAudit(
      connection,
      deviceId,
      'sku.create',
      'sku',
      skuId,
      { primaryIdentifier: input.skuNumber },
      now,
    );

    const payload = skuPayload(skuId, {
      skuNumber: input.skuNumber,
      name: input.name,
      referencePrice: input.referencePrice,
      note: input.note ?? '',
      imageUrl: input.imageUrl ?? '',
      rowVersion: '1',
      archivedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    let revision = await writeOperationChange(
      connection,
      'sku',
      skuId,
      payload,
      now,
    );
    revision = await writeOperationChange(
      connection,
      'sku_identifier',
      identifierId,
      identifierPayload(identifierId, skuId, input.skuNumber, 'primary', now),
      now,
    );
    if (balanceId) {
      revision = await writeOperationChange(
        connection,
        'stock_balance',
        skuId,
        balancePayload(skuId, input.openingStock, now),
        now,
      );
    }
    revision = await writeOperationChange(
      connection,
      'price_history',
      priceHistoryId,
      {
        id: priceHistoryId,
        skuId,
        priceRupiah: input.referencePrice.toString(),
        beforePriceRupiah: input.referencePrice.toString(),
        source: 'manual',
        changedByDeviceId: deviceId,
        effectiveAt: now.toISOString(),
      },
      now,
    );
    return {
      statusCode: 201,
      body: {
        serverRevision: revision,
        entityVersion: '1',
        entity: {
          id: skuId,
          skuNumber: input.skuNumber,
          aliases: [],
          name: input.name,
          referencePrice: input.referencePrice,
          stock: input.openingStock,
          tracked: input.tracked,
          note: input.note ?? '',
          imageUrl: input.imageUrl ?? '',
          createdAt: now.toISOString(),
          archived: false,
        },
      },
      audits: [],
      changes: [],
    };
  }

  async update(
    connection: Pick<ProtocolConnection, 'query'>,
    deviceId: string,
    skuId: string,
    input: UpdateSkuRequest,
  ): Promise<IdempotentMutation<Record<string, unknown>>> {
    const current = await this.readSkuForUpdate(connection, skuId);
    if (!current) {
      throw new CatalogueOperationError('SKU_NOT_FOUND', 404, 'SKU not found');
    }
    const currentVersion = BigInt(String(current.row_version));
    if (currentVersion.toString() !== input.rowVersion) {
      throw new CatalogueConflictError({
        id: this.dependencies.uuid(),
        entityType: 'sku',
        entityId: skuId,
        base: { rowVersion: input.rowVersion },
        mine: input.patch,
        server: {
          name: String(current.name),
          skuNumber: String(current.primary_identifier),
          referencePrice: Number(current.price_rupiah),
          note: String(current.source_note ?? ''),
          imageUrl: String(current.source_image_url ?? ''),
          archived: current.archived_at !== null,
          rowVersion: currentVersion.toString(),
        },
      });
    }

    const now = this.dependencies.now();
    const nextVersion = (currentVersion + 1n).toString();
    const nextNumber = input.patch.skuNumber ?? String(current.primary_identifier);
    const nextName = input.patch.name ?? String(current.name);
    const nextPrice =
      input.patch.referencePrice ?? Number(current.price_rupiah);
    const nextNote = input.patch.note ?? String(current.source_note ?? '');
    const nextImage =
      input.patch.imageUrl ?? String(current.source_image_url ?? '');
    const currentArchived = nullableDatabaseDate(current.archived_at);
    const nextArchived =
      input.patch.archived === undefined
        ? currentArchived?.toISOString() ?? null
        : input.patch.archived
          ? now.toISOString()
          : null;
    let priceHistoryId: string | undefined;
    let newIdentifier:
      | { id: string; value: string; payload: Record<string, unknown> }
      | undefined;
    let previousIdentifier:
      | { id: string; value: string; createdAt: string }
      | undefined;
    if (nextNumber !== String(current.primary_identifier)) {
      await this.assertIdentifierAvailable(connection, identifierHash(nextNumber), skuId);
      const primaryRows = await connection.query<
        Array<{
          id_hex: unknown;
          identifier_value: unknown;
          created_at: unknown;
        }>
      >(
        `SELECT HEX(id) AS id_hex, identifier_value, created_at
         FROM sku_identifiers
         WHERE sku_id = UNHEX(REPLACE(?, '-', ''))
           AND identifier_kind = 'primary'
         FOR UPDATE`,
        [skuId],
      );
      const primary = primaryRows[0];
      if (!primary) {
        throw new Error('SKU primary identifier is unavailable');
      }
      previousIdentifier = {
        id: hexToUuid(primary.id_hex),
        value: String(primary.identifier_value),
        createdAt: databaseDate(primary.created_at).toISOString(),
      };
      const id = this.dependencies.uuid();
      newIdentifier = {
        id,
        value: nextNumber,
        payload: identifierPayload(id, skuId, nextNumber, 'primary', now),
      };
      await connection.query(
        `UPDATE sku_identifiers
         SET identifier_kind = ?
         WHERE sku_id = UNHEX(REPLACE(?, '-', ''))
           AND identifier_kind = 'primary'`,
        ['alias', skuId],
      );
      await connection.query(
        `INSERT INTO sku_identifiers
           (id, sku_id, identifier_value, identifier_hash, identifier_kind,
            created_at)
         VALUES
           (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
            ?, ?, 'primary', ?)`,
        [id, skuId, nextNumber, identifierHash(nextNumber), now],
      );
    }
    await connection.query(
      `UPDATE skus
       SET primary_identifier = ?, name = ?, price_rupiah = ?,
           source_note = ?, source_image_url = NULLIF(?, ''),
           archived_at = ?, row_version = ?, updated_at = ?
       WHERE id = UNHEX(REPLACE(?, '-', '')) AND row_version = ?`,
      [
        nextNumber,
        nextName,
        nextPrice,
        nextNote,
        nextImage,
        nextArchived === null ? null : now,
        nextVersion,
        now,
        skuId,
        input.rowVersion,
      ],
    );
    if (nextPrice !== Number(current.price_rupiah)) {
      priceHistoryId = this.dependencies.uuid();
      await connection.query(
        `INSERT INTO price_history
           (id, sku_id, price_rupiah, source, changed_by_device_id, effective_at)
         VALUES
           (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?,
            'manual', UNHEX(REPLACE(?, '-', '')), ?)`,
        [priceHistoryId, skuId, nextPrice, deviceId, now],
      );
    }
    await writeOperationAudit(
      connection,
      deviceId,
      'sku.update',
      'sku',
      skuId,
      { rowVersion: nextVersion, fields: Object.keys(input.patch) },
      now,
    );
    const payload = skuPayload(skuId, {
      skuNumber: nextNumber,
      name: nextName,
      referencePrice: nextPrice,
      note: nextNote,
      imageUrl: nextImage,
      rowVersion: nextVersion,
      archivedAt: nextArchived,
      createdAt: databaseDate(current.created_at).toISOString(),
      updatedAt: now.toISOString(),
    });
    let revision = await writeOperationChange(
      connection,
      'sku',
      skuId,
      payload,
      now,
    );
    if (previousIdentifier) {
      revision = await writeOperationChange(
        connection,
        'sku_identifier',
        previousIdentifier.id,
        {
          id: previousIdentifier.id,
          skuId,
          identifierValue: previousIdentifier.value,
          identifierKind: 'alias',
          createdAt: previousIdentifier.createdAt,
        },
        now,
      );
    }
    if (newIdentifier) {
      revision = await writeOperationChange(
        connection,
        'sku_identifier',
        newIdentifier.id,
        newIdentifier.payload,
        now,
      );
    }
    if (priceHistoryId) {
      revision = await writeOperationChange(
        connection,
        'price_history',
        priceHistoryId,
        {
          id: priceHistoryId,
          skuId,
          priceRupiah: nextPrice.toString(),
          beforePriceRupiah: String(current.price_rupiah),
          source: 'manual',
          changedByDeviceId: deviceId,
          effectiveAt: now.toISOString(),
        },
        now,
      );
    }
    return {
      statusCode: 200,
      body: { serverRevision: revision, entityVersion: nextVersion, entity: payload },
      audits: [],
      changes: [],
    };
  }

  async requireActiveSku(
    connection: Pick<ProtocolConnection, 'query'>,
    skuId: string,
  ): Promise<string> {
    const rows = await connection.query<Array<{ id_hex: unknown }>>(
      `SELECT HEX(id) AS id_hex
       FROM skus
       WHERE id = UNHEX(REPLACE(?, '-', '')) AND archived_at IS NULL
       FOR UPDATE`,
      [skuId],
    );
    if (!rows[0]) {
      throw new CatalogueOperationError(
        'SKU_NOT_ACTIVE',
        409,
        'SKU is not active',
      );
    }
    return hexToUuid(rows[0].id_hex);
  }

  private async readSkuForUpdate(
    connection: Pick<ProtocolConnection, 'query'>,
    skuId: string,
  ): Promise<SkuRow | undefined> {
    const rows = await connection.query<SkuRow[]>(
      `SELECT HEX(id) AS id_hex, primary_identifier, name, price_rupiah,
              source_image_url, source_note, row_version, archived_at,
              created_at, updated_at
       FROM skus
       WHERE id = UNHEX(REPLACE(?, '-', ''))
       FOR UPDATE`,
      [skuId],
    );
    return rows[0];
  }

  private async assertIdentifierAvailable(
    connection: Pick<ProtocolConnection, 'query'>,
    hash: Buffer,
    permittedSkuId?: string,
  ): Promise<void> {
    const rows = await connection.query<Array<{ sku_id_hex: unknown }>>(
      `SELECT HEX(sku_id) AS sku_id_hex
       FROM sku_identifiers
       WHERE identifier_hash = ?
       FOR UPDATE`,
      [hash],
    );
    if (
      rows[0] &&
      (!permittedSkuId ||
        hexToUuid(rows[0].sku_id_hex) !== permittedSkuId)
    ) {
      throw new CatalogueOperationError(
        'IDENTIFIER_CONFLICT',
        409,
        'Identifier already exists',
      );
    }
  }
}
