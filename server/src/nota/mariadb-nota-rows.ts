import {
  databaseDate,
  databaseDateOnly,
  hexToUuid,
  nullableHexToUuid,
} from '../auth/mariadb-row-utils.js';
import { parseNotaStoredJson } from './conflicts.js';

export interface NotaRow extends Record<string, unknown> {
  id_hex: unknown;
  nota_number: unknown;
  business_date: unknown;
  status: unknown;
  completion_destination: unknown;
  cancelled_from_status: unknown;
  header_json: unknown;
  field_versions: unknown;
  structure_version: unknown;
  lifecycle_version: unknown;
  subtotal_rupiah: unknown;
  total_rupiah: unknown;
  created_by_device_id_hex: unknown;
  completed_at: unknown;
  cancelled_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}
export interface PageRow extends Record<string, unknown> {
  id_hex: unknown;
  nota_id_hex: unknown;
  page_position: unknown;
  status: unknown;
  row_version: unknown;
  lifecycle_version: unknown;
  created_at: unknown;
  updated_at: unknown;
}

export interface LineRow extends Record<string, unknown> {
  id_hex: unknown;
  nota_id_hex: unknown;
  page_id_hex: unknown;
  sku_id_hex: unknown;
  line_position: unknown;
  sku_identifier_snapshot: unknown;
  sku_name_snapshot: unknown;
  kind_snapshot: unknown;
  quantity_pcs: unknown;
  unit_kind: unknown;
  unit_price_rupiah: unknown;
  pcs_price_rupiah: unknown;
  lsn_price_rupiah: unknown;
  line_total_rupiah: unknown;
  row_version: unknown;
  deleted_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

export function jsonRecord(value: unknown): Record<string, unknown> {
  const parsed = parseNotaStoredJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function iso(value: unknown): string {
  return databaseDate(value).toISOString();
}

export function noteSuffix(index: number): string {
  let value = index + 1;
  let suffix = '';
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return suffix;
}

export function coreNotaPayload(row: NotaRow): Record<string, unknown> {
  return {
    id: hexToUuid(row.id_hex),
    notaNumber: String(row.nota_number),
    businessDate: databaseDateOnly(row.business_date),
    status: String(row.status),
    completionDestination:
      row.completion_destination === null ||
      row.completion_destination === undefined
        ? null
        : String(row.completion_destination),
    header: jsonRecord(row.header_json),
    fieldVersions: Object.fromEntries(
      Object.entries(jsonRecord(row.field_versions)).map(([key, value]) => [
        key,
        String(value),
      ]),
    ),
    structureVersion: String(row.structure_version),
    lifecycleVersion: String(row.lifecycle_version),
    subtotalRupiah: String(row.subtotal_rupiah),
    totalRupiah: String(row.total_rupiah),
    createdByDeviceId: hexToUuid(row.created_by_device_id_hex),
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? iso(row.cancelled_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function corePagePayload(row: PageRow): Record<string, unknown> {
  return {
    id: hexToUuid(row.id_hex),
    notaId: hexToUuid(row.nota_id_hex),
    pagePosition: Number(row.page_position),
    status: String(row.status),
    rowVersion: String(row.row_version),
    lifecycleVersion: String(row.lifecycle_version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function lineValue(row: LineRow): Record<string, unknown> {
  const unit = String(row.unit_kind) === 'lsn' ? 'lsn' : 'pcs';
  const quantityPcs = Number(row.quantity_pcs);
  return {
    linePosition: Number(row.line_position),
    skuId: nullableHexToUuid(row.sku_id_hex),
    description: String(row.sku_name_snapshot),
    kind: String(row.kind_snapshot),
    quantity: unit === 'lsn' ? quantityPcs / 12 : quantityPcs,
    unit,
    pcsPrice: Number(row.pcs_price_rupiah),
    lsnPrice: Number(row.lsn_price_rupiah),
  };
}

export function coreLinePayload(row: LineRow): Record<string, unknown> {
  return {
    id: hexToUuid(row.id_hex),
    notaId: hexToUuid(row.nota_id_hex),
    pageId: hexToUuid(row.page_id_hex),
    skuId: nullableHexToUuid(row.sku_id_hex),
    linePosition: Number(row.line_position),
    skuIdentifierSnapshot: String(row.sku_identifier_snapshot),
    skuNameSnapshot: String(row.sku_name_snapshot),
    kindSnapshot: String(row.kind_snapshot),
    quantityPcs: String(row.quantity_pcs),
    unitKind: String(row.unit_kind),
    unitPriceRupiah: String(row.unit_price_rupiah),
    pcsPriceRupiah: String(row.pcs_price_rupiah),
    lsnPriceRupiah: String(row.lsn_price_rupiah),
    lineTotalRupiah: String(row.line_total_rupiah),
    rowVersion: String(row.row_version),
    deletedAt: row.deleted_at ? iso(row.deleted_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function postingLineSnapshot(row: LineRow): Record<string, unknown> {
  return {
    id: hexToUuid(row.id_hex),
    pageId: hexToUuid(row.page_id_hex),
    skuId: nullableHexToUuid(row.sku_id_hex),
    skuIdentifierSnapshot: String(row.sku_identifier_snapshot),
    skuNameSnapshot: String(row.sku_name_snapshot),
    kindSnapshot: String(row.kind_snapshot),
    quantityPcs: String(row.quantity_pcs),
    unitKind: String(row.unit_kind),
    unitPriceRupiah: String(row.unit_price_rupiah),
    pcsPriceRupiah: String(row.pcs_price_rupiah),
    lsnPriceRupiah: String(row.lsn_price_rupiah),
    lineTotalRupiah: String(row.line_total_rupiah),
    linePosition: Number(row.line_position),
  };
}
