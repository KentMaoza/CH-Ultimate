import { randomUUID } from 'node:crypto';

import {
  databaseDate,
  databaseDateOnly,
  hexToUuid,
  nullableHexToUuid,
} from '../auth/mariadb-row-utils.js';
export { hexToUuid, nullableHexToUuid } from '../auth/mariadb-row-utils.js';
import {
  writeOperationAudit,
  writeOperationChange,
} from '../catalogue/mariadb-operation-writes.js';
import { canonicalizeJson, type IdempotentMutation, type ProtocolConnection } from '../sync/idempotency.js';
import {
  decideLineMutation,
  lifecycleEditConflict,
  mergeHeaderFields,
  parseNotaStoredJson,
  versionConflict,
} from './conflicts.js';
import { formatWitaBusinessDate, formatWitaNotaNumber } from './numbering.js';
import {
  readLatestPostingSnapshot,
  writeNotaPosting,
  type LatestPostingSnapshot,
} from './mariadb-posting-store.js';
import {
  completionPosting,
  restorePosting,
  reversalPosting,
  shouldReapplyPostingOnRestore,
  shouldReversePostingOnCancel,
} from './posting.js';
import { NotaOperationError, type NotaConflictMaterial, type NotaRepository } from './service.js';
import type {
  AddPageRequest,
  CompleteNotaRequest,
  CreateNotaRequest,
  DeleteLineRequest,
  NotaLifecycleRequest,
  PageLifecycleRequest,
  ResolveConflictRequest,
  UpdateHeaderRequest,
  UpdateLineRequest,
} from './validation.js';

export type Mutation = IdempotentMutation<Record<string, unknown>>;

export interface Dependencies {
  uuid(): string;
  now(): Date;
}

export const defaults: Dependencies = {
  uuid: randomUUID,
  now: () => new Date(),
};

import {
  NotaRow,
  PageRow,
  LineRow,
  jsonRecord,
  iso,
  noteSuffix,
  coreNotaPayload,
  corePagePayload,
  lineValue,
  coreLinePayload,
  postingLineSnapshot,
} from './mariadb-nota-rows.js';
export {
  NotaRow,
  PageRow,
  LineRow,
  jsonRecord,
  iso,
  noteSuffix,
  coreNotaPayload,
  corePagePayload,
  lineValue,
  coreLinePayload,
  postingLineSnapshot,
};

export async function readNota(
  connection: Pick<ProtocolConnection, 'query'>,
  id: string,
): Promise<NotaRow | undefined> {
  const rows = await connection.query<NotaRow[]>(
    `SELECT HEX(id) AS id_hex, nota_number, business_date, status,
            completion_destination, cancelled_from_status, header_json,
            field_versions, structure_version, lifecycle_version,
            subtotal_rupiah, total_rupiah,
            HEX(created_by_device_id) AS created_by_device_id_hex,
            completed_at, cancelled_at, created_at, updated_at
     FROM notas
     WHERE id = UNHEX(REPLACE(?, '-', ''))
     FOR UPDATE`,
    [id],
  );
  return rows[0];
}

export async function readPages(
  connection: Pick<ProtocolConnection, 'query'>,
  id: string,
): Promise<PageRow[]> {
  return connection.query<PageRow[]>(
    `SELECT HEX(id) AS id_hex, HEX(nota_id) AS nota_id_hex, page_position,
            status, row_version, lifecycle_version, created_at, updated_at
     FROM nota_pages
     WHERE nota_id = UNHEX(REPLACE(?, '-', ''))
     ORDER BY page_position
     FOR UPDATE`,
    [id],
  );
}

export async function readLines(
  connection: Pick<ProtocolConnection, 'query'>,
  id: string,
): Promise<LineRow[]> {
  return connection.query<LineRow[]>(
    `SELECT HEX(id) AS id_hex, HEX(nota_id) AS nota_id_hex,
            HEX(page_id) AS page_id_hex, HEX(sku_id) AS sku_id_hex,
            line_position, sku_identifier_snapshot, sku_name_snapshot,
            kind_snapshot, quantity_pcs, unit_kind, unit_price_rupiah,
            pcs_price_rupiah, lsn_price_rupiah, line_total_rupiah,
            row_version, deleted_at, created_at, updated_at
     FROM nota_lines
     WHERE nota_id = UNHEX(REPLACE(?, '-', ''))
     ORDER BY page_id, line_position
     FOR UPDATE`,
    [id],
  );
}

export function editable(row: NotaRow): void {
  if (!['draft', 'reopened'].includes(String(row.status))) {
    throw new NotaOperationError(
      'NOTA_NOT_EDITABLE',
      409,
      'Completed or cancelled Nota cannot be edited',
    );
  }
}

export async function domainEntity(
  connection: Pick<ProtocolConnection, 'query'>,
  row: NotaRow,
): Promise<Record<string, unknown>> {
  const pages = await readPages(connection, hexToUuid(row.id_hex));
  const lines = await readLines(connection, hexToUuid(row.id_hex));
  const linesByPage = new Map<string, LineRow[]>();
  for (const line of lines) {
    const pageId = hexToUuid(line.page_id_hex);
    const collection = linesByPage.get(pageId) ?? [];
    collection.push(line);
    linesByPage.set(pageId, collection);
  }
  const pageEntities = pages.map((page) => {
    const pageId = hexToUuid(page.id_hex);
    const slots = Array.from({ length: 15 }, (_, position) => ({
      id: `empty-${pageId}-${position}`,
      description: '',
      kind: '',
      quantity: 0,
      unit: 'pcs',
      pcsPrice: 0,
      lsnPrice: 0,
    }));
    for (const line of linesByPage.get(pageId) ?? []) {
      if (!line.deleted_at) {
        slots[Number(line.line_position)] = {
          id: hexToUuid(line.id_hex),
          ...(nullableHexToUuid(line.sku_id_hex)
            ? { skuId: nullableHexToUuid(line.sku_id_hex)! }
            : {}),
          description: String(line.sku_name_snapshot),
          kind: String(line.kind_snapshot),
          quantity: Number(lineValue(line).quantity),
          unit: String(line.unit_kind),
          pcsPrice: Number(line.pcs_price_rupiah),
          lsnPrice: Number(line.lsn_price_rupiah),
        };
      }
    }
    return {
      id: pageId,
      suffix: noteSuffix(Number(page.page_position)),
      status: String(page.status),
      lines: slots,
    };
  });
  const header = jsonRecord(row.header_json);
  const posting = await readLatestPostingSnapshot(
    connection,
    hexToUuid(row.id_hex),
  );
  return {
    id: hexToUuid(row.id_hex),
    baseNumber: String(row.nota_number),
    customerName: String(header.customerName ?? ''),
    customerPlace: String(header.customerPlace ?? ''),
    transactionDate: String(header.transactionDate ?? row.business_date),
    payment: String(header.payment ?? 'unclassified'),
    status: String(row.status),
    ...(row.completion_destination
      ? { completionDestination: String(row.completion_destination) }
      : {}),
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
    nextNoteIndex:
      pages.reduce(
        (maximum, page) => Math.max(maximum, Number(page.page_position)),
        -1,
      ) + 1,
    pages: pageEntities,
    postedLines: (posting?.lines ?? []).map((line) => ({
      id: String(line.id),
      ...(line.skuId ? { skuId: String(line.skuId) } : {}),
      description: String(line.skuNameSnapshot ?? ''),
      kind: String(line.kindSnapshot ?? ''),
      quantity:
        String(line.unitKind) === 'lsn'
          ? Number(line.quantityPcs) / 12
          : Number(line.quantityPcs),
      unit: String(line.unitKind) === 'lsn' ? 'lsn' : 'pcs',
      pcsPrice: Number(line.pcsPriceRupiah),
      lsnPrice: Number(line.lsnPriceRupiah),
    })),
    postedStockEffects: Object.fromEntries(
      [...(posting?.effects ?? new Map<string, bigint>())].map(
        ([skuId, delta]) => [skuId, Number(-delta)],
      ),
    ),
    postedTrackedLineIds: posting?.trackedLineIds ?? {},
    ...(row.cancelled_from_status
      ? { cancelledFromStatus: String(row.cancelled_from_status) }
      : {}),
  };
}

export async function notaVersionState(
  connection: Pick<ProtocolConnection, 'query'>,
  row: NotaRow,
): Promise<Record<string, unknown>> {
  const pages = await readPages(connection, hexToUuid(row.id_hex));
  const lines = await readLines(connection, hexToUuid(row.id_hex));
  return {
    notaId: hexToUuid(row.id_hex),
    fieldVersions: Object.fromEntries(
      Object.entries(jsonRecord(row.field_versions)).map(([field, version]) => [
        field,
        String(version),
      ]),
    ),
    structureVersion: String(row.structure_version),
    lifecycleVersion: String(row.lifecycle_version),
    pageVersions: Object.fromEntries(
      pages.map((page) => [hexToUuid(page.id_hex), String(page.row_version)]),
    ),
    pageLifecycleVersions: Object.fromEntries(
      pages.map((page) => [
        hexToUuid(page.id_hex),
        String(page.lifecycle_version),
      ]),
    ),
    lineVersions: Object.fromEntries(
      lines.map((line) => [hexToUuid(line.id_hex), String(line.row_version)]),
    ),
  };
}

export async function requireNota(
  connection: Pick<ProtocolConnection, 'query'>,
  id: string,
): Promise<NotaRow> {
  const row = await readNota(connection, id);
  if (!row) {
    throw new NotaOperationError('NOTA_NOT_FOUND', 404, 'Nota not found');
  }
  return row;
}

export async function conflictMutation(
  connection: Pick<ProtocolConnection, 'query'>,
  dependencies: Dependencies,
  deviceId: string,
  operationId: string,
  notaId: string,
  material: Omit<NotaConflictMaterial, 'id' | 'entityId'> & {
    entityId?: string;
  },
  intent: unknown,
): Promise<Mutation> {
  const id = dependencies.uuid();
  const conflict: NotaConflictMaterial = {
    id,
    entityType: material.entityType,
    entityId: material.entityId ?? notaId,
    ...(material.field ? { field: material.field } : {}),
    base: material.base,
    mine: material.mine,
    server: material.server,
  };
  await connection.query(
    `INSERT INTO nota_conflicts
       (id, nota_id, device_id, original_operation_id, entity_type, entity_id,
        field_name, base_json, mine_json, server_json, intent_json)
     VALUES
       (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
        UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?,
        UNHEX(REPLACE(?, '-', '')), ?, ?, ?, ?, ?)`,
    [
      id,
      notaId,
      deviceId,
      operationId,
      material.entityType,
      material.entityId ?? notaId,
      material.field ?? null,
      canonicalizeJson(material.base),
      canonicalizeJson(material.mine),
      canonicalizeJson(material.server),
      canonicalizeJson(intent),
    ],
  );
  const nota = await requireNota(connection, notaId);
  const revision = await writeOperationChange(
    connection,
    'nota',
    notaId,
    coreNotaPayload(nota),
    dependencies.now(),
  );
  return {
    statusCode: 409,
    body: { code: 'CONFLICT', conflict, serverRevision: revision },
    audits: [
      {
        action: 'nota.conflict.created',
        entityType: 'nota',
        entityId: notaId,
        detail: { conflictId: id, entityType: material.entityType },
      },
    ],
    changes: [],
  };
}

export async function editLifecycleMutation(
  connection: Pick<ProtocolConnection, 'query'>,
  dependencies: Dependencies,
  deviceId: string,
  operationId: string,
  notaId: string,
  row: NotaRow,
  lifecycleVersion: string,
  action: string,
  intent: unknown,
): Promise<Mutation | null> {
  const material = lifecycleEditConflict(
    String(row.status),
    String(row.lifecycle_version),
    lifecycleVersion,
    action,
  );
  if (!material) return null;
  return conflictMutation(
    connection,
    dependencies,
    deviceId,
    operationId,
    notaId,
    { entityType: 'nota', ...material },
    intent,
  );
}

export async function emitNota(
  connection: Pick<ProtocolConnection, 'query'>,
  deviceId: string,
  action: string,
  row: NotaRow,
  detail: unknown,
  now: Date,
): Promise<{ revision: string; entity: Record<string, unknown> }> {
  const id = hexToUuid(row.id_hex);
  await writeOperationAudit(
    connection,
    deviceId,
    action,
    'nota',
    id,
    detail,
    now,
  );
  const revision = await writeOperationChange(
    connection,
    'nota',
    id,
    coreNotaPayload(row),
    now,
  );
  return { revision, entity: await domainEntity(connection, row) };
}

export function mutationBody(
  revision: string,
  version: string,
  entity: Record<string, unknown>,
  versionState?: Record<string, unknown>,
): Mutation {
  return {
    statusCode: 200,
    body: {
      serverRevision: revision,
      entityVersion: version,
      entity,
      ...(versionState ? { versionState } : {}),
    },
    audits: [],
    changes: [],
  };
}

export async function readPage(
  connection: Pick<ProtocolConnection, 'query'>,
  notaId: string,
  pageId: string,
): Promise<PageRow | undefined> {
  const rows = await connection.query<PageRow[]>(
    `SELECT HEX(id) AS id_hex, HEX(nota_id) AS nota_id_hex, page_position,
            status, row_version, lifecycle_version, created_at, updated_at
     FROM nota_pages
     WHERE id = UNHEX(REPLACE(?, '-', ''))
       AND nota_id = UNHEX(REPLACE(?, '-', ''))
     FOR UPDATE`,
    [pageId, notaId],
  );
  return rows[0];
}

export async function readLine(
  connection: Pick<ProtocolConnection, 'query'>,
  notaId: string,
  pageId: string,
  lineId: string,
): Promise<LineRow | undefined> {
  const rows = await connection.query<LineRow[]>(
    `SELECT HEX(id) AS id_hex, HEX(nota_id) AS nota_id_hex,
            HEX(page_id) AS page_id_hex, HEX(sku_id) AS sku_id_hex,
            line_position, sku_identifier_snapshot, sku_name_snapshot,
            kind_snapshot, quantity_pcs, unit_kind, unit_price_rupiah,
            pcs_price_rupiah, lsn_price_rupiah, line_total_rupiah,
            row_version, deleted_at, created_at, updated_at
     FROM nota_lines
     WHERE id = UNHEX(REPLACE(?, '-', ''))
       AND nota_id = UNHEX(REPLACE(?, '-', ''))
       AND page_id = UNHEX(REPLACE(?, '-', ''))
     FOR UPDATE`,
    [lineId, notaId, pageId],
  );
  return rows[0];
}

export function quantityPcs(line: UpdateLineRequest['mine']): number {
  return line.unit === 'lsn' ? line.quantity * 12 : line.quantity;
}

export function lineTotal(line: UpdateLineRequest['mine']): number {
  return line.quantity * (line.unit === 'lsn' ? line.lsnPrice : line.pcsPrice);
}

export async function insertBlankLines(
  connection: Pick<ProtocolConnection, 'query'>,
  dependencies: Dependencies,
  notaId: string,
  pageId: string,
  now: Date,
): Promise<void> {
  for (let position = 0; position < 15; position += 1) {
    await connection.query(
      `INSERT INTO nota_lines
         (id, nota_id, page_id, line_position, sku_identifier_snapshot,
          sku_name_snapshot, kind_snapshot, quantity_pcs, unit_kind,
          unit_price_rupiah, pcs_price_rupiah, lsn_price_rupiah,
          line_total_rupiah, row_version, created_at, updated_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
          UNHEX(REPLACE(?, '-', '')), ?, '', '', '', 0, 'pcs', 0, 0, 0,
          0, 1, ?, ?)`,
      [dependencies.uuid(), notaId, pageId, position, now, now],
    );
  }
}
