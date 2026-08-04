import { randomUUID } from 'node:crypto';

import { hexToUuid } from '../auth/mariadb-row-utils.js';
import type { IdempotentMutation, ProtocolConnection } from '../sync/idempotency.js';
import {
  CatalogueOperationError,
} from './mariadb-sku-operations-repository.js';
import {
  writeOperationAudit,
  writeOperationChange,
} from './mariadb-operation-writes.js';
import type { StockAdjustmentRequest } from './operations-validation.js';

interface RepositoryDependencies {
  uuid(): string;
  now(): Date;
}

const defaults: RepositoryDependencies = {
  uuid: randomUUID,
  now: () => new Date(),
};

export class MariaDbStockOperationsRepository {
  private readonly dependencies: RepositoryDependencies;

  constructor(dependencies: Partial<RepositoryDependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  async adjust(
    connection: Pick<ProtocolConnection, 'query'>,
    deviceId: string,
    operationId: string,
    skuId: string,
    input: StockAdjustmentRequest,
  ): Promise<IdempotentMutation<Record<string, unknown>>> {
    const skuRows = await connection.query<Array<{ id_hex: unknown }>>(
      `SELECT HEX(id) AS id_hex
       FROM skus
       WHERE id = UNHEX(REPLACE(?, '-', '')) AND archived_at IS NULL
       FOR UPDATE`,
      [skuId],
    );
    if (!skuRows[0] || hexToUuid(skuRows[0].id_hex) !== skuId) {
      throw new CatalogueOperationError(
        'SKU_NOT_ACTIVE',
        409,
        'SKU is not active',
      );
    }
    const balanceRows = await connection.query<
      Array<{ quantity_pcs: unknown; row_version: unknown }>
    >(
      `SELECT quantity_pcs, row_version
       FROM stock_balances
       WHERE sku_id = UNHEX(REPLACE(?, '-', ''))
       FOR UPDATE`,
      [skuId],
    );
    const current = balanceRows[0];
    if (!current) {
      throw new CatalogueOperationError(
        'STOCK_NOT_TRACKED',
        409,
        'SKU stock is not tracked',
      );
    }
    const quantity = BigInt(String(current.quantity_pcs));
    const version = BigInt(String(current.row_version));
    const nextQuantity = quantity + BigInt(input.delta);
    const nextVersion = version + 1n;
    const now = this.dependencies.now();
    const movementId = this.dependencies.uuid();

    await connection.query(
      `UPDATE stock_balances
       SET quantity_pcs = quantity_pcs + ?, row_version = row_version + 1,
           updated_at = ?
       WHERE sku_id = UNHEX(REPLACE(?, '-', ''))`,
      [input.delta, now, skuId],
    );
    await connection.query(
      `INSERT INTO stock_movements
         (id, sku_id, delta_pcs, reason, device_id, operation_id,
          balance_row_version_after, created_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?,
          'manual_adjustment', UNHEX(REPLACE(?, '-', '')),
          UNHEX(REPLACE(?, '-', '')), ?, ?)`,
      [
        movementId,
        skuId,
        input.delta,
        deviceId,
        operationId,
        nextVersion,
        now,
      ],
    );
    await writeOperationAudit(
      connection,
      deviceId,
      'stock.adjust',
      'stock_balance',
      skuId,
      {
        deltaPcs: input.delta,
        before: quantity.toString(),
        after: nextQuantity.toString(),
      },
      now,
    );
    const entity = {
      skuId,
      quantityPcs: nextQuantity.toString(),
      rowVersion: nextVersion.toString(),
      updatedAt: now.toISOString(),
    };
    let revision = await writeOperationChange(
      connection,
      'stock_balance',
      skuId,
      entity,
      now,
    );
    revision = await writeOperationChange(
      connection,
      'stock_movement',
      movementId,
      {
        id: movementId,
        skuId,
        deltaPcs: input.delta.toString(),
        reason: 'manual_adjustment',
        deviceId,
        operationId,
        balanceRowVersionAfter: nextVersion.toString(),
        createdAt: now.toISOString(),
        beforeQuantityPcs: quantity.toString(),
        afterQuantityPcs: nextQuantity.toString(),
      },
      now,
    );
    return {
      statusCode: 200,
      body: {
        serverRevision: revision,
        entityVersion: nextVersion.toString(),
        entity,
      },
      audits: [],
      changes: [],
    };
  }
}
