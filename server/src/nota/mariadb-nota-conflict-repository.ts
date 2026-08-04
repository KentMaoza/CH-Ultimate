import type { ProtocolConnection } from '../sync/idempotency.js';
import type { NotaRepository } from './service.js';
import { NotaOperationError } from './service.js';
import type {
  AddPageRequest,
  CreateNotaRequest,
  DeleteLineRequest,
  PageLifecycleRequest,
  ResolveConflictRequest,
  UpdateHeaderRequest,
  UpdateLineRequest,
} from './validation.js';
import { addPageBody } from './validation.js';

import { planEditableConflictOverride } from './conflicts.js';
import {
  reapplyLifecycleConflictIntent,
  runRequiredLifecycleAction,
} from './mariadb-nota-conflict-lifecycle.js';
import {
  type Dependencies,
  type Mutation,
  defaults,
  domainEntity,
  emitNota,
  hexToUuid,
  jsonRecord,
  lineValue,
  mutationBody,
  notaVersionState,
  readLine,
  readPage,
  requireNota,
} from './mariadb-nota-shared.js';

type ConflictOperations = Pick<NotaRepository,
  'updateHeader' | 'updateLine' | 'deleteLine' | 'addPage' |
  'restorePage' | 'cancelPage' | 'complete' | 'reopen' | 'cancel' | 'restore'>;

export class MariaDbNotaConflictRepository {
  private readonly dependencies: Dependencies;

  constructor(
    private readonly operations: ConflictOperations,
    dependencies: Partial<Dependencies> = {},
  ) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  resolveConflict = async (
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
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
        await this.currentRevision(connection),
        String(row.lifecycle_version),
        await domainEntity(connection, row),
        await notaVersionState(connection, row),
      );
    }
    const now = this.dependencies.now();
    if (input.choice === 'mine') {
      const intent = jsonRecord(conflict.intent_json);
      await this.reapplyConflictIntent(
        connection,
        deviceId,
        operationId,
        notaId,
        intent,
      );
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
      await notaVersionState(connection, row),
    );
  };

  private async currentRevision(
    connection: Pick<ProtocolConnection, 'query'>,
  ): Promise<string> {
    const rows = await connection.query<Array<{ revision: unknown }>>(
      'SELECT COALESCE(MAX(revision), 0) AS revision FROM change_log',
    );
    return String(rows[0]?.revision ?? '0');
  }

  private async reapplyConflictIntent(
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    notaId: string,
    intent: Record<string, unknown>,
  ): Promise<void> {
    const action = String(intent.action);
    let row = await requireNota(connection, notaId);
    const editableAction = new Set([
      'header',
      'line',
      'delete-line',
      'add-page',
      'cancel-page',
      'restore-page',
    ]).has(action);
    const override = planEditableConflictOverride({
      status: String(row.status),
      cancelledFromStatus: row.cancelled_from_status,
      completionDestination: row.completion_destination,
    });
    if (editableAction) {
      for (const lifecycleAction of override.before) {
        await runRequiredLifecycleAction(
          {
            connection,
            operations: this.operations,
            deviceId,
            operationId,
            notaId,
          },
          lifecycleAction,
          override.completionDestination,
        );
      }
      row = await requireNota(connection, notaId);
    }
    const lifecycleVersion = String(row.lifecycle_version);
    const input = intent.input ? jsonRecord(intent.input) : {};
    let result: Mutation | null = null;

    if (action === 'header') {
      const header = jsonRecord(row.header_json);
      const versions = jsonRecord(row.field_versions);
      const original = input as UpdateHeaderRequest;
      const fields = Object.fromEntries(
        Object.entries(original.fields).map(([field, edit]) => [
          field,
          {
            version: String(versions[field] ?? '1'),
            base: header[field] ?? '',
            mine: edit!.mine,
          },
        ]),
      ) as UpdateHeaderRequest['fields'];
      result = await this.operations.updateHeader(
        connection,
        deviceId,
        operationId,
        notaId,
        { lifecycleVersion, fields },
      );
    } else if (action === 'line') {
      const pageId = String(intent.pageId);
      const lineId = String(intent.lineId);
      const page = await readPage(connection, notaId, pageId);
      const line = await readLine(connection, notaId, pageId, lineId);
      if (!page || !line) {
        throw new NotaOperationError(
          'CONFLICT_OVERRIDE_STALE',
          409,
          'The Nota line no longer exists',
        );
      }
      const original = input as UpdateLineRequest;
      result = await this.operations.updateLine(
        connection,
        deviceId,
        operationId,
        notaId,
        pageId,
        lineId,
        {
          lifecycleVersion,
          pageVersion: String(page.row_version),
          lineVersion: String(line.row_version),
          base: line.deleted_at ? null : lineValue(line) as UpdateLineRequest['base'],
          mine: original.mine,
        },
      );
    } else if (action === 'delete-line') {
      const pageId = String(intent.pageId);
      const lineId = String(intent.lineId);
      const page = await readPage(connection, notaId, pageId);
      const line = await readLine(connection, notaId, pageId, lineId);
      if (!page || !line) {
        throw new NotaOperationError(
          'CONFLICT_OVERRIDE_STALE',
          409,
          'The Nota line no longer exists',
        );
      }
      if (!line.deleted_at) {
        result = await this.operations.deleteLine(
          connection,
          deviceId,
          operationId,
          notaId,
          pageId,
          lineId,
          {
            lifecycleVersion,
            pageVersion: String(page.row_version),
            lineVersion: String(line.row_version),
            base: lineValue(line) as DeleteLineRequest['base'],
          },
        );
      }
    } else if (action === 'add-page') {
      const original = addPageBody.safeParse(input);
      if (!original.success) {
        throw new NotaOperationError(
          'CONFLICT_OVERRIDE_STALE',
          409,
          'The stored add-page intent is invalid',
        );
      }
      result = await this.operations.addPage(
        connection,
        deviceId,
        operationId,
        notaId,
        {
          ...original.data,
          lifecycleVersion,
          structureVersion: String(row.structure_version),
        },
      );
    } else if (action === 'cancel-page' || action === 'restore-page') {
      const pageId = String(intent.pageId);
      const page = await readPage(connection, notaId, pageId);
      if (!page) {
        throw new NotaOperationError(
          'CONFLICT_OVERRIDE_STALE',
          409,
          'The Nota page no longer exists',
        );
      }
      const desired = action === 'restore-page' ? 'active' : 'cancelled';
      if (String(page.status) !== desired) {
        const rebased = {
          lifecycleVersion,
          structureVersion: String(row.structure_version),
          pageVersion: String(page.lifecycle_version),
        };
        result = action === 'restore-page'
          ? await this.operations.restorePage(
              connection,
              deviceId,
              operationId,
              notaId,
              pageId,
              rebased,
            )
          : await this.operations.cancelPage(
              connection,
              deviceId,
              operationId,
              notaId,
              pageId,
              rebased,
            );
      }
    } else if (
      action === 'complete' ||
      action === 'reopen' ||
      action === 'cancel' ||
      action === 'restore'
    ) {
      await reapplyLifecycleConflictIntent(
        {
          connection,
          operations: this.operations,
          deviceId,
          operationId,
          notaId,
        },
        action,
        input,
      );
    } else {
      throw new NotaOperationError(
        'CONFLICT_OVERRIDE_UNSUPPORTED',
        409,
        'Unsupported Nota conflict intent',
      );
    }

    if (result && result.statusCode >= 400) {
      throw new NotaOperationError(
        'CONFLICT_OVERRIDE_STALE',
        409,
        'The Nota changed again before conflict resolution',
      );
    }
    if (editableAction) {
      for (const lifecycleAction of override.after) {
        await runRequiredLifecycleAction(
          {
            connection,
            operations: this.operations,
            deviceId,
            operationId,
            notaId,
          },
          lifecycleAction,
          override.completionDestination,
        );
      }
    }
  }
}
