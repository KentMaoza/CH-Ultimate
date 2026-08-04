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

export class MariaDbNotaHeaderRepository {
  private readonly dependencies: Dependencies;

  constructor(dependencies: Partial<Dependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  updateHeader = async (
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    id: string,
    input: UpdateHeaderRequest,
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
      'header',
      { action: 'header', input },
    );
    if (lifecycleConflict) return lifecycleConflict;
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
        { action: 'header', input },
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
      await notaVersionState(connection, updated),
    );
  };

}
