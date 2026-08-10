import { databaseDate, hexToUuid } from '../auth/mariadb-row-utils.js';
import {
  normalizeIdentifier,
  type PreparedCatalogueRow,
} from './catalogue-writer.js';
import { CatalogueError } from './service.js';
import type { CatalogueRow } from './workbook.js';

export interface ExistingCatalogueRow {
  sku_id_hex: unknown;
  row_version: unknown;
  price_rupiah: unknown;
  balance_row_version: unknown;
  quantity_pcs: unknown;
  created_at: unknown;
  image_hash_hex: unknown;
  archived_at: unknown;
  identifier_id_hex: unknown;
  identifier_value: unknown;
  identifier_kind: unknown;
  identifier_created_at: unknown;
}

interface ExistingSku {
  id: string;
  rowVersion: string;
  priceRupiah: string;
  balanceRowVersion: string | null;
  quantityPcs: string | null;
  createdAt: string;
  imageHash: string | null;
  identifiers: Map<
    string,
    { id: string; value: string; kind: string; createdAt: string }
  >;
}

export interface CatalogueReconciliation {
  rows: PreparedCatalogueRow[];
  matchedExistingCount: number;
  createdSkuCount: number;
  untouchedExistingCount: number;
}

function positiveVersion(value: unknown, label: string): string {
  const version = String(value);
  if (!/^[1-9][0-9]*$/.test(version)) {
    throw new Error(`Database returned an invalid ${label} row version`);
  }
  return version;
}

function integerQuantity(value: unknown): string {
  const quantity = String(value);
  if (!/^-?(0|[1-9][0-9]*)$/.test(quantity)) {
    throw new Error('Database returned an invalid stock quantity');
  }
  return quantity;
}

function hydrateExistingSkus(
  rows: ExistingCatalogueRow[],
): Map<string, ExistingSku> {
  const skus = new Map<string, ExistingSku>();
  for (const row of rows) {
    const skuId = hexToUuid(row.sku_id_hex);
    let sku = skus.get(skuId);
    if (!sku) {
      const imageHash =
        row.image_hash_hex === null
          ? null
          : String(row.image_hash_hex).toLowerCase();
      if (imageHash !== null && !/^[0-9a-f]{64}$/.test(imageHash)) {
        throw new Error('Database returned an invalid SKU image hash');
      }
      sku = {
        id: skuId,
        rowVersion: positiveVersion(row.row_version, 'SKU'),
        priceRupiah: integerQuantity(row.price_rupiah),
        balanceRowVersion:
          row.balance_row_version === null
            ? null
            : positiveVersion(row.balance_row_version, 'balance'),
        quantityPcs:
          row.quantity_pcs === null ? null : integerQuantity(row.quantity_pcs),
        createdAt: databaseDate(row.created_at).toISOString(),
        imageHash,
        identifiers: new Map(),
      };
      skus.set(skuId, sku);
    }
    if (row.identifier_id_hex === null) continue;
    const identifier = normalizeIdentifier(String(row.identifier_value));
    sku.identifiers.set(identifier, {
      id: hexToUuid(row.identifier_id_hex),
      value: String(row.identifier_value),
      kind: String(row.identifier_kind),
      createdAt: databaseDate(row.identifier_created_at).toISOString(),
    });
  }
  return skus;
}

export function reconcileCatalogue(
  sourceRows: CatalogueRow[],
  existingRows: ExistingCatalogueRow[],
  uuid: () => string,
): CatalogueReconciliation {
  const existingSkus = hydrateExistingSkus(existingRows);
  const existingByIdentifier = new Map<string, ExistingSku>();
  for (const sku of existingSkus.values()) {
    for (const identifier of sku.identifiers.keys()) {
      const conflict = existingByIdentifier.get(identifier);
      if (conflict && conflict.id !== sku.id) {
        throw new CatalogueError(
          'CATALOGUE_IDENTITY_CONFLICT',
          409,
          'Identifier tersimpan terhubung ke dua SKU yang berbeda.',
        );
      }
      existingByIdentifier.set(identifier, sku);
    }
  }

  const assignedExisting = new Set<string>();
  const rows = sourceRows.map((source): PreparedCatalogueRow => {
    const primaryKey = normalizeIdentifier(source.primarySku);
    const productKey = normalizeIdentifier(source.productCode);
    const primaryMatch = existingByIdentifier.get(primaryKey);
    const productMatch = existingByIdentifier.get(productKey);
    if (primaryMatch && productMatch && primaryMatch.id !== productMatch.id) {
      throw new CatalogueError(
        'CATALOGUE_IDENTITY_CONFLICT',
        409,
        'Identifier katalog cocok dengan dua SKU yang berbeda.',
      );
    }
    const existing = primaryMatch ?? productMatch ?? null;
    if (existing && assignedExisting.has(existing.id)) {
      throw new CatalogueError(
        'CATALOGUE_IDENTITY_CONFLICT',
        409,
        'Dua baris workbook cocok dengan SKU yang sama.',
      );
    }
    if (
      existing &&
      (existing.balanceRowVersion === null || existing.quantityPcs === null)
    ) {
      throw new Error('Database returned an invalid matched SKU balance');
    }
    if (existing) assignedExisting.add(existing.id);
    return {
      source,
      skuId: existing?.id ?? uuid(),
      primaryIdentifierId: existing?.identifiers.get(primaryKey)?.id ?? uuid(),
      productIdentifierId: existing?.identifiers.get(productKey)?.id ?? uuid(),
      imageJobId: source.imageSourceUrl ? uuid() : null,
      priceHistoryId: uuid(),
      stockMovementId: uuid(),
      existingSku: existing
        ? {
            rowVersion: existing.rowVersion,
            priceRupiah: existing.priceRupiah,
            balanceRowVersion: existing.balanceRowVersion,
            quantityPcs: existing.quantityPcs,
            createdAt: existing.createdAt,
            imageHash: existing.imageHash,
          }
        : null,
      existingPrimaryIdentifier: existing?.identifiers.has(primaryKey) ?? false,
      existingProductIdentifier: existing?.identifiers.has(productKey) ?? false,
      primaryIdentifierCreatedAt:
        existing?.identifiers.get(primaryKey)?.createdAt ?? null,
      productIdentifierCreatedAt:
        existing?.identifiers.get(productKey)?.createdAt ?? null,
      demotedPrimaryIdentifiers: existing
        ? [...existing.identifiers.values()].filter(
            (identifier) =>
              identifier.kind === 'primary' &&
              normalizeIdentifier(identifier.value) !== primaryKey,
          )
        : [],
    };
  });

  return {
    rows,
    matchedExistingCount: assignedExisting.size,
    createdSkuCount: rows.length - assignedExisting.size,
    untouchedExistingCount: [...existingSkus.values()].filter(
      (sku) => !assignedExisting.has(sku.id),
    ).length,
  };
}
