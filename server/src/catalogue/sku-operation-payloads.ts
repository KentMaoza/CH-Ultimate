import { randomUUID } from 'node:crypto';

export interface SkuRow extends Record<string, unknown> {
  id_hex: unknown;
  primary_identifier: unknown;
  name: unknown;
  price_rupiah: unknown;
  image_hash: unknown;
  source_image_url: unknown;
  source_note: unknown;
  row_version: unknown;
  archived_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

export interface IdentifierRow extends Record<string, unknown> {
  id_hex: unknown;
  sku_id_hex: unknown;
  identifier_value: unknown;
  identifier_kind: unknown;
  created_at: unknown;
}

export interface SkuRepositoryDependencies {
  uuid(): string;
  now(): Date;
}

export const defaultSkuRepositoryDependencies: SkuRepositoryDependencies = {
  uuid: randomUUID,
  now: () => new Date(),
};

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

export function skuPayload(
  id: string,
  values: {
    skuNumber: string;
    name: string;
    referencePrice: number;
    note: string;
    imageHash: string | null;
    sourceImageUrl: string | null;
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
    imageHash: values.imageHash,
    sourceImageUrl: values.sourceImageUrl,
    sourceNote: values.note,
    sourceCreatedAt: '',
    rowVersion: values.rowVersion,
    archivedAt: values.archivedAt,
    createdAt: values.createdAt,
    updatedAt: values.updatedAt,
  };
}

export function identifierPayload(
  id: string,
  skuId: string,
  value: string,
  kind: string,
  createdAt: Date,
) {
  return {
    id,
    skuId,
    identifierValue: value,
    identifierKind: kind,
    createdAt: createdAt.toISOString(),
  };
}

export function balancePayload(skuId: string, quantity: number, now: Date) {
  return {
    skuId,
    quantityPcs: quantity.toString(),
    rowVersion: '1',
    updatedAt: now.toISOString(),
  };
}
