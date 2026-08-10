import { createHash } from 'node:crypto';

import type { ProtocolConnection } from '../sync/idempotency.js';
import type { CatalogueImportRecord } from './service.js';
import type { CatalogueRow } from './workbook.js';

const BULK_ROWS = 100;

export interface PreparedCatalogueRow {
  source: CatalogueRow;
  skuId: string;
  primaryIdentifierId: string;
  productIdentifierId: string;
  imageJobId: string | null;
  priceHistoryId: string;
  stockMovementId: string;
  existingSku: {
    rowVersion: string;
    priceRupiah: string;
    balanceRowVersion: string | null;
    quantityPcs: string | null;
    createdAt: string;
    imageHash: string | null;
  } | null;
  existingPrimaryIdentifier: boolean;
  existingProductIdentifier: boolean;
  primaryIdentifierCreatedAt: string | null;
  productIdentifierCreatedAt: string | null;
  demotedPrimaryIdentifiers: Array<{
    id: string;
    value: string;
    createdAt: string;
  }>;
}

export interface CatalogueWriteSummary {
  stockAdjustedCount: number;
  zeroDeltaMatchedCount: number;
}

export function normalizeIdentifier(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('id-ID');
}

export function identifierHash(value: string): Buffer {
  return createHash('sha256')
    .update(normalizeIdentifier(value), 'utf8')
    .digest();
}

function placeholders(rows: number, columns: string): string {
  return Array.from({ length: rows }, () => `(${columns})`).join(', ');
}

async function insertChunks<T>(
  connection: ProtocolConnection,
  table: string,
  columns: string,
  rowPlaceholders: string,
  rows: T[],
  values: (row: T) => readonly unknown[],
  suffix = '',
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += BULK_ROWS) {
    const chunk = rows.slice(offset, offset + BULK_ROWS);
    await connection.query(
      `INSERT INTO ${table} (${columns})
       VALUES ${placeholders(chunk.length, rowPlaceholders)}${suffix}`,
      chunk.flatMap((row) => [...values(row)]),
    );
  }
}

function skuPayload(row: PreparedCatalogueRow, committedAt: Date) {
  const rowVersion = row.existingSku
    ? (BigInt(row.existingSku.rowVersion) + 1n).toString()
    : '1';
  return {
    id: row.skuId,
    primaryIdentifier: row.source.primarySku,
    name: row.source.name,
    priceRupiah: row.source.selectedPrice.toString(),
    imageHash: row.existingSku?.imageHash ?? null,
    sourceImageUrl: row.source.imageSourceUrl,
    sourceNote: row.source.note,
    sourceCreatedAt: row.source.sourceCreatedAt,
    rowVersion,
    archivedAt: null,
    createdAt: row.existingSku?.createdAt ?? committedAt.toISOString(),
    updatedAt: committedAt.toISOString(),
  };
}

function identifierPayload(
  id: string,
  row: PreparedCatalogueRow,
  value: string,
  kind: string,
  committedAt: Date,
  existingCreatedAt: string | null,
) {
  return {
    id,
    skuId: row.skuId,
    identifierValue: value,
    identifierKind: kind,
    createdAt: existingCreatedAt ?? committedAt.toISOString(),
  };
}

function balancePayload(
  row: PreparedCatalogueRow,
  committedAt: Date,
  rowVersion: string,
) {
  return {
    skuId: row.skuId,
    quantityPcs: row.source.stockPcs.toString(),
    rowVersion,
    updatedAt: committedAt.toISOString(),
  };
}

export async function insertCatalogue(
  connection: ProtocolConnection,
  record: CatalogueImportRecord,
  rows: PreparedCatalogueRow[],
  committedAt: Date,
): Promise<CatalogueWriteSummary> {
  const newRows = rows.filter((row) => row.existingSku === null);
  const matchedRows = rows.filter((row) => row.existingSku !== null);
  await insertChunks(
    connection,
    'skus',
    `id, primary_identifier, name, price_rupiah, source_image_url,
     source_import_id, source_note, source_created_at, created_at, updated_at`,
    `UNHEX(REPLACE(?, '-', '')), ?, ?, ?, ?,
     UNHEX(REPLACE(?, '-', '')), ?, ?, ?, ?`,
    newRows,
    (row) => [
      row.skuId,
      row.source.primarySku,
      row.source.name,
      row.source.selectedPrice,
      row.source.imageSourceUrl,
      record.id,
      row.source.note,
      row.source.sourceCreatedAt,
      committedAt,
      committedAt,
    ],
  );
  for (const row of matchedRows) {
    await connection.query(
      `UPDATE skus
       SET primary_identifier = ?, name = ?, price_rupiah = ?,
           source_image_url = ?, source_import_id = UNHEX(REPLACE(?, '-', '')),
           source_note = ?, source_created_at = ?, row_version = row_version + 1,
           archived_at = NULL, updated_at = ?
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [
        row.source.primarySku,
        row.source.name,
        row.source.selectedPrice,
        row.source.imageSourceUrl,
        record.id,
        row.source.note,
        row.source.sourceCreatedAt,
        committedAt,
        row.skuId,
      ],
    );
  }
  const identifiers = rows.flatMap((row) => [
    {
      id: row.primaryIdentifierId,
      row,
      value: row.source.primarySku,
      kind: 'primary',
    },
    {
      id: row.productIdentifierId,
      row,
      value: row.source.productCode,
      kind: 'product_code',
    },
  ]);
  const legacyPrimaryIdentifiers = rows.flatMap((row) =>
    row.demotedPrimaryIdentifiers
      .filter(
        (identifier) =>
          identifier.id !== row.primaryIdentifierId &&
          identifier.id !== row.productIdentifierId,
      )
      .map((identifier) => ({ row, identifier })),
  );
  for (const { row, identifier } of legacyPrimaryIdentifiers) {
    await connection.query(
      `UPDATE sku_identifiers
       SET identifier_kind = 'alias'
       WHERE id = UNHEX(REPLACE(?, '-', ''))
         AND sku_id = UNHEX(REPLACE(?, '-', ''))
         AND identifier_kind = 'primary'`,
      [identifier.id, row.skuId],
    );
  }
  const newIdentifiers = identifiers.filter((identifier) =>
    identifier.kind === 'primary'
      ? !identifier.row.existingPrimaryIdentifier
      : !identifier.row.existingProductIdentifier,
  );
  await insertChunks(
    connection,
    'sku_identifiers',
    `id, sku_id, identifier_value, identifier_hash, identifier_kind,
     created_at`,
    `UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
     ?, ?, ?, ?`,
    newIdentifiers,
    (identifier) => [
      identifier.id,
      identifier.row.skuId,
      identifier.value,
      identifierHash(identifier.value),
      identifier.kind,
      committedAt,
    ],
  );
  for (const identifier of identifiers) {
    const existing =
      identifier.kind === 'primary'
        ? identifier.row.existingPrimaryIdentifier
        : identifier.row.existingProductIdentifier;
    if (!existing) continue;
    await connection.query(
      `UPDATE sku_identifiers
       SET identifier_value = ?, identifier_hash = ?, identifier_kind = ?
       WHERE id = UNHEX(REPLACE(?, '-', ''))
         AND sku_id = UNHEX(REPLACE(?, '-', ''))`,
      [
        identifier.value,
        identifierHash(identifier.value),
        identifier.kind,
        identifier.id,
        identifier.row.skuId,
      ],
    );
  }
  await insertChunks(
    connection,
    'stock_balances',
    'sku_id, quantity_pcs, row_version, updated_at',
    `UNHEX(REPLACE(?, '-', '')), ?, 1, ?`,
    newRows,
    (row) => [row.skuId, row.source.stockPcs, committedAt],
  );
  const stockAdjustments = matchedRows.flatMap((row) => {
    const before = BigInt(row.existingSku!.quantityPcs!);
    const after = BigInt(row.source.stockPcs);
    const delta = after - before;
    if (delta === 0n) return [];
    return [
      {
        row,
        before,
        after,
        delta,
        nextVersion: (
          BigInt(row.existingSku!.balanceRowVersion!) + 1n
        ).toString(),
      },
    ];
  });
  for (const adjustment of stockAdjustments) {
    await connection.query(
      `UPDATE stock_balances
       SET quantity_pcs = ?, row_version = row_version + 1, updated_at = ?
       WHERE sku_id = UNHEX(REPLACE(?, '-', ''))`,
      [adjustment.row.source.stockPcs, committedAt, adjustment.row.skuId],
    );
  }
  await insertChunks(
    connection,
    'stock_movements',
    `id, sku_id, delta_pcs, reason, device_id, operation_id,
     balance_row_version_after, created_at`,
    `UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?,
     'catalogue_reconciliation', UNHEX(REPLACE(?, '-', '')),
     UNHEX(REPLACE(?, '-', '')), ?, ?`,
    stockAdjustments,
    (adjustment) => [
      adjustment.row.stockMovementId,
      adjustment.row.skuId,
      adjustment.delta.toString(),
      record.createdByDeviceId,
      record.id,
      adjustment.nextVersion,
      committedAt,
    ],
  );
  for (const adjustment of stockAdjustments) {
    await connection.query(
      `INSERT INTO audit_events
         (id, device_id, action, entity_type, entity_id, detail_json,
          created_at)
       VALUES
         (UNHEX(REPLACE(UUID(), '-', '')),
          UNHEX(REPLACE(?, '-', '')), 'catalogue.stock_reconciled',
          'stock_balance', UNHEX(REPLACE(?, '-', '')), ?, ?)`,
      [
        record.createdByDeviceId,
        adjustment.row.skuId,
        JSON.stringify({
          beforeQuantityPcs: adjustment.before.toString(),
          afterQuantityPcs: adjustment.after.toString(),
          deltaPcs: adjustment.delta.toString(),
          importId: record.id,
          workbookSha256: record.workbookSha256,
        }),
        committedAt,
      ],
    );
  }
  await insertChunks(
    connection,
    'price_history',
    `id, sku_id, price_rupiah, source, changed_by_device_id,
     effective_at`,
    `UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
     ?, ?, UNHEX(REPLACE(?, '-', '')), ?`,
    rows,
    (row) => [
      row.priceHistoryId,
      row.skuId,
      row.source.selectedPrice,
      'catalogue_import',
      record.createdByDeviceId,
      committedAt,
    ],
  );
  const imageRows = rows.filter(
    (row): row is PreparedCatalogueRow & { imageJobId: string } =>
      row.imageJobId !== null && row.source.imageSourceUrl !== null,
  );
  await insertChunks(
    connection,
    'image_jobs',
    'id, import_id, sku_id, source_url, status, next_attempt_at',
    `UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
     UNHEX(REPLACE(?, '-', '')), ?, 'pending', ?`,
    imageRows,
    (row) => [
      row.imageJobId,
      record.id,
      row.skuId,
      row.source.imageSourceUrl,
      committedAt,
    ],
  );
  const catalogueChanges = rows.flatMap((row) => {
    const demotedChanges = row.demotedPrimaryIdentifiers
      .filter(
        (identifier) =>
          identifier.id !== row.primaryIdentifierId &&
          identifier.id !== row.productIdentifierId,
      )
      .map((identifier) => ({
        entityType: 'sku_identifier',
        entityId: identifier.id,
        payload: identifierPayload(
          identifier.id,
          row,
          identifier.value,
          'alias',
          committedAt,
          identifier.createdAt,
        ),
      }));
    return [{
      entityType: 'sku',
      entityId: row.skuId,
      payload: skuPayload(row, committedAt),
    },
    ...demotedChanges,
    {
      entityType: 'sku_identifier',
      entityId: row.primaryIdentifierId,
      payload: identifierPayload(
        row.primaryIdentifierId,
        row,
        row.source.primarySku,
        'primary',
        committedAt,
        row.primaryIdentifierCreatedAt,
      ),
    },
    {
      entityType: 'sku_identifier',
      entityId: row.productIdentifierId,
      payload: identifierPayload(
        row.productIdentifierId,
        row,
        row.source.productCode,
        'product_code',
        committedAt,
        row.productIdentifierCreatedAt,
      ),
    }];
  });
  const priceHistoryChanges = rows.map((row) => ({
    entityType: 'price_history',
    entityId: row.priceHistoryId,
    payload: {
      id: row.priceHistoryId,
      skuId: row.skuId,
      priceRupiah: row.source.selectedPrice.toString(),
      beforePriceRupiah:
        row.existingSku?.priceRupiah ?? row.source.selectedPrice.toString(),
      source: 'catalogue_import',
      changedByDeviceId: record.createdByDeviceId,
      effectiveAt: committedAt.toISOString(),
    },
  }));
  const newBalanceChanges = newRows.map((row) => ({
    entityType: 'stock_balance',
    entityId: row.skuId,
    payload: balancePayload(row, committedAt, '1'),
  }));
  const adjustedStockChanges = stockAdjustments.flatMap((adjustment) => [
    {
      entityType: 'stock_balance',
      entityId: adjustment.row.skuId,
      payload: balancePayload(
        adjustment.row,
        committedAt,
        adjustment.nextVersion,
      ),
    },
    {
      entityType: 'stock_movement',
      entityId: adjustment.row.stockMovementId,
      payload: {
        id: adjustment.row.stockMovementId,
        skuId: adjustment.row.skuId,
        deltaPcs: adjustment.delta.toString(),
        reason: 'catalogue_reconciliation',
        deviceId: record.createdByDeviceId,
        operationId: record.id,
        balanceRowVersionAfter: adjustment.nextVersion,
        createdAt: committedAt.toISOString(),
        beforeQuantityPcs: adjustment.before.toString(),
        afterQuantityPcs: adjustment.after.toString(),
      },
    },
  ]);
  const changes = [
    ...catalogueChanges,
    ...priceHistoryChanges,
    ...newBalanceChanges,
    ...adjustedStockChanges,
  ];
  await insertChunks(
    connection,
    'change_log',
    'entity_type, entity_id, operation, payload_json, created_at',
    `?, UNHEX(REPLACE(?, '-', '')), 'upsert', ?, ?`,
    changes,
    (change) => [
      change.entityType,
      change.entityId,
      JSON.stringify(change.payload),
      committedAt,
    ],
  );
  return {
    stockAdjustedCount: stockAdjustments.length,
    zeroDeltaMatchedCount: matchedRows.length - stockAdjustments.length,
  };
}
