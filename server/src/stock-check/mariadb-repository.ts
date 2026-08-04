import { randomUUID } from 'node:crypto';

import { hexToUuid } from '../auth/mariadb-row-utils.js';
import { CatalogueOperationError } from '../catalogue/mariadb-sku-operations-repository.js';
import {
  writeOperationAudit,
  writeOperationChange,
} from '../catalogue/mariadb-operation-writes.js';
import type { IdempotentMutation, ProtocolConnection } from '../sync/idempotency.js';
import type { StockCheckRequest } from './validation.js';

export interface StockCheckDevice {
  deviceId: string;
  deviceDisplayName: string;
}

interface Dependencies {
  uuid(): string;
  now(): Date;
}

const defaults: Dependencies = {
  uuid: randomUUID,
  now: () => new Date(),
};

type QueryConnection = Pick<ProtocolConnection, 'query'>;
type Mutation = IdempotentMutation<Record<string, unknown>>;
const MIN_SAFE_INTEGER = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

export interface StockCheckRepository {
  apply(
    connection: QueryConnection,
    device: StockCheckDevice,
    operationId: string,
    input: StockCheckRequest,
    forcedOffline: boolean,
  ): Promise<Mutation>;
}

export class MariaDbStockCheckRepository implements StockCheckRepository {
  private readonly dependencies: Dependencies;

  constructor(dependencies: Partial<Dependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  async apply(
    connection: QueryConnection,
    device: StockCheckDevice,
    operationId: string,
    input: StockCheckRequest,
    forcedOffline: boolean,
  ): Promise<Mutation> {
    const skuRows = await connection.query<Array<{ id_hex: unknown }>>(
      `SELECT HEX(id) AS id_hex
       FROM skus
       WHERE id = UNHEX(REPLACE(?, '-', '')) AND archived_at IS NULL
       FOR UPDATE`,
      [input.skuId],
    );
    if (!skuRows[0] || hexToUuid(skuRows[0].id_hex) !== input.skuId) {
      throw new CatalogueOperationError('SKU_NOT_ACTIVE', 409, 'SKU is not active');
    }

    const balanceRows = await connection.query<
      Array<{ quantity_pcs: unknown; row_version: unknown }>
    >(
      `SELECT quantity_pcs, row_version
       FROM stock_balances
       WHERE sku_id = UNHEX(REPLACE(?, '-', ''))
       FOR UPDATE`,
      [input.skuId],
    );
    const balance = balanceRows[0];
    if (!balance) {
      throw new CatalogueOperationError(
        'STOCK_NOT_TRACKED',
        409,
        'SKU stock is not tracked',
      );
    }

    const before = BigInt(String(balance.quantity_pcs));
    const priorVersion = BigInt(String(balance.row_version));
    if (
      !forcedOffline &&
      (input.baseBalanceVersion !== priorVersion.toString() ||
        BigInt(input.observedQuantityPcs) !== before)
    ) {
      throw new CatalogueOperationError(
        'STOCK_CHECK_STALE',
        409,
        'Stock changed; refresh and confirm the count again',
      );
    }

    const counted = BigInt(input.countedQuantityPcs);
    const delta = counted - before;
    if (
      before < MIN_SAFE_INTEGER ||
      before > MAX_SAFE_INTEGER ||
      delta < MIN_SAFE_INTEGER ||
      delta > MAX_SAFE_INTEGER
    ) {
      throw new CatalogueOperationError(
        'STOCK_OUT_OF_RANGE',
        422,
        'Stock check exceeds the client safe-integer range',
      );
    }
    const nextVersion = priorVersion + 1n;
    const appliedAt = this.dependencies.now();
    const countedAt = new Date(input.countedAt);
    const checkId = this.dependencies.uuid();
    const note = input.note?.trim() || undefined;

    await connection.query(
      `UPDATE stock_balances
       SET quantity_pcs = ?, row_version = row_version + 1,
           last_checked_at = ?, updated_at = ?
       WHERE sku_id = UNHEX(REPLACE(?, '-', ''))`,
      [counted, countedAt, appliedAt, input.skuId],
    );
    await connection.query(
      `INSERT INTO stock_checks
         (id, sku_id, observed_quantity_pcs, counted_quantity_pcs,
          server_quantity_before_pcs, applied_delta_pcs,
          base_balance_version, balance_row_version_after, forced_offline,
          counted_at, applied_at, device_id, device_display_name,
          operation_id, note)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?, ?, ?, ?,
          ?, ?, ?, ?, ?, UNHEX(REPLACE(?, '-', '')), ?,
          UNHEX(REPLACE(?, '-', '')), ?)`,
      [
        checkId,
        input.skuId,
        BigInt(input.observedQuantityPcs),
        counted,
        before,
        delta,
        input.baseBalanceVersion ?? null,
        nextVersion,
        forcedOffline,
        countedAt,
        appliedAt,
        device.deviceId,
        device.deviceDisplayName,
        operationId,
        note ?? null,
      ],
    );

    let movementId: string | undefined;
    if (delta !== 0n) {
      movementId = this.dependencies.uuid();
      await connection.query(
        `INSERT INTO stock_movements
           (id, sku_id, delta_pcs, reason, device_id, operation_id,
            balance_row_version_after, created_at)
         VALUES
           (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?,
            'stock_check', UNHEX(REPLACE(?, '-', '')),
            UNHEX(REPLACE(?, '-', '')), ?, ?)`,
        [
          movementId,
          input.skuId,
          delta,
          device.deviceId,
          operationId,
          nextVersion,
          appliedAt,
        ],
      );
    }

    const entity = {
      id: checkId,
      skuId: input.skuId,
      observedQuantityPcs: String(input.observedQuantityPcs),
      countedQuantityPcs: counted.toString(),
      serverQuantityBeforePcs: before.toString(),
      appliedDeltaPcs: delta.toString(),
      ...(input.baseBalanceVersion
        ? { baseBalanceVersion: input.baseBalanceVersion }
        : {}),
      forcedOffline,
      countedAt: countedAt.toISOString(),
      appliedAt: appliedAt.toISOString(),
      deviceId: device.deviceId,
      deviceDisplayName: device.deviceDisplayName,
      ...(note ? { note } : {}),
    };
    const balanceEntity = {
      skuId: input.skuId,
      quantityPcs: counted.toString(),
      rowVersion: nextVersion.toString(),
      lastCheckedAt: countedAt.toISOString(),
      updatedAt: appliedAt.toISOString(),
    };

    await writeOperationAudit(
      connection,
      device.deviceId,
      forcedOffline ? 'stock.check.offline_force' : 'stock.check.online',
      'stock_check',
      checkId,
      entity,
      appliedAt,
    );
    let revision = await writeOperationChange(
      connection,
      'stock_balance',
      input.skuId,
      balanceEntity,
      appliedAt,
    );
    if (movementId) {
      revision = await writeOperationChange(
        connection,
        'stock_movement',
        movementId,
        {
          id: movementId,
          skuId: input.skuId,
          deltaPcs: delta.toString(),
          reason: 'stock_check',
          deviceId: device.deviceId,
          operationId,
          balanceRowVersionAfter: nextVersion.toString(),
          createdAt: appliedAt.toISOString(),
          beforeQuantityPcs: before.toString(),
          afterQuantityPcs: counted.toString(),
        },
        appliedAt,
      );
    }
    revision = await writeOperationChange(
      connection,
      'stock_check',
      checkId,
      entity,
      appliedAt,
    );

    return {
      statusCode: 200,
      body: {
        apiSchemaVersion: 2,
        serverRevision: revision,
        entityVersion: nextVersion.toString(),
        entity,
      },
      audits: [],
      changes: [],
    };
  }
}
