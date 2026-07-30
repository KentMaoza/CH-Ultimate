import {
  databaseDate,
  databaseDateOnly,
  hexToUuid,
  nullableDatabaseDate,
  nullableHexToUuid,
} from '../auth/mariadb-row-utils.js';
import type { ProtocolConnection } from './idempotency.js';
import type { BootstrapCollections } from './service.js';

function parseJson(value: unknown): unknown {
  if (typeof value === 'string') {
    return JSON.parse(value);
  }
  if (Buffer.isBuffer(value)) {
    return JSON.parse(value.toString('utf8'));
  }
  return value;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function requiredUuid(value: unknown): string {
  return hexToUuid(value);
}

export async function readBootstrapCollections(
  connection: ProtocolConnection,
): Promise<BootstrapCollections> {
  const identifierRows = await connection.query<
    Array<Record<string, unknown>>
  >(
    `SELECT HEX(id) AS id_hex, HEX(sku_id) AS sku_id_hex,
            identifier_value, identifier_kind, created_at
     FROM sku_identifiers
     ORDER BY id`,
  );
  const skuRows = await connection.query<Array<Record<string, unknown>>>(
    `SELECT HEX(id) AS id_hex, primary_identifier, name, price_rupiah,
            HEX(image_hash) AS image_hash_hex, source_image_url,
            source_note, source_created_at, row_version, archived_at,
            created_at, updated_at
     FROM skus
     ORDER BY id`,
  );
  const balanceRows = await connection.query<
    Array<Record<string, unknown>>
  >(
    `SELECT HEX(sku_id) AS sku_id_hex, quantity_pcs, row_version, updated_at
     FROM stock_balances
     ORDER BY sku_id`,
  );
  const priceRows = await connection.query<Array<Record<string, unknown>>>(
    `SELECT HEX(id) AS id_hex, HEX(sku_id) AS sku_id_hex, price_rupiah,
            source, HEX(changed_by_device_id) AS changed_by_device_id_hex,
            effective_at
     FROM price_history
     ORDER BY effective_at, id`,
  );
  const movementRows = await connection.query<Array<Record<string, unknown>>>(
    `SELECT HEX(id) AS id_hex, HEX(sku_id) AS sku_id_hex, delta_pcs,
            reason, HEX(device_id) AS device_id_hex,
            HEX(operation_id) AS operation_id_hex, created_at
     FROM stock_movements
     ORDER BY created_at, id`,
  );
  const notaRows = await connection.query<Array<Record<string, unknown>>>(
    `SELECT HEX(id) AS id_hex, nota_number, business_date, status,
            completion_destination,
            header_json, field_versions, structure_version,
            lifecycle_version, subtotal_rupiah, total_rupiah,
            HEX(created_by_device_id) AS created_by_device_id_hex,
            completed_at, cancelled_at, created_at, updated_at
     FROM notas
     ORDER BY id`,
  );
  const pageRows = await connection.query<Array<Record<string, unknown>>>(
    `SELECT HEX(id) AS id_hex, HEX(nota_id) AS nota_id_hex, page_position,
            status, row_version, lifecycle_version, created_at, updated_at
     FROM nota_pages
     ORDER BY nota_id, page_position`,
  );
  const lineRows = await connection.query<Array<Record<string, unknown>>>(
    `SELECT HEX(id) AS id_hex, HEX(nota_id) AS nota_id_hex,
            HEX(page_id) AS page_id_hex, HEX(sku_id) AS sku_id_hex,
            line_position, sku_identifier_snapshot, sku_name_snapshot,
            kind_snapshot, quantity_pcs, unit_kind, unit_price_rupiah,
            pcs_price_rupiah, lsn_price_rupiah, line_total_rupiah, row_version,
            deleted_at, created_at, updated_at
     FROM nota_lines
     ORDER BY nota_id, page_id, line_position`,
  );
  const postingRows = await connection.query<Array<Record<string, unknown>>>(
    `SELECT HEX(id) AS id_hex, HEX(nota_id) AS nota_id_hex, posting_kind,
            amount_rupiah, snapshot_json, lifecycle_version,
            HEX(reverses_posting_id) AS reverses_posting_id_hex, posted_at
     FROM nota_postings
     ORDER BY nota_id, lifecycle_version, posted_at, id`,
  );
  const revenueRows = await connection.query<Array<Record<string, unknown>>>(
    `SELECT HEX(id) AS id_hex, HEX(nota_id) AS nota_id_hex,
            HEX(nota_posting_id) AS nota_posting_id_hex, amount_rupiah,
            posting_kind, posted_at
     FROM revenue_postings
     ORDER BY posted_at, id`,
  );
  const templateRows = await connection.query<
    Array<Record<string, unknown>>
  >(
    `SELECT HEX(id) AS id_hex, template_kind, name, definition_json,
            row_version, archived_at, created_at, updated_at
     FROM templates
     ORDER BY id`,
  );

  return {
    skuIdentifiers: identifierRows.map((row) => ({
      id: requiredUuid(row.id_hex),
      skuId: requiredUuid(row.sku_id_hex),
      identifierValue: String(row.identifier_value),
      identifierKind: String(row.identifier_kind),
      createdAt: databaseDate(row.created_at),
    })),
    skus: skuRows.map((row) => ({
      id: requiredUuid(row.id_hex),
      primaryIdentifier: String(row.primary_identifier),
      name: String(row.name),
      priceRupiah: BigInt(String(row.price_rupiah)),
      imageHash:
        row.image_hash_hex === null || row.image_hash_hex === undefined
          ? null
          : String(row.image_hash_hex).toLowerCase(),
      sourceImageUrl:
        row.source_image_url === null || row.source_image_url === undefined
          ? null
          : String(row.source_image_url),
      sourceNote:
        row.source_note === null || row.source_note === undefined
          ? ''
          : String(row.source_note),
      sourceCreatedAt:
        row.source_created_at === null ||
        row.source_created_at === undefined
          ? ''
          : String(row.source_created_at),
      rowVersion: BigInt(String(row.row_version)),
      archivedAt: nullableDatabaseDate(row.archived_at),
      createdAt: databaseDate(row.created_at),
      updatedAt: databaseDate(row.updated_at),
    })),
    balances: balanceRows.map((row) => ({
      skuId: requiredUuid(row.sku_id_hex),
      quantityPcs: BigInt(String(row.quantity_pcs)),
      rowVersion: BigInt(String(row.row_version)),
      updatedAt: databaseDate(row.updated_at),
    })),
    priceHistory: priceRows.map((row) => ({
      id: requiredUuid(row.id_hex),
      skuId: requiredUuid(row.sku_id_hex),
      priceRupiah: BigInt(String(row.price_rupiah)),
      source: String(row.source),
      changedByDeviceId: nullableHexToUuid(row.changed_by_device_id_hex),
      effectiveAt: databaseDate(row.effective_at),
    })),
    stockMovements: movementRows.map((row) => ({
      id: requiredUuid(row.id_hex),
      skuId: requiredUuid(row.sku_id_hex),
      deltaPcs: BigInt(String(row.delta_pcs)),
      reason: String(row.reason),
      deviceId: requiredUuid(row.device_id_hex),
      operationId: nullableHexToUuid(row.operation_id_hex),
      createdAt: databaseDate(row.created_at),
    })),
    notas: notaRows.map((row) => ({
      id: requiredUuid(row.id_hex),
      notaNumber: String(row.nota_number),
      businessDate: databaseDateOnly(row.business_date),
      status: String(row.status),
      completionDestination:
        row.completion_destination === null ||
        row.completion_destination === undefined
          ? null
          : String(row.completion_destination),
      header: parseJson(row.header_json),
      fieldVersions: parseJson(row.field_versions),
      structureVersion: BigInt(String(row.structure_version)),
      lifecycleVersion: BigInt(String(row.lifecycle_version)),
      subtotalRupiah: BigInt(String(row.subtotal_rupiah)),
      totalRupiah: BigInt(String(row.total_rupiah)),
      createdByDeviceId: requiredUuid(row.created_by_device_id_hex),
      completedAt: nullableDatabaseDate(row.completed_at),
      cancelledAt: nullableDatabaseDate(row.cancelled_at),
      createdAt: databaseDate(row.created_at),
      updatedAt: databaseDate(row.updated_at),
    })),
    notaPages: pageRows.map((row) => ({
      id: requiredUuid(row.id_hex),
      notaId: requiredUuid(row.nota_id_hex),
      pagePosition: Number(row.page_position),
      status: String(row.status),
      rowVersion: BigInt(String(row.row_version)),
      lifecycleVersion: BigInt(String(row.lifecycle_version)),
      createdAt: databaseDate(row.created_at),
      updatedAt: databaseDate(row.updated_at),
    })),
    notaLines: lineRows.map((row) => ({
      id: requiredUuid(row.id_hex),
      notaId: requiredUuid(row.nota_id_hex),
      pageId: requiredUuid(row.page_id_hex),
      skuId: nullableHexToUuid(row.sku_id_hex),
      linePosition: Number(row.line_position),
      skuIdentifierSnapshot: String(row.sku_identifier_snapshot),
      skuNameSnapshot: String(row.sku_name_snapshot),
      kindSnapshot: String(row.kind_snapshot),
      quantityPcs: BigInt(String(row.quantity_pcs)),
      unitKind: String(row.unit_kind),
      unitPriceRupiah: BigInt(String(row.unit_price_rupiah)),
      pcsPriceRupiah: BigInt(String(row.pcs_price_rupiah)),
      lsnPriceRupiah: BigInt(String(row.lsn_price_rupiah)),
      lineTotalRupiah: BigInt(String(row.line_total_rupiah)),
      rowVersion: BigInt(String(row.row_version)),
      deletedAt: nullableDatabaseDate(row.deleted_at),
      createdAt: databaseDate(row.created_at),
      updatedAt: databaseDate(row.updated_at),
    })),
    notaPostings: postingRows.map((row) => {
      const snapshot = jsonRecord(parseJson(row.snapshot_json));
      return {
        id: requiredUuid(row.id_hex),
        notaId: requiredUuid(row.nota_id_hex),
        postingKind: String(row.posting_kind),
        amountRupiah: BigInt(String(row.amount_rupiah)),
        snapshot: {
          lines: Array.isArray(snapshot.lines) ? snapshot.lines : [],
          stockEffects: jsonRecord(snapshot.stockEffects),
          trackedLineIds: jsonRecord(snapshot.trackedLineIds),
        },
        lifecycleVersion: BigInt(String(row.lifecycle_version)),
        reversesPostingId: nullableHexToUuid(row.reverses_posting_id_hex),
        postedAt: databaseDate(row.posted_at),
      };
    }),
    revenuePostings: revenueRows.map((row) => ({
      id: requiredUuid(row.id_hex),
      notaId: requiredUuid(row.nota_id_hex),
      notaPostingId: requiredUuid(row.nota_posting_id_hex),
      amountRupiah: BigInt(String(row.amount_rupiah)),
      postingKind: String(row.posting_kind),
      postedAt: databaseDate(row.posted_at),
    })),
    templates: templateRows.map((row) => ({
      id: requiredUuid(row.id_hex),
      templateKind: String(row.template_kind),
      name: String(row.name),
      definition: parseJson(row.definition_json),
      rowVersion: BigInt(String(row.row_version)),
      archivedAt: nullableDatabaseDate(row.archived_at),
      createdAt: databaseDate(row.created_at),
      updatedAt: databaseDate(row.updated_at),
    })),
  };
}
