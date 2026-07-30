import { databaseDate, hexToUuid } from '../auth/mariadb-row-utils.js';
import type { ProtocolConnection } from '../sync/idempotency.js';
import { identifierHash } from './catalogue-writer.js';
import {
  CatalogueOperationError,
  identifierPayload,
  type IdentifierRow,
  type SkuRepositoryDependencies,
  type SkuRow,
} from './sku-operation-payloads.js';

type QueryConnection = Pick<ProtocolConnection, 'query'>;

export interface IdentifierChange {
  id: string;
  payload: Record<string, unknown>;
}

export async function findIdentifier(
  connection: QueryConnection,
  hash: Buffer,
): Promise<IdentifierRow | undefined> {
  const rows = await connection.query<IdentifierRow[]>(
    `SELECT HEX(sku_id) AS sku_id_hex, HEX(id) AS id_hex,
            identifier_value, identifier_kind, created_at
     FROM sku_identifiers
     WHERE identifier_hash = ?
     FOR UPDATE`,
    [hash],
  );
  return rows[0];
}

export async function assertIdentifierAvailable(
  connection: QueryConnection,
  hash: Buffer,
): Promise<void> {
  if (await findIdentifier(connection, hash)) {
    throw new CatalogueOperationError(
      'IDENTIFIER_CONFLICT',
      409,
      'Identifier already exists',
    );
  }
}

export async function replacePrimaryIdentifier(
  connection: QueryConnection,
  dependencies: SkuRepositoryDependencies,
  skuId: string,
  nextNumber: string,
  now: Date,
): Promise<IdentifierChange[]> {
  const nextHash = identifierHash(nextNumber);
  const target = await findIdentifier(connection, nextHash);
  if (target && hexToUuid(target.sku_id_hex) !== skuId) {
    throw new CatalogueOperationError(
      'IDENTIFIER_CONFLICT',
      409,
      'Identifier already exists',
    );
  }
  const primary =
    target?.identifier_kind === 'primary'
      ? target
      : (
          await connection.query<
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
          )
        )[0];
  if (!primary) throw new Error('SKU primary identifier is unavailable');

  const primaryId = hexToUuid(primary.id_hex);
  const targetId = target ? hexToUuid(target.id_hex) : undefined;
  if (targetId === primaryId) {
    await connection.query(
      `UPDATE sku_identifiers
       SET identifier_value = ?, identifier_hash = ?,
           identifier_kind = 'primary'
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [nextNumber, nextHash, targetId],
    );
    return [
      {
        id: targetId,
        payload: identifierPayload(
          targetId,
          skuId,
          nextNumber,
          'primary',
          databaseDate(target!.created_at),
        ),
      },
    ];
  }

  await connection.query(
    `UPDATE sku_identifiers
     SET identifier_kind = 'alias'
     WHERE id = UNHEX(REPLACE(?, '-', ''))`,
    [primaryId],
  );
  const promotedId = targetId ?? dependencies.uuid();
  if (target) {
    await connection.query(
      `UPDATE sku_identifiers
       SET identifier_value = ?, identifier_hash = ?,
           identifier_kind = 'primary'
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [nextNumber, nextHash, promotedId],
    );
  } else {
    await connection.query(
      `INSERT INTO sku_identifiers
         (id, sku_id, identifier_value, identifier_hash, identifier_kind,
          created_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
          ?, ?, 'primary', ?)`,
      [promotedId, skuId, nextNumber, nextHash, now],
    );
  }
  return [
    {
      id: primaryId,
      payload: identifierPayload(
        primaryId,
        skuId,
        String(primary.identifier_value),
        'alias',
        databaseDate(primary.created_at),
      ),
    },
    {
      id: promotedId,
      payload: identifierPayload(
        promotedId,
        skuId,
        nextNumber,
        'primary',
        target ? databaseDate(target.created_at) : now,
      ),
    },
  ];
}

export async function readSkuForUpdate(
  connection: QueryConnection,
  skuId: string,
): Promise<SkuRow | undefined> {
  const rows = await connection.query<SkuRow[]>(
    `SELECT HEX(id) AS id_hex, primary_identifier, name, price_rupiah,
            image_hash, source_image_url, source_note, row_version,
            archived_at, created_at, updated_at
     FROM skus
     WHERE id = UNHEX(REPLACE(?, '-', ''))
     FOR UPDATE`,
    [skuId],
  );
  return rows[0];
}

export async function requireActiveSku(
  connection: QueryConnection,
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
