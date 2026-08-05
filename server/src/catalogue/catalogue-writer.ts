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
  existingSku: {
    rowVersion: string;
    balanceRowVersion: string | null;
    createdAt: string;
    imageHash: string | null;
  } | null;
  existingPrimaryIdentifier: boolean;
  existingProductIdentifier: boolean;
  primaryIdentifierCreatedAt: string | null;
  productIdentifierCreatedAt: string | null;
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

function balancePayload(row: PreparedCatalogueRow, committedAt: Date) {
  const rowVersion = row.existingSku?.balanceRowVersion
    ? (BigInt(row.existingSku.balanceRowVersion) + 1n).toString()
    : '1';
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
): Promise<void> {
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
    rows,
    (row) => [row.skuId, row.source.stockPcs, committedAt],
    `
     ON DUPLICATE KEY UPDATE
       quantity_pcs = VALUES(quantity_pcs),
       row_version = row_version + 1,
       updated_at = VALUES(updated_at)`,
  );
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
  const changes = rows.flatMap((row) => [
    {
      entityType: 'sku',
      entityId: row.skuId,
      payload: skuPayload(row, committedAt),
    },
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
    },
    {
      entityType: 'stock_balance',
      entityId: row.skuId,
      payload: balancePayload(row, committedAt),
    },
  ]);
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
}
