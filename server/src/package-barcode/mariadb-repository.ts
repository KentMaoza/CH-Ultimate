import { randomUUID } from 'node:crypto';

import { databaseDate, hexToUuid } from '../auth/mariadb-row-utils.js';
import { identifierHash } from '../catalogue/catalogue-writer.js';
import { findIdentifier, requireActiveSku } from '../catalogue/mariadb-sku-identifiers.js';
import {
  writeOperationAudit,
  writeOperationChange,
} from '../catalogue/mariadb-operation-writes.js';
import {
  CatalogueOperationError,
  identifierPayload,
  type IdentifierRow,
} from '../catalogue/sku-operation-payloads.js';
import type { IdempotentMutation, ProtocolConnection } from '../sync/idempotency.js';

interface Dependencies {
  uuid(): string;
  now(): Date;
}

const defaults: Dependencies = { uuid: randomUUID, now: () => new Date() };
type QueryConnection = Pick<ProtocolConnection, 'query'>;
type Mutation = IdempotentMutation<Record<string, unknown>>;

export interface PackageBarcodeRepository {
  register(
    connection: QueryConnection,
    deviceId: string,
    skuId: string,
    identifierValue: string,
  ): Promise<Mutation>;
  remove(
    connection: QueryConnection,
    deviceId: string,
    identifierId: string,
  ): Promise<Mutation>;
  reassign(
    connection: QueryConnection,
    deviceId: string,
    identifierId: string,
    skuId: string,
  ): Promise<Mutation>;
}

export class MariaDbPackageBarcodeRepository implements PackageBarcodeRepository {
  private readonly dependencies: Dependencies;

  constructor(dependencies: Partial<Dependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  async register(
    connection: QueryConnection,
    deviceId: string,
    skuId: string,
    rawValue: string,
  ): Promise<Mutation> {
    await requireActiveSku(connection, skuId);
    const identifierValue = rawValue.trim();
    const existing = await findIdentifier(connection, identifierHash(identifierValue));
    if (existing) {
      if (hexToUuid(existing.sku_id_hex) !== skuId) {
        throw new CatalogueOperationError(
          'IDENTIFIER_CONFLICT',
          409,
          'Identifier already exists',
        );
      }
      return this.response(existing);
    }

    const id = this.dependencies.uuid();
    const now = this.dependencies.now();
    await connection.query(
      `INSERT INTO sku_identifiers
         (id, sku_id, identifier_value, identifier_hash, identifier_kind,
          created_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?, ?,
          'package_barcode', ?)`,
      [id, skuId, identifierValue, identifierHash(identifierValue), now],
    );
    const entity = identifierPayload(id, skuId, identifierValue, 'package_barcode', now);
    await writeOperationAudit(
      connection,
      deviceId,
      'package_barcode.register',
      'sku_identifier',
      id,
      entity,
      now,
    );
    await writeOperationChange(connection, 'sku_identifier', id, entity, now);
    return this.mutation(entity);
  }

  async remove(
    connection: QueryConnection,
    deviceId: string,
    identifierId: string,
  ): Promise<Mutation> {
    const existing = await this.requirePackageBarcode(connection, identifierId);
    await requireActiveSku(connection, hexToUuid(existing.sku_id_hex));
    const entity = this.payload(existing);
    const now = this.dependencies.now();
    await connection.query(
      `DELETE FROM sku_identifiers
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [identifierId],
    );
    await writeOperationAudit(
      connection,
      deviceId,
      'package_barcode.remove',
      'sku_identifier',
      identifierId,
      entity,
      now,
    );
    await writeOperationChange(
      connection,
      'sku_identifier',
      identifierId,
      entity,
      now,
      'delete',
    );
    return {
      statusCode: 200,
      body: { apiSchemaVersion: 2, entityId: identifierId },
      audits: [],
      changes: [],
    };
  }

  async reassign(
    connection: QueryConnection,
    deviceId: string,
    identifierId: string,
    skuId: string,
  ): Promise<Mutation> {
    const existing = await this.requirePackageBarcode(connection, identifierId);
    const priorSkuId = hexToUuid(existing.sku_id_hex);
    await requireActiveSku(connection, priorSkuId);
    await requireActiveSku(connection, skuId);
    if (priorSkuId === skuId) return this.response(existing);

    const now = this.dependencies.now();
    await connection.query(
      `UPDATE sku_identifiers
       SET sku_id = UNHEX(REPLACE(?, '-', ''))
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [skuId, identifierId],
    );
    const entity = identifierPayload(
      identifierId,
      skuId,
      String(existing.identifier_value),
      'package_barcode',
      databaseDate(existing.created_at),
    );
    await writeOperationAudit(
      connection,
      deviceId,
      'package_barcode.reassign',
      'sku_identifier',
      identifierId,
      { fromSkuId: priorSkuId, toSkuId: skuId },
      now,
    );
    await writeOperationChange(connection, 'sku_identifier', identifierId, entity, now);
    return this.mutation(entity);
  }

  private async requirePackageBarcode(
    connection: QueryConnection,
    identifierId: string,
  ): Promise<IdentifierRow> {
    const rows = await connection.query<IdentifierRow[]>(
      `SELECT HEX(id) AS id_hex, HEX(sku_id) AS sku_id_hex,
              identifier_value, identifier_kind, created_at
       FROM sku_identifiers
       WHERE id = UNHEX(REPLACE(?, '-', ''))
       FOR UPDATE`,
      [identifierId],
    );
    const row = rows[0];
    if (!row || String(row.identifier_kind) !== 'package_barcode') {
      throw new CatalogueOperationError(
        'PACKAGE_BARCODE_NOT_FOUND',
        404,
        'Package barcode not found',
      );
    }
    return row;
  }

  private payload(row: IdentifierRow): Record<string, unknown> {
    return identifierPayload(
      hexToUuid(row.id_hex),
      hexToUuid(row.sku_id_hex),
      String(row.identifier_value),
      String(row.identifier_kind),
      databaseDate(row.created_at),
    );
  }

  private response(row: IdentifierRow): Mutation {
    return this.mutation(this.payload(row));
  }

  private mutation(entity: Record<string, unknown>): Mutation {
    return {
      statusCode: 200,
      body: {
        apiSchemaVersion: 2,
        entityId: String(entity.id),
        entity,
      },
      audits: [],
      changes: [],
    };
  }
}
