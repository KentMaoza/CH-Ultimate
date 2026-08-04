import { hexToUuid } from '../auth/mariadb-row-utils.js';
import { CatalogueOperationError } from '../catalogue/mariadb-sku-operations-repository.js';
import {
  writeOperationAudit,
  writeOperationChange,
} from '../catalogue/mariadb-operation-writes.js';
import { mutationBody } from '../nota/mariadb-nota-shared.js';
import type { ProtocolConnection } from '../sync/idempotency.js';
import type { OfflineRepository } from './service.js';
import type { OfflineStockRequest } from './validation.js';

export interface OfflineStockDependencies {
  uuid(): string;
  now(): Date;
}

export const adjustOfflineStock = async (
  connection: ProtocolConnection,
  deviceId: string,
  operationId: string,
  input: OfflineStockRequest,
  dependencies: OfflineStockDependencies,
): ReturnType<OfflineRepository['adjustStock']> => {
  const skuRows = await connection.query<
    Array<{ id_hex: unknown; archived_at: unknown }>
  >(
    `SELECT HEX(id) AS id_hex, archived_at
     FROM skus
     WHERE id = UNHEX(REPLACE(?, '-', ''))
     FOR UPDATE`,
    [input.skuId],
  );
  const sku = skuRows[0];
  if (!sku || hexToUuid(sku.id_hex) !== input.skuId) {
    throw new CatalogueOperationError(
      'SKU_MISSING',
      409,
      'Captured SKU no longer exists',
    );
  }
  const balances = await connection.query<
    Array<{ quantity_pcs: unknown; row_version: unknown }>
  >(
    `SELECT quantity_pcs, row_version
     FROM stock_balances
     WHERE sku_id = UNHEX(REPLACE(?, '-', ''))
     FOR UPDATE`,
    [input.skuId],
  );
  const balance = balances[0];
  if (!balance) {
    throw new CatalogueOperationError(
      'STOCK_NOT_TRACKED',
      409,
      'Captured SKU stock is not tracked',
    );
  }
  const before = BigInt(String(balance.quantity_pcs));
  const after = before + BigInt(input.delta);
  if (
    after < BigInt(Number.MIN_SAFE_INTEGER) ||
    after > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new CatalogueOperationError(
      'STOCK_OUT_OF_RANGE',
      422,
      'Stock result exceeds safe integer range',
    );
  }
  const version = BigInt(String(balance.row_version)) + 1n;
  const now = dependencies.now();
  const movementId = dependencies.uuid();
  await connection.query(
    `UPDATE stock_balances
     SET quantity_pcs = quantity_pcs + ?, row_version = row_version + 1,
         updated_at = ?
     WHERE sku_id = UNHEX(REPLACE(?, '-', ''))`,
    [input.delta, now, input.skuId],
  );
  await connection.query(
    `INSERT INTO stock_movements
       (id, sku_id, delta_pcs, reason, device_id, operation_id,
        balance_row_version_after, created_at)
     VALUES
       (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?, ?,
        UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?, ?)`,
    [
      movementId,
      input.skuId,
      input.delta,
      input.reason,
      deviceId,
      operationId,
      version,
      now,
    ],
  );
  if (sku.archived_at) {
    await writeOperationAudit(
      connection,
      deviceId,
      'offline.stock.sku_archived_snapshot',
      'stock_balance',
      input.skuId,
      { warning: true, capturedSnapshot: input },
      now,
    );
  }
  await writeOperationAudit(
    connection,
    deviceId,
    'offline.stock.adjust',
    'stock_balance',
    input.skuId,
    {
      deltaPcs: input.delta,
      reason: input.reason,
      capturedIdentifier: input.skuIdentifier,
      capturedName: input.skuName,
      capturedPrice: input.referencePrice,
      before: before.toString(),
      after: after.toString(),
    },
    now,
  );
  const entity = {
    skuId: input.skuId,
    quantityPcs: after.toString(),
    rowVersion: version.toString(),
    updatedAt: now.toISOString(),
  };
  let revision = await writeOperationChange(
    connection,
    'stock_balance',
    input.skuId,
    entity,
    now,
  );
  revision = await writeOperationChange(
    connection,
    'stock_movement',
    movementId,
    {
      id: movementId,
      skuId: input.skuId,
      deltaPcs: String(input.delta),
      reason: input.reason,
      deviceId,
      operationId,
      balanceRowVersionAfter: version.toString(),
      createdAt: now.toISOString(),
      beforeQuantityPcs: before.toString(),
      afterQuantityPcs: after.toString(),
    },
    now,
  );
  return mutationBody(revision, version.toString(), entity);
};
