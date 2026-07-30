import {
  hexToUuid,
} from '../auth/mariadb-row-utils.js';
import {
  writeOperationChange,
} from '../catalogue/mariadb-operation-writes.js';
import {
  canonicalizeJson,
  type ProtocolConnection,
} from '../sync/idempotency.js';
import { parseNotaStoredJson } from './conflicts.js';

export interface LatestPostingSnapshot {
  amount: bigint;
  effects: Map<string, bigint>;
  lines: Record<string, unknown>[];
  trackedLineIds: Record<string, string>;
  postingId: string;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  const parsed = parseNotaStoredJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export async function readLatestPostingSnapshot(
  connection: Pick<ProtocolConnection, 'query'>,
  notaId: string,
): Promise<LatestPostingSnapshot | null> {
  const rows = await connection.query<Array<Record<string, unknown>>>(
    `SELECT HEX(id) AS id_hex, amount_rupiah, snapshot_json
     FROM nota_postings
     WHERE nota_id = UNHEX(REPLACE(?, '-', ''))
       AND posting_kind IN ('complete', 'recomplete', 'restore')
     ORDER BY lifecycle_version DESC, posted_at DESC
     LIMIT 1
     FOR UPDATE`,
    [notaId],
  );
  const row = rows[0];
  if (!row) return null;
  const snapshot = jsonRecord(row.snapshot_json);
  return {
    amount: BigInt(String(row.amount_rupiah)),
    effects: new Map(
      Object.entries(jsonRecord(snapshot.stockEffects)).map(([skuId, delta]) => [
        skuId,
        BigInt(String(delta)),
      ]),
    ),
    lines: Array.isArray(snapshot.lines)
      ? snapshot.lines.map((line) => jsonRecord(line))
      : [],
    trackedLineIds: Object.fromEntries(
      Object.entries(jsonRecord(snapshot.trackedLineIds)).map(
        ([lineId, skuId]) => [lineId, String(skuId)],
      ),
    ),
    postingId: hexToUuid(row.id_hex),
  };
}

interface WriteNotaPostingInput {
  deviceId: string;
  operationId: string;
  notaId: string;
  kind: string;
  amount: bigint;
  snapshotLines: Record<string, unknown>[];
  snapshotEffects: Map<string, bigint>;
  trackedLineIds: Record<string, string>;
  movementEffects: Map<string, bigint>;
  revenueDelta: bigint;
  lifecycleVersion: string;
  now: Date;
  reversesPostingId?: string;
}

export async function writeNotaPosting(
  connection: Pick<ProtocolConnection, 'query'>,
  uuid: () => string,
  input: WriteNotaPostingInput,
): Promise<string> {
  const postingId = uuid();
  const snapshot = {
    lines: input.snapshotLines,
    stockEffects: Object.fromEntries(
      [...input.snapshotEffects].map(([skuId, delta]) => [
        skuId,
        delta.toString(),
      ]),
    ),
    trackedLineIds: input.trackedLineIds,
  };
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
      input.notaId,
      input.kind,
      input.amount,
      canonicalizeJson(snapshot),
      input.lifecycleVersion,
      input.reversesPostingId ?? null,
      input.reversesPostingId ?? null,
      input.deviceId,
      input.now,
    ],
  );
  await writeOperationChange(
    connection,
    'nota_posting',
    postingId,
    {
      id: postingId,
      notaId: input.notaId,
      postingKind: input.kind,
      amountRupiah: input.amount.toString(),
      snapshot,
      lifecycleVersion: input.lifecycleVersion,
      reversesPostingId: input.reversesPostingId ?? null,
      postedAt: input.now.toISOString(),
    },
    input.now,
  );
  for (const [skuId, delta] of input.movementEffects) {
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
      [delta, input.now, skuId],
    );
    const movementId = uuid();
    const reason = input.kind.includes('reversal')
      ? 'nota_reversal'
      : 'nota_posting';
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
        reason,
        postingId,
        input.deviceId,
        input.operationId,
        input.now,
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
        updatedAt: input.now.toISOString(),
      },
      input.now,
    );
    await writeOperationChange(
      connection,
      'stock_movement',
      movementId,
      {
        id: movementId,
        skuId,
        deltaPcs: delta.toString(),
        reason,
        deviceId: input.deviceId,
        operationId: input.operationId,
        createdAt: input.now.toISOString(),
        beforeQuantityPcs: beforeQuantity.toString(),
        afterQuantityPcs: afterQuantity.toString(),
      },
      input.now,
    );
  }
  const revenueId = uuid();
  await connection.query(
    `INSERT INTO revenue_postings
       (id, nota_id, nota_posting_id, amount_rupiah, posting_kind, posted_at)
     VALUES
       (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
        UNHEX(REPLACE(?, '-', '')), ?, ?, ?)`,
    [
      revenueId,
      input.notaId,
      postingId,
      input.revenueDelta,
      input.kind,
      input.now,
    ],
  );
  await writeOperationChange(
    connection,
    'revenue_posting',
    revenueId,
    {
      id: revenueId,
      notaId: input.notaId,
      notaPostingId: postingId,
      amountRupiah: input.revenueDelta.toString(),
      postingKind: input.kind,
      postedAt: input.now.toISOString(),
    },
    input.now,
  );
  return postingId;
}
