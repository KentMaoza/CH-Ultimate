import { randomUUID } from 'node:crypto';

import { databaseDate, hexToUuid, nullableHexToUuid } from '../auth/mariadb-row-utils.js';
import {
  writeOperationAudit,
  writeOperationChange,
} from '../catalogue/mariadb-operation-writes.js';
import { canonicalizeJson, type IdempotentMutation, type ProtocolConnection } from '../sync/idempotency.js';
import {
  decideLineMutation,
  mergeHeaderFields,
  parseNotaStoredJson,
  versionConflict,
} from './conflicts.js';
import { formatWitaBusinessDate, formatWitaNotaNumber } from './numbering.js';
import {
  completionPosting,
  restorePosting,
  reversalPosting,
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

type Mutation = IdempotentMutation<Record<string, unknown>>;

interface Dependencies {
  uuid(): string;
  now(): Date;
}

const defaults: Dependencies = {
  uuid: randomUUID,
  now: () => new Date(),
};

interface NotaRow extends Record<string, unknown> {
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

interface PageRow extends Record<string, unknown> {
  id_hex: unknown;
  nota_id_hex: unknown;
  page_position: unknown;
  status: unknown;
  row_version: unknown;
  lifecycle_version: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface LineRow extends Record<string, unknown> {
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

function jsonRecord(value: unknown): Record<string, unknown> {
  const parsed = parseNotaStoredJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function iso(value: unknown): string {
  return databaseDate(value).toISOString();
}

function noteSuffix(index: number): string {
  let value = index + 1;
  let suffix = '';
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return suffix;
}

function coreNotaPayload(row: NotaRow): Record<string, unknown> {
  return {
    id: hexToUuid(row.id_hex),
    notaNumber: String(row.nota_number),
    businessDate: String(row.business_date),
    status: String(row.status),
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

function corePagePayload(row: PageRow): Record<string, unknown> {
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

function lineValue(row: LineRow): Record<string, unknown> {
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

function coreLinePayload(row: LineRow): Record<string, unknown> {
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

async function readNota(
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

async function readPages(
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

async function readLines(
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

function editable(row: NotaRow): void {
  if (!['draft', 'reopened'].includes(String(row.status))) {
    throw new NotaOperationError(
      'NOTA_NOT_EDITABLE',
      409,
      'Completed or cancelled Nota cannot be edited',
    );
  }
}

async function domainEntity(
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
    postedLines: [],
    postedStockEffects: {},
    postedTrackedLineIds: {},
    ...(row.cancelled_from_status
      ? { cancelledFromStatus: String(row.cancelled_from_status) }
      : {}),
  };
}

async function requireNota(
  connection: Pick<ProtocolConnection, 'query'>,
  id: string,
): Promise<NotaRow> {
  const row = await readNota(connection, id);
  if (!row) {
    throw new NotaOperationError('NOTA_NOT_FOUND', 404, 'Nota not found');
  }
  return row;
}

async function conflictMutation(
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

async function emitNota(
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

function mutationBody(
  revision: string,
  version: string,
  entity: Record<string, unknown>,
): Mutation {
  return {
    statusCode: 200,
    body: {
      serverRevision: revision,
      entityVersion: version,
      entity,
    },
    audits: [],
    changes: [],
  };
}

async function readPage(
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

async function readLine(
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

function quantityPcs(line: UpdateLineRequest['mine']): number {
  return line.unit === 'lsn' ? line.quantity * 12 : line.quantity;
}

function lineTotal(line: UpdateLineRequest['mine']): number {
  return line.quantity * (line.unit === 'lsn' ? line.lsnPrice : line.pcsPrice);
}

async function insertBlankLines(
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

export class MariaDbNotaRepository implements NotaRepository {
  private readonly dependencies: Dependencies;

  constructor(dependencies: Partial<Dependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  create = async (
    connection: ProtocolConnection,
    deviceId: string,
    _input: CreateNotaRequest,
  ): Promise<Mutation> => {
    const now = this.dependencies.now();
    const businessDate = formatWitaBusinessDate(now);
    const result = await connection.query<{ insertId?: unknown }>(
      `INSERT INTO nota_daily_sequences (business_date, next_sequence)
       VALUES (?, LAST_INSERT_ID(1))
       ON DUPLICATE KEY UPDATE
         next_sequence = LAST_INSERT_ID(next_sequence + 1)`,
      [businessDate],
    );
    const sequence = Number(result.insertId);
    const id = this.dependencies.uuid();
    const pageId = this.dependencies.uuid();
    const header = {
      customerName: '',
      customerPlace: '',
      transactionDate: businessDate,
      payment: 'unclassified',
    };
    const versions = {
      customerName: '1',
      customerPlace: '1',
      transactionDate: '1',
      payment: '1',
    };
    await connection.query(
      `INSERT INTO notas
         (id, nota_number, business_date, status, header_json, field_versions,
          structure_version, lifecycle_version, created_by_device_id,
          created_at, updated_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), ?, ?, 'draft', ?, ?, 1, 1,
          UNHEX(REPLACE(?, '-', '')), ?, ?)`,
      [
        id,
        formatWitaNotaNumber(businessDate, sequence),
        businessDate,
        canonicalizeJson(header),
        canonicalizeJson(versions),
        deviceId,
        now,
        now,
      ],
    );
    await connection.query(
      `INSERT INTO nota_pages
         (id, nota_id, page_position, status, row_version,
          lifecycle_version, created_at, updated_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
          0, 'active', 1, 1, ?, ?)`,
      [pageId, id, now, now],
    );
    await insertBlankLines(connection, this.dependencies, id, pageId, now);
    const row = await requireNota(connection, id);
    let revision = await writeOperationChange(
      connection,
      'nota',
      id,
      coreNotaPayload(row),
      now,
    );
    const page = await readPage(connection, id, pageId);
    if (!page) throw new Error('Created Nota page was not found');
    revision = await writeOperationChange(
      connection,
      'nota_page',
      pageId,
      corePagePayload(page),
      now,
    );
    for (const line of await readLines(connection, id)) {
      revision = await writeOperationChange(
        connection,
        'nota_line',
        hexToUuid(line.id_hex),
        coreLinePayload(line),
        now,
      );
    }
    await writeOperationAudit(
      connection,
      deviceId,
      'nota.create',
      'nota',
      id,
      { notaNumber: row.nota_number },
      now,
    );
    return {
      ...mutationBody(revision, '1', await domainEntity(connection, row)),
      statusCode: 201,
    };
  };

  addPage = async (
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    id: string,
    input: AddPageRequest,
  ): Promise<Mutation> => {
    const row = await requireNota(connection, id);
    editable(row);
    const check = versionConflict(
      String(row.structure_version),
      input.structureVersion,
      { structureVersion: input.structureVersion },
      { action: 'add-page' },
      { structureVersion: String(row.structure_version) },
    );
    if (check.kind === 'conflict') {
      return conflictMutation(
        connection,
        this.dependencies,
        deviceId,
        operationId,
        id,
        { entityType: 'nota', ...check },
        { action: 'add-page' },
      );
    }
    const pages = await readPages(connection, id);
    const position =
      pages.reduce(
        (maximum, page) => Math.max(maximum, Number(page.page_position)),
        -1,
      ) + 1;
    const pageId = this.dependencies.uuid();
    const now = this.dependencies.now();
    await connection.query(
      `INSERT INTO nota_pages
         (id, nota_id, page_position, status, row_version,
          lifecycle_version, created_at, updated_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?,
          'active', 1, 1, ?, ?)`,
      [pageId, id, position, now, now],
    );
    await insertBlankLines(connection, this.dependencies, id, pageId, now);
    await connection.query(
      `UPDATE notas SET structure_version = structure_version + 1,
                        updated_at = ?
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [now, id],
    );
    const page = await readPage(connection, id, pageId);
    if (!page) throw new Error('Created page was not found');
    let revision = await writeOperationChange(
      connection,
      'nota_page',
      pageId,
      corePagePayload(page),
      now,
    );
    for (const line of (await readLines(connection, id)).filter(
      (item) => hexToUuid(item.page_id_hex) === pageId,
    )) {
      revision = await writeOperationChange(
        connection,
        'nota_line',
        hexToUuid(line.id_hex),
        coreLinePayload(line),
        now,
      );
    }
    const updatedNota = await requireNota(connection, id);
    revision = await writeOperationChange(
      connection,
      'nota',
      id,
      coreNotaPayload(updatedNota),
      now,
    );
    await writeOperationAudit(
      connection,
      deviceId,
      'nota.page.add',
      'nota_page',
      pageId,
      { notaId: id, position },
      now,
    );
    return mutationBody(revision, '1', {
      id: pageId,
      suffix: noteSuffix(position),
      status: 'active',
      lines: (await readLines(connection, id))
        .filter((item) => hexToUuid(item.page_id_hex) === pageId)
        .map((item) => ({
          id: hexToUuid(item.id_hex),
          description: '',
          kind: '',
          quantity: 0,
          unit: 'pcs',
          pcsPrice: 0,
          lsnPrice: 0,
        })),
    });
  };

  cancelPage = (
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    id: string,
    pageId: string,
    input: PageLifecycleRequest,
  ) => this.pageLifecycle(connection, deviceId, operationId, id, pageId, input, 'cancelled');

  restorePage = (
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    id: string,
    pageId: string,
    input: PageLifecycleRequest,
  ) => this.pageLifecycle(connection, deviceId, operationId, id, pageId, input, 'active');

  updateHeader = async (
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    id: string,
    input: UpdateHeaderRequest,
  ): Promise<Mutation> => {
    const row = await requireNota(connection, id);
    editable(row);
    const merged = mergeHeaderFields(
      jsonRecord(row.header_json),
      Object.fromEntries(
        Object.entries(jsonRecord(row.field_versions)).map(([key, value]) => [
          key,
          String(value),
        ]),
      ),
      input.fields,
    );
    if (merged.kind === 'conflict') {
      return conflictMutation(
        connection,
        this.dependencies,
        deviceId,
        operationId,
        id,
        { entityType: 'nota', ...merged },
        { action: 'header', fields: input.fields },
      );
    }
    const now = this.dependencies.now();
    await connection.query(
      `UPDATE notas SET header_json = ?, field_versions = ?, updated_at = ?
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [
        canonicalizeJson(merged.header),
        canonicalizeJson(merged.versions),
        now,
        id,
      ],
    );
    const updated = await requireNota(connection, id);
    const emitted = await emitNota(
      connection,
      deviceId,
      'nota.header.update',
      updated,
      { fields: Object.keys(input.fields) },
      now,
    );
    return mutationBody(
      emitted.revision,
      String(updated.lifecycle_version),
      emitted.entity,
    );
  };

  updateLine = async (
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    id: string,
    pageId: string,
    lineId: string,
    input: UpdateLineRequest,
  ): Promise<Mutation> => {
    const nota = await requireNota(connection, id);
    editable(nota);
    const page = await readPage(connection, id, pageId);
    if (!page || String(page.status) !== 'active') {
      throw new NotaOperationError('NOTA_PAGE_NOT_EDITABLE', 409, 'Nota page is not active');
    }
    if (String(page.row_version) !== input.pageVersion) {
      return conflictMutation(
        connection,
        this.dependencies,
        deviceId,
        operationId,
        id,
        {
          entityType: 'nota_page',
          entityId: pageId,
          base: { rowVersion: input.pageVersion },
          mine: input.mine,
          server: corePagePayload(page),
        },
        { action: 'line', pageId, lineId, mine: input.mine },
      );
    }
    const current = await readLine(connection, id, pageId, lineId);
    const currentValue = current && !current.deleted_at ? lineValue(current) : null;
    const decision = decideLineMutation(
      current ? String(current.row_version) : null,
      currentValue,
      input.lineVersion,
      input.base,
      input.mine,
    );
    if (decision.kind === 'conflict') {
      return conflictMutation(
        connection,
        this.dependencies,
        deviceId,
        operationId,
        id,
        {
          entityType: 'nota_line',
          entityId: lineId,
          ...decision,
        },
        { action: 'line', pageId, lineId, mine: input.mine },
      );
    }
    if (input.mine.skuId) {
      const skuRows = await connection.query<Array<{ archived_at: unknown }>>(
        `SELECT archived_at FROM skus
         WHERE id = UNHEX(REPLACE(?, '-', ''))
         FOR UPDATE`,
        [input.mine.skuId],
      );
      if (!skuRows[0] || skuRows[0].archived_at) {
        throw new NotaOperationError('SKU_NOT_ACTIVE', 409, 'Archived SKU cannot be selected');
      }
    }
    const now = this.dependencies.now();
    if (!current) {
      await connection.query(
        `INSERT INTO nota_lines
           (id, nota_id, page_id, sku_id, line_position,
            sku_identifier_snapshot, sku_name_snapshot, kind_snapshot,
            quantity_pcs, unit_kind, unit_price_rupiah, pcs_price_rupiah,
            lsn_price_rupiah, line_total_rupiah, row_version, created_at,
            updated_at)
         VALUES
           (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
            UNHEX(REPLACE(?, '-', '')),
            CASE WHEN ? IS NULL THEN NULL ELSE UNHEX(REPLACE(?, '-', '')) END,
            ?, '', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          lineId,
          id,
          pageId,
          input.mine.skuId,
          input.mine.skuId,
          input.mine.linePosition,
          input.mine.description,
          input.mine.kind,
          quantityPcs(input.mine),
          input.mine.unit,
          input.mine.unit === 'lsn' ? input.mine.lsnPrice : input.mine.pcsPrice,
          input.mine.pcsPrice,
          input.mine.lsnPrice,
          lineTotal(input.mine),
          now,
          now,
        ],
      );
    } else if (decision.kind === 'apply') {
      await connection.query(
        `UPDATE nota_lines
         SET sku_id = CASE WHEN ? IS NULL THEN NULL
                           ELSE UNHEX(REPLACE(?, '-', '')) END,
             line_position = ?, sku_name_snapshot = ?, kind_snapshot = ?,
             quantity_pcs = ?, unit_kind = ?, unit_price_rupiah = ?,
             pcs_price_rupiah = ?, lsn_price_rupiah = ?,
             line_total_rupiah = ?, row_version = row_version + 1,
             deleted_at = NULL, updated_at = ?
         WHERE id = UNHEX(REPLACE(?, '-', ''))`,
        [
          input.mine.skuId,
          input.mine.skuId,
          input.mine.linePosition,
          input.mine.description,
          input.mine.kind,
          quantityPcs(input.mine),
          input.mine.unit,
          input.mine.unit === 'lsn' ? input.mine.lsnPrice : input.mine.pcsPrice,
          input.mine.pcsPrice,
          input.mine.lsnPrice,
          lineTotal(input.mine),
          now,
          lineId,
        ],
      );
    }
    const updated = await readLine(connection, id, pageId, lineId);
    if (!updated) throw new Error('Updated line was not found');
    const revision = await writeOperationChange(
      connection,
      'nota_line',
      lineId,
      coreLinePayload(updated),
      now,
    );
    await writeOperationAudit(
      connection,
      deviceId,
      'nota.line.update',
      'nota_line',
      lineId,
      { notaId: id, pageId, rowVersion: String(updated.row_version) },
      now,
    );
    return mutationBody(
      revision,
      String(updated.row_version),
      await domainEntity(connection, await requireNota(connection, id)),
    );
  };

  deleteLine = async (
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    id: string,
    pageId: string,
    lineId: string,
    input: DeleteLineRequest,
  ): Promise<Mutation> => {
    const nota = await requireNota(connection, id);
    editable(nota);
    const page = await readPage(connection, id, pageId);
    const current = await readLine(connection, id, pageId, lineId);
    if (!page || !current) {
      throw new NotaOperationError('NOTA_LINE_NOT_FOUND', 404, 'Nota line not found');
    }
    if (
      String(page.row_version) !== input.pageVersion ||
      decideLineMutation(
        String(current.row_version),
        current.deleted_at ? null : lineValue(current),
        input.lineVersion,
        input.base,
        null,
      ).kind === 'conflict'
    ) {
      return conflictMutation(
        connection,
        this.dependencies,
        deviceId,
        operationId,
        id,
        {
          entityType: 'nota_line',
          entityId: lineId,
          base: input.base,
          mine: null,
          server: current.deleted_at ? null : lineValue(current),
        },
        { action: 'delete-line', pageId, lineId },
      );
    }
    const now = this.dependencies.now();
    await connection.query(
      `UPDATE nota_lines
       SET deleted_at = ?, row_version = row_version + 1, updated_at = ?
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [now, now, lineId],
    );
    const updated = await readLine(connection, id, pageId, lineId);
    if (!updated) throw new Error('Deleted line was not found');
    const revision = await writeOperationChange(
      connection,
      'nota_line',
      lineId,
      coreLinePayload(updated),
      now,
      'delete',
    );
    await writeOperationAudit(
      connection,
      deviceId,
      'nota.line.delete',
      'nota_line',
      lineId,
      { notaId: id, pageId },
      now,
    );
    return mutationBody(
      revision,
      String(updated.row_version),
      await domainEntity(connection, await requireNota(connection, id)),
    );
  };

  complete = (
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    id: string,
    input: CompleteNotaRequest,
  ) => this.postCompletion(connection, deviceId, operationId, id, input);

  reopen = async (
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    id: string,
    input: NotaLifecycleRequest,
  ): Promise<Mutation> => {
    const row = await requireNota(connection, id);
    if (
      String(row.status) !== 'completed' ||
      String(row.lifecycle_version) !== input.lifecycleVersion
    ) {
      return this.lifecycleConflict(connection, deviceId, operationId, id, row, input, 'reopen');
    }
    return this.updateLifecycle(connection, deviceId, id, row, 'reopened', 'nota.reopen');
  };

  cancel = async (
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    id: string,
    input: NotaLifecycleRequest,
  ): Promise<Mutation> => {
    const row = await requireNota(connection, id);
    if (
      !['draft', 'reopened', 'completed'].includes(String(row.status)) ||
      String(row.lifecycle_version) !== input.lifecycleVersion
    ) {
      return this.lifecycleConflict(connection, deviceId, operationId, id, row, input, 'cancel');
    }
    if (String(row.status) === 'completed') {
      await this.reversePosting(connection, deviceId, operationId, id, row, 'cancel');
    }
    return this.updateLifecycle(
      connection,
      deviceId,
      id,
      row,
      'cancelled',
      'nota.cancel',
      String(row.status),
    );
  };

  restore = async (
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    id: string,
    input: NotaLifecycleRequest,
  ): Promise<Mutation> => {
    const row = await requireNota(connection, id);
    if (
      String(row.status) !== 'cancelled' ||
      String(row.lifecycle_version) !== input.lifecycleVersion
    ) {
      return this.lifecycleConflict(connection, deviceId, operationId, id, row, input, 'restore');
    }
    const target = String(row.cancelled_from_status ?? 'draft');
    if (target === 'completed') {
      await this.reapplyPosting(connection, deviceId, operationId, id, row);
    }
    return this.updateLifecycle(
      connection,
      deviceId,
      id,
      row,
      target,
      'nota.restore',
    );
  };

  resolveConflict = async (
    connection: ProtocolConnection,
    deviceId: string,
    _operationId: string,
    id: string,
    input: ResolveConflictRequest,
  ): Promise<Mutation> => {
    const rows = await connection.query<Array<Record<string, unknown>>>(
      `SELECT HEX(id) AS id_hex, HEX(nota_id) AS nota_id_hex,
              entity_type, HEX(entity_id) AS entity_id_hex, field_name,
              mine_json, intent_json, resolved_choice
       FROM nota_conflicts
       WHERE id = UNHEX(REPLACE(?, '-', ''))
       FOR UPDATE`,
      [id],
    );
    const conflict = rows[0];
    if (!conflict) {
      throw new NotaOperationError('CONFLICT_NOT_FOUND', 404, 'Conflict not found');
    }
    const notaId = hexToUuid(conflict.nota_id_hex);
    if (conflict.resolved_choice) {
      const row = await requireNota(connection, notaId);
      return mutationBody(
        '0',
        String(row.lifecycle_version),
        await domainEntity(connection, row),
      );
    }
    const now = this.dependencies.now();
    if (input.choice === 'mine') {
      const intent = jsonRecord(conflict.intent_json);
      const row = await requireNota(connection, notaId);
      editable(row);
      if (intent.action === 'header') {
        const mine = parseNotaStoredJson(conflict.mine_json);
        const header = jsonRecord(row.header_json);
        const versions = jsonRecord(row.field_versions);
        const field = String(conflict.field_name);
        header[field] = mine;
        versions[field] = (BigInt(String(versions[field] ?? '1')) + 1n).toString();
        await connection.query(
          `UPDATE notas SET header_json = ?, field_versions = ?, updated_at = ?
           WHERE id = UNHEX(REPLACE(?, '-', ''))`,
          [canonicalizeJson(header), canonicalizeJson(versions), now, notaId],
        );
      } else if (intent.action === 'line') {
        const pageId = String(intent.pageId);
        const lineId = String(intent.lineId);
        const mine = jsonRecord(conflict.mine_json) as UpdateLineRequest['mine'];
        const page = await readPage(connection, notaId, pageId);
        const current = await readLine(connection, notaId, pageId, lineId);
        if (!page || String(page.status) !== 'active' || !current) {
          throw new NotaOperationError(
            'CONFLICT_OVERRIDE_STALE',
            409,
            'The Nota line is no longer editable',
          );
        }
        if (mine.skuId) {
          const skuRows = await connection.query<Array<{ archived_at: unknown }>>(
            `SELECT archived_at FROM skus
             WHERE id = UNHEX(REPLACE(?, '-', ''))
             FOR UPDATE`,
            [mine.skuId],
          );
          if (!skuRows[0] || skuRows[0].archived_at) {
            throw new NotaOperationError(
              'SKU_NOT_ACTIVE',
              409,
              'Archived SKU cannot be selected',
            );
          }
        }
        await connection.query(
          `UPDATE nota_lines
           SET sku_id = CASE WHEN ? IS NULL THEN NULL
                             ELSE UNHEX(REPLACE(?, '-', '')) END,
               line_position = ?, sku_name_snapshot = ?, kind_snapshot = ?,
               quantity_pcs = ?, unit_kind = ?, unit_price_rupiah = ?,
               pcs_price_rupiah = ?, lsn_price_rupiah = ?,
               line_total_rupiah = ?, row_version = row_version + 1,
               deleted_at = NULL, updated_at = ?
           WHERE id = UNHEX(REPLACE(?, '-', ''))`,
          [
            mine.skuId,
            mine.skuId,
            mine.linePosition,
            mine.description,
            mine.kind,
            quantityPcs(mine),
            mine.unit,
            mine.unit === 'lsn' ? mine.lsnPrice : mine.pcsPrice,
            mine.pcsPrice,
            mine.lsnPrice,
            lineTotal(mine),
            now,
            lineId,
          ],
        );
        const updatedLine = await readLine(connection, notaId, pageId, lineId);
        if (!updatedLine) throw new Error('Overridden line was not found');
        await writeOperationChange(
          connection,
          'nota_line',
          lineId,
          coreLinePayload(updatedLine),
          now,
        );
      } else {
        throw new NotaOperationError(
          'CONFLICT_OVERRIDE_UNSUPPORTED',
          409,
          'This conflict must be edited again from the latest Nota',
        );
      }
    }
    await connection.query(
      `UPDATE nota_conflicts
       SET resolved_choice = ?, resolved_by_device_id = UNHEX(REPLACE(?, '-', '')),
           resolved_at = ?
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [input.choice, deviceId, now, id],
    );
    const row = await requireNota(connection, notaId);
    const emitted = await emitNota(
      connection,
      deviceId,
      input.choice === 'mine'
        ? 'nota.conflict.override'
        : 'nota.conflict.discard',
      row,
      { conflictId: id, choice: input.choice },
      now,
    );
    return mutationBody(
      emitted.revision,
      String(row.lifecycle_version),
      emitted.entity,
    );
  };

  private async pageLifecycle(
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    id: string,
    pageId: string,
    input: PageLifecycleRequest,
    nextStatus: 'active' | 'cancelled',
  ): Promise<Mutation> {
    const nota = await requireNota(connection, id);
    editable(nota);
    const page = await readPage(connection, id, pageId);
    if (!page) throw new NotaOperationError('NOTA_PAGE_NOT_FOUND', 404, 'Nota page not found');
    if (
      String(nota.structure_version) !== input.structureVersion ||
      String(page.lifecycle_version) !== input.pageVersion
    ) {
      return conflictMutation(
        connection,
        this.dependencies,
        deviceId,
        operationId,
        id,
        {
          entityType: 'nota_page',
          entityId: pageId,
          base: {
            structureVersion: input.structureVersion,
            pageVersion: input.pageVersion,
          },
          mine: { status: nextStatus },
          server: {
            structureVersion: String(nota.structure_version),
            pageVersion: String(page.lifecycle_version),
            status: String(page.status),
          },
        },
        { action: nextStatus === 'active' ? 'restore-page' : 'cancel-page', pageId },
      );
    }
    if (
      nextStatus === 'cancelled' &&
      (await readPages(connection, id)).filter((item) => String(item.status) === 'active').length <= 1
    ) {
      throw new NotaOperationError('LAST_ACTIVE_PAGE', 409, 'At least one page must remain active');
    }
    const now = this.dependencies.now();
    await connection.query(
      `UPDATE nota_pages
       SET status = ?, row_version = row_version + 1,
           lifecycle_version = lifecycle_version + 1, updated_at = ?
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [nextStatus, now, pageId],
    );
    await connection.query(
      `UPDATE notas SET structure_version = structure_version + 1,
                        updated_at = ?
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [now, id],
    );
    const updated = await readPage(connection, id, pageId);
    if (!updated) throw new Error('Updated page was not found');
    let revision = await writeOperationChange(
      connection,
      'nota_page',
      pageId,
      corePagePayload(updated),
      now,
    );
    const updatedNota = await requireNota(connection, id);
    revision = await writeOperationChange(
      connection,
      'nota',
      id,
      coreNotaPayload(updatedNota),
      now,
    );
    await writeOperationAudit(
      connection,
      deviceId,
      `nota.page.${nextStatus === 'active' ? 'restore' : 'cancel'}`,
      'nota_page',
      pageId,
      { notaId: id },
      now,
    );
    return mutationBody(
      revision,
      String(updated.lifecycle_version),
      await domainEntity(connection, await requireNota(connection, id)),
    );
  }

  private async lifecycleConflict(
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    id: string,
    row: NotaRow,
    input: NotaLifecycleRequest,
    action: string,
  ): Promise<Mutation> {
    return conflictMutation(
      connection,
      this.dependencies,
      deviceId,
      operationId,
      id,
      {
        entityType: 'nota',
        base: { lifecycleVersion: input.lifecycleVersion },
        mine: { action },
        server: {
          status: String(row.status),
          lifecycleVersion: String(row.lifecycle_version),
        },
      },
      { action },
    );
  }

  private async updateLifecycle(
    connection: ProtocolConnection,
    deviceId: string,
    id: string,
    current: NotaRow,
    status: string,
    action: string,
    cancelledFrom?: string,
  ): Promise<Mutation> {
    const now = this.dependencies.now();
    await connection.query(
      `UPDATE notas
       SET status = ?, cancelled_from_status = ?,
           lifecycle_version = lifecycle_version + 1,
           cancelled_at = CASE WHEN ? = 'cancelled' THEN ? ELSE NULL END,
           updated_at = ?
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [status, cancelledFrom ?? null, status, now, now, id],
    );
    const row = await requireNota(connection, id);
    const emitted = await emitNota(
      connection,
      deviceId,
      action,
      row,
      { from: String(current.status), to: status },
      now,
    );
    return mutationBody(
      emitted.revision,
      String(row.lifecycle_version),
      emitted.entity,
    );
  }

  private async postCompletion(
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    id: string,
    input: CompleteNotaRequest,
  ): Promise<Mutation> {
    const row = await requireNota(connection, id);
    editable(row);
    if (String(row.lifecycle_version) !== input.lifecycleVersion) {
      return this.lifecycleConflict(connection, deviceId, operationId, id, row, input, 'complete');
    }
    const pages = await readPages(connection, id);
    const activePageIds = new Set(
      pages
        .filter((page) => String(page.status) === 'active')
        .map((page) => hexToUuid(page.id_hex)),
    );
    const lines = (await readLines(connection, id)).filter(
      (line) =>
        !line.deleted_at && activePageIds.has(hexToUuid(line.page_id_hex)),
    );
    const trackedSkuIds = new Set<string>();
    for (const skuId of new Set(
      lines
        .map((line) => nullableHexToUuid(line.sku_id_hex))
        .filter((value): value is string => Boolean(value)),
    )) {
      await connection.query(
        `SELECT id FROM skus
         WHERE id = UNHEX(REPLACE(?, '-', ''))
         FOR UPDATE`,
        [skuId],
      );
      const balances = await connection.query<Array<Record<string, unknown>>>(
        `SELECT sku_id FROM stock_balances
         WHERE sku_id = UNHEX(REPLACE(?, '-', ''))
         FOR UPDATE`,
        [skuId],
      );
      if (balances[0]) trackedSkuIds.add(skuId);
    }
    const previous = await this.latestSnapshot(connection, id);
    const posting = completionPosting(
      lines.map((line) => ({
        skuId: trackedSkuIds.has(nullableHexToUuid(line.sku_id_hex) ?? '')
          ? nullableHexToUuid(line.sku_id_hex)
          : null,
        quantityPcs: BigInt(String(line.quantity_pcs)),
        lineTotalRupiah: BigInt(String(line.line_total_rupiah)),
      })),
      previous
        ? {
            amountRupiah: previous.amount,
            stockEffects: previous.effects,
          }
        : null,
    );
    const now = this.dependencies.now();
    const nextLifecycle = (BigInt(String(row.lifecycle_version)) + 1n).toString();
    const postingId = await this.writePosting(
      connection,
      deviceId,
      operationId,
      id,
      String(row.status) === 'reopened' ? 'recomplete' : 'complete',
      posting.amountRupiah,
      posting.snapshotEffects,
      posting.movementEffects,
      posting.revenueDeltaRupiah,
      nextLifecycle,
      now,
    );
    await connection.query(
      `UPDATE notas
       SET status = 'completed', completion_destination = ?,
           subtotal_rupiah = ?, total_rupiah = ?,
           lifecycle_version = ?, completed_at = ?, cancelled_at = NULL,
           cancelled_from_status = NULL, updated_at = ?
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [
        input.destination,
        posting.amountRupiah,
        posting.amountRupiah,
        nextLifecycle,
        now,
        now,
        id,
      ],
    );
    const updated = await requireNota(connection, id);
    const emitted = await emitNota(
      connection,
      deviceId,
      'nota.complete',
      updated,
      { postingId, totalRupiah: posting.amountRupiah.toString() },
      now,
    );
    return mutationBody(emitted.revision, nextLifecycle, emitted.entity);
  }

  private async latestSnapshot(
    connection: Pick<ProtocolConnection, 'query'>,
    id: string,
  ): Promise<{ amount: bigint; effects: Map<string, bigint>; postingId: string } | null> {
    const rows = await connection.query<Array<Record<string, unknown>>>(
      `SELECT HEX(id) AS id_hex, amount_rupiah, snapshot_json
       FROM nota_postings
       WHERE nota_id = UNHEX(REPLACE(?, '-', ''))
         AND posting_kind IN ('complete', 'recomplete', 'restore')
       ORDER BY lifecycle_version DESC, posted_at DESC
       LIMIT 1
       FOR UPDATE`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    const snapshot = jsonRecord(row.snapshot_json);
    const effects = new Map<string, bigint>(
      Object.entries(jsonRecord(snapshot.stockEffects)).map(([skuId, delta]) => [
        skuId,
        BigInt(String(delta)),
      ]),
    );
    return {
      amount: BigInt(String(row.amount_rupiah)),
      effects,
      postingId: hexToUuid(row.id_hex),
    };
  }

  private async writePosting(
    connection: Pick<ProtocolConnection, 'query'>,
    deviceId: string,
    operationId: string,
    notaId: string,
    kind: string,
    amount: bigint,
    snapshotEffects: Map<string, bigint>,
    movementEffects: Map<string, bigint>,
    revenueDelta: bigint,
    lifecycleVersion: string,
    now: Date,
    reversesPostingId?: string,
  ): Promise<string> {
    const postingId = this.dependencies.uuid();
    await connection.query(
      `INSERT INTO nota_postings
         (id, nota_id, posting_kind, amount_rupiah, snapshot_json,
          lifecycle_version, reverses_posting_id, posted_by_device_id, posted_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?, ?, ?, ?,
          CASE WHEN ? IS NULL THEN NULL ELSE UNHEX(REPLACE(?, '-', '')) END,
          UNHEX(REPLACE(?, '-', '')), ?)`,
      [
        postingId,
        notaId,
        kind,
        amount,
        canonicalizeJson({
          stockEffects: Object.fromEntries(
            [...snapshotEffects].map(([skuId, delta]) => [skuId, delta.toString()]),
          ),
        }),
        lifecycleVersion,
        reversesPostingId ?? null,
        reversesPostingId ?? null,
        deviceId,
        now,
      ],
    );
    for (const [skuId, delta] of movementEffects) {
      if (delta === 0n) continue;
      await connection.query(
        `SELECT id FROM skus
         WHERE id = UNHEX(REPLACE(?, '-', ''))
         FOR UPDATE`,
        [skuId],
      );
      const balances = await connection.query<Array<Record<string, unknown>>>(
        `SELECT quantity_pcs, row_version
         FROM stock_balances
         WHERE sku_id = UNHEX(REPLACE(?, '-', ''))
         FOR UPDATE`,
        [skuId],
      );
      if (!balances[0]) continue;
      const beforeQuantity = BigInt(String(balances[0].quantity_pcs));
      const beforeVersion = BigInt(String(balances[0].row_version));
      const afterQuantity = beforeQuantity + delta;
      const afterVersion = beforeVersion + 1n;
      await connection.query(
        `UPDATE stock_balances
         SET quantity_pcs = quantity_pcs + ?,
             row_version = row_version + 1, updated_at = ?
         WHERE sku_id = UNHEX(REPLACE(?, '-', ''))`,
        [delta, now, skuId],
      );
      const movementId = this.dependencies.uuid();
      await connection.query(
        `INSERT INTO stock_movements
           (id, sku_id, delta_pcs, reason, nota_posting_id, device_id,
            operation_id, created_at)
         VALUES
           (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?,
            ?, UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
            UNHEX(REPLACE(?, '-', '')), ?)`,
        [
          movementId,
          skuId,
          delta,
          kind.includes('reversal') ? 'nota_reversal' : 'nota_posting',
          postingId,
          deviceId,
          operationId,
          now,
        ],
      );
      await writeOperationChange(
        connection,
        'stock_balance',
        skuId,
        {
          skuId,
          quantityPcs: afterQuantity.toString(),
          rowVersion: afterVersion.toString(),
          updatedAt: now.toISOString(),
        },
        now,
      );
      await writeOperationChange(
        connection,
        'stock_movement',
        movementId,
        {
          id: movementId,
          skuId,
          deltaPcs: delta.toString(),
          reason: kind.includes('reversal') ? 'nota_reversal' : 'nota_posting',
          deviceId,
          operationId,
          createdAt: now.toISOString(),
          beforeQuantityPcs: beforeQuantity.toString(),
          afterQuantityPcs: afterQuantity.toString(),
        },
        now,
      );
    }
    await connection.query(
      `INSERT INTO revenue_postings
         (id, nota_id, nota_posting_id, amount_rupiah, posting_kind, posted_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
          UNHEX(REPLACE(?, '-', '')), ?, ?, ?)`,
      [this.dependencies.uuid(), notaId, postingId, revenueDelta, kind, now],
    );
    return postingId;
  }

  private async reversePosting(
    connection: Pick<ProtocolConnection, 'query'>,
    deviceId: string,
    operationId: string,
    id: string,
    row: NotaRow,
    kind: string,
  ): Promise<void> {
    const latest = await this.latestSnapshot(connection, id);
    if (!latest) throw new Error('Completed Nota posting snapshot is missing');
    const posting = reversalPosting({
      amountRupiah: latest.amount,
      stockEffects: latest.effects,
    });
    await this.writePosting(
      connection,
      deviceId,
      operationId,
      id,
      `${kind}_reversal`,
      posting.amountRupiah,
      posting.snapshotEffects,
      posting.movementEffects,
      posting.revenueDeltaRupiah,
      (BigInt(String(row.lifecycle_version)) + 1n).toString(),
      this.dependencies.now(),
      latest.postingId,
    );
  }

  private async reapplyPosting(
    connection: Pick<ProtocolConnection, 'query'>,
    deviceId: string,
    operationId: string,
    id: string,
    row: NotaRow,
  ): Promise<void> {
    const latest = await this.latestSnapshot(connection, id);
    if (!latest) throw new Error('Cancelled Nota posting snapshot is missing');
    const posting = restorePosting({
      amountRupiah: latest.amount,
      stockEffects: latest.effects,
    });
    await this.writePosting(
      connection,
      deviceId,
      operationId,
      id,
      'restore',
      posting.amountRupiah,
      posting.snapshotEffects,
      posting.movementEffects,
      posting.revenueDeltaRupiah,
      (BigInt(String(row.lifecycle_version)) + 1n).toString(),
      this.dependencies.now(),
    );
  }
}
