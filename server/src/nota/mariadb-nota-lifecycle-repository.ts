import type { ProtocolConnection } from '../sync/idempotency.js';
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

import { writeOperationAudit, writeOperationChange } from '../catalogue/mariadb-operation-writes.js';
import {
  completionPosting,
  PostingArithmeticError,
  restorePosting,
  reversalPosting,
  shouldReapplyPostingOnRestore,
  shouldReversePostingOnCancel,
} from './posting.js';
import {
  readLatestPostingSnapshot,
  writeNotaPosting,
  type LatestPostingSnapshot,
} from './mariadb-posting-store.js';
import {
  type Dependencies,
  type Mutation,
  type NotaRow,
  conflictMutation,
  coreNotaPayload,
  defaults,
  editable,
  emitNota,
  hexToUuid,
  mutationBody,
  notaVersionState,
  nullableHexToUuid,
  postingLineSnapshot,
  readLines,
  readPages,
  requireNota,
} from './mariadb-nota-shared.js';

export class MariaDbNotaLifecycleRepository {
  private readonly dependencies: Dependencies;

  constructor(dependencies: Partial<Dependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  complete = async (
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    id: string,
    input: CompleteNotaRequest,
  ) => {
    try {
      return await this.postCompletion(
        connection,
        deviceId,
        operationId,
        id,
        input,
      );
    } catch (error) {
      this.rethrowPostingArithmetic(error);
    }
  };

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
    if (shouldReversePostingOnCancel(String(row.status))) {
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
    if (shouldReapplyPostingOnRestore(target)) {
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
      { action, input },
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
      await notaVersionState(connection, row),
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
    if (
      String(row.lifecycle_version) !== input.lifecycleVersion ||
      !['draft', 'reopened'].includes(String(row.status))
    ) {
      return this.lifecycleConflict(connection, deviceId, operationId, id, row, input, 'complete');
    }
    editable(row);
    const pages = await readPages(connection, id);
    const activePageIds = new Set(
      pages
        .filter((page) => String(page.status) === 'active')
        .map((page) => hexToUuid(page.id_hex)),
    );
    const lines = (await readLines(connection, id)).filter(
      (line) =>
        !line.deleted_at &&
        activePageIds.has(hexToUuid(line.page_id_hex)) &&
        BigInt(String(line.quantity_pcs)) > 0n,
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
    if (
      posting.amountRupiah > BigInt(Number.MAX_SAFE_INTEGER) ||
      posting.amountRupiah < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      throw new NotaOperationError(
        'NOTA_TOTAL_OUT_OF_RANGE',
        422,
        'Nota total exceeds the supported integer range',
      );
    }
    const snapshotLines = lines.map(postingLineSnapshot);
    const trackedLineIds = Object.fromEntries(
      lines.flatMap((line) => {
        const skuId = nullableHexToUuid(line.sku_id_hex);
        return skuId && trackedSkuIds.has(skuId)
          ? [[hexToUuid(line.id_hex), skuId]]
          : [];
      }),
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
      snapshotLines,
      posting.snapshotEffects,
      trackedLineIds,
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
    return mutationBody(
      emitted.revision,
      nextLifecycle,
      emitted.entity,
      await notaVersionState(connection, updated),
    );
  }

  private async latestSnapshot(
    connection: Pick<ProtocolConnection, 'query'>,
    id: string,
  ): Promise<LatestPostingSnapshot | null> {
    return readLatestPostingSnapshot(connection, id);
  }

  private async writePosting(
    connection: Pick<ProtocolConnection, 'query'>,
    deviceId: string,
    operationId: string,
    notaId: string,
    kind: string,
    amount: bigint,
    snapshotLines: Record<string, unknown>[],
    snapshotEffects: Map<string, bigint>,
    trackedLineIds: Record<string, string>,
    movementEffects: Map<string, bigint>,
    revenueDelta: bigint,
    lifecycleVersion: string,
    now: Date,
    reversesPostingId?: string,
  ): Promise<string> {
    try {
      return await writeNotaPosting(connection, this.dependencies.uuid, {
        deviceId,
        operationId,
        notaId,
        kind,
        amount,
        snapshotLines,
        snapshotEffects,
        trackedLineIds,
        movementEffects,
        revenueDelta,
        lifecycleVersion,
        now,
        ...(reversesPostingId ? { reversesPostingId } : {}),
      });
    } catch (error) {
      this.rethrowPostingArithmetic(error);
    }
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
    let posting;
    try {
      posting = reversalPosting({
        amountRupiah: latest.amount,
        stockEffects: latest.effects,
      });
    } catch (error) {
      this.rethrowPostingArithmetic(error);
    }
    await this.writePosting(
      connection,
      deviceId,
      operationId,
      id,
      `${kind}_reversal`,
      posting.amountRupiah,
      latest.lines,
      posting.snapshotEffects,
      latest.trackedLineIds,
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
    let posting;
    try {
      posting = restorePosting({
        amountRupiah: latest.amount,
        stockEffects: latest.effects,
      });
    } catch (error) {
      this.rethrowPostingArithmetic(error);
    }
    await this.writePosting(
      connection,
      deviceId,
      operationId,
      id,
      'restore',
      posting.amountRupiah,
      latest.lines,
      posting.snapshotEffects,
      latest.trackedLineIds,
      posting.movementEffects,
      posting.revenueDeltaRupiah,
      (BigInt(String(row.lifecycle_version)) + 1n).toString(),
      this.dependencies.now(),
    );
  }

  private rethrowPostingArithmetic(error: unknown): never {
    if (error instanceof PostingArithmeticError) {
      throw new NotaOperationError(
        'NOTA_ARITHMETIC_OUT_OF_RANGE',
        422,
        error.message,
      );
    }
    throw error;
  }
}
