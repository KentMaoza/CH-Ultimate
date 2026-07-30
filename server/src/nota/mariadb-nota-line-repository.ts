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
  noteSuffix,
  quantityPcs,
  readLine,
  readLines,
  readPage,
  readPages,
  requireNota,
} from './mariadb-nota-shared.js';

export class MariaDbNotaLineRepository {
  private readonly dependencies: Dependencies;

  constructor(dependencies: Partial<Dependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies };
  }

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
    const lifecycleConflict = await editLifecycleMutation(
      connection,
      this.dependencies,
      deviceId,
      operationId,
      id,
      nota,
      input.lifecycleVersion,
      'line',
      { action: 'line', pageId, lineId, input },
    );
    if (lifecycleConflict) return lifecycleConflict;
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
        { action: 'line', pageId, lineId, input },
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
        { action: 'line', pageId, lineId, input },
      );
    }
    let skuIdentifierSnapshot = '';
    if (input.mine.skuId) {
      const skuRows = await connection.query<Array<{
        archived_at: unknown;
        primary_identifier: unknown;
      }>>(
        `SELECT primary_identifier, archived_at FROM skus
         WHERE id = UNHEX(REPLACE(?, '-', ''))
         FOR UPDATE`,
        [input.mine.skuId],
      );
      if (!skuRows[0] || skuRows[0].archived_at) {
        throw new NotaOperationError('SKU_NOT_ACTIVE', 409, 'Archived SKU cannot be selected');
      }
      skuIdentifierSnapshot = String(skuRows[0].primary_identifier);
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
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          lineId,
          id,
          pageId,
          input.mine.skuId,
          input.mine.skuId,
          input.mine.linePosition,
          skuIdentifierSnapshot,
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
             line_position = ?, sku_identifier_snapshot = ?,
             sku_name_snapshot = ?, kind_snapshot = ?,
             quantity_pcs = ?, unit_kind = ?, unit_price_rupiah = ?,
             pcs_price_rupiah = ?, lsn_price_rupiah = ?,
             line_total_rupiah = ?, row_version = row_version + 1,
             deleted_at = NULL, updated_at = ?
         WHERE id = UNHEX(REPLACE(?, '-', ''))`,
        [
          input.mine.skuId,
          input.mine.skuId,
          input.mine.linePosition,
          skuIdentifierSnapshot,
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
    const lifecycleConflict = await editLifecycleMutation(
      connection,
      this.dependencies,
      deviceId,
      operationId,
      id,
      nota,
      input.lifecycleVersion,
      'delete-line',
      { action: 'delete-line', pageId, lineId, input },
    );
    if (lifecycleConflict) return lifecycleConflict;
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
        { action: 'delete-line', pageId, lineId, input },
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

}
