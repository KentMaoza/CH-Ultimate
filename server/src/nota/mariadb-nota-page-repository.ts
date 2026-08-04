import type { ProtocolConnection } from '../sync/idempotency.js';
import { canonicalizeJson } from '../sync/idempotency.js';
import type { NotaRepository } from './service.js';
import { NotaOperationError } from './service.js';
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

import { decideLineMutation, mergeHeaderFields, versionConflict } from './conflicts.js';
import { formatWitaBusinessDate, formatWitaNotaNumber } from './numbering.js';
import { writeOperationAudit, writeOperationChange } from '../catalogue/mariadb-operation-writes.js';
import {
  type Dependencies,
  type Mutation,
  conflictMutation,
  coreLinePayload,
  coreNotaPayload,
  corePagePayload,
  defaults,
  domainEntity,
  editLifecycleMutation,
  editable,
  emitNota,
  hexToUuid,
  insertBlankLines,
  jsonRecord,
  lineTotal,
  lineValue,
  mutationBody,
  notaVersionState,
  noteSuffix,
  quantityPcs,
  readLine,
  readLines,
  readPage,
  readPages,
  requireNota,
} from './mariadb-nota-shared.js';

export class MariaDbNotaPageRepository {
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
      ...mutationBody(
        revision,
        '1',
        await domainEntity(connection, row),
        await notaVersionState(connection, row),
      ),
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
    const lifecycleConflict = await editLifecycleMutation(
      connection,
      this.dependencies,
      deviceId,
      operationId,
      id,
      row,
      input.lifecycleVersion,
      'add-page',
      { action: 'add-page', input },
    );
    if (lifecycleConflict) return lifecycleConflict;
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
        { action: 'add-page', input },
      );
    }
    const pages = await readPages(connection, id);
    const position =
      pages.reduce(
        (maximum, page) => Math.max(maximum, Number(page.page_position)),
        -1,
      ) + 1;
    const pageId = input.clientPageId ?? this.dependencies.uuid();
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
    await insertBlankLines(
      connection,
      this.dependencies,
      id,
      pageId,
      now,
      input.clientLineIds,
    );
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
    return mutationBody(
      revision,
      '1',
      {
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
      },
      await notaVersionState(connection, updatedNota),
    );
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
    const lifecycleConflict = await editLifecycleMutation(
      connection,
      this.dependencies,
      deviceId,
      operationId,
      id,
      nota,
      input.lifecycleVersion,
      nextStatus === 'active' ? 'restore-page' : 'cancel-page',
      {
        action: nextStatus === 'active' ? 'restore-page' : 'cancel-page',
        pageId,
        input,
      },
    );
    if (lifecycleConflict) return lifecycleConflict;
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
        {
          action: nextStatus === 'active' ? 'restore-page' : 'cancel-page',
          pageId,
          input,
        },
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
      await domainEntity(connection, updatedNota),
      await notaVersionState(connection, updatedNota),
    );
  }
}
