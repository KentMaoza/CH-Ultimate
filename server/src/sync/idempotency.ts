import { createHash } from 'node:crypto';

import {
  IdempotencyError,
  type IdempotencyRequest,
  type IdempotencyResult,
  type IdempotentMutation,
  type ProtocolConnection,
  type ProtocolPool,
} from './idempotency-contract.js';
import {
  canonicalizeJson,
  parseStoredJson,
} from './idempotency-json.js';
import {
  assertMutation,
  assertUuid,
  writeMutationSideEffects,
} from './idempotency-writes.js';
import { acquireBusinessWriteLock } from './business-write-lock.js';

export {
  IdempotencyError,
  type AuditWrite,
  type ChangeWrite,
  type IdempotencyRequest,
  type IdempotencyResult,
  type IdempotentMutation,
  type ProtocolConnection,
  type ProtocolPool,
} from './idempotency-contract.js';
export { canonicalizeJson } from './idempotency-json.js';

export const IDEMPOTENCY_RECEIPT_TTL_MS =
  365 * 24 * 60 * 60 * 1_000;
const RESERVATION_STATUS = 102;
const MAX_RESERVATION_ATTEMPTS = 3;

interface ReceiptRow {
  payload_hash: Buffer;
  response_status: unknown;
  response_json: unknown;
}

export async function executeIdempotent<T>(
  pool: ProtocolPool,
  request: IdempotencyRequest,
  mutation: (
    connection: ProtocolConnection,
  ) => Promise<IdempotentMutation<T>>,
): Promise<IdempotencyResult<T>> {
  assertUuid(request.deviceId, 'device id');
  assertUuid(request.idempotencyKey, 'idempotency key');
  const payloadHash = createHash('sha256')
    .update(canonicalizeJson(request.payload))
    .digest();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + IDEMPOTENCY_RECEIPT_TTL_MS,
  );
  const connection = await pool.getConnection();

  try {
    for (
      let attempt = 0;
      attempt < MAX_RESERVATION_ATTEMPTS;
      attempt += 1
    ) {
      let transactionStarted = false;
      let reservationAcquired = false;
      try {
        await connection.beginTransaction();
        transactionStarted = true;
        await pruneExpiredKey(connection, request, now);
        await reserveKey(
          connection,
          request,
          payloadHash,
          expiresAt,
        );
        reservationAcquired = true;

        await acquireBusinessWriteLock(connection);
        const result = await mutation(connection);
        assertMutation(result);
        await writeMutationSideEffects(
          connection,
          request.deviceId,
          result,
        );
        await completeReservation(
          connection,
          request,
          result.statusCode,
          canonicalizeJson(result.body),
        );
        await connection.commit();
        transactionStarted = false;
        return {
          statusCode: result.statusCode,
          body: result.body,
          replayed: false,
        };
      } catch (error) {
        if (transactionStarted) {
          await rollbackPreservingOriginal(connection);
        }
        if (!reservationAcquired && isDuplicateEntry(error)) {
          let replay: IdempotencyResult<T> | null;
          try {
            replay = await readReplay<T>(
              connection,
              request,
              payloadHash,
              now,
            );
          } catch (replayError) {
            if (isRetryableLockError(replayError)) {
              continue;
            }
            throw replayError;
          }
          if (replay) {
            return replay;
          }
          continue;
        }
        if (isRetryableLockError(error)) {
          continue;
        }
        throw error;
      }
    }
    throw new Error('Could not reserve idempotency key after retries');
  } finally {
    await connection.release();
  }
}

async function pruneExpiredKey(
  connection: ProtocolConnection,
  request: IdempotencyRequest,
  now: Date,
): Promise<void> {
  await connection.query(
    `DELETE FROM idempotency_receipts
     WHERE device_id = UNHEX(REPLACE(?, '-', ''))
       AND idempotency_key = ?
       AND expires_at <= ?`,
    [request.deviceId, request.idempotencyKey, now],
  );
}

async function reserveKey(
  connection: ProtocolConnection,
  request: IdempotencyRequest,
  payloadHash: Buffer,
  expiresAt: Date,
): Promise<void> {
  await connection.query(
    `INSERT INTO idempotency_receipts
       (device_id, idempotency_key, payload_hash, response_status,
        response_json, expires_at)
     VALUES
       (UNHEX(REPLACE(?, '-', '')), ?, ?, ?, ?, ?)`,
    [
      request.deviceId,
      request.idempotencyKey,
      payloadHash,
      RESERVATION_STATUS,
      'null',
      expiresAt,
    ],
  );
}

async function completeReservation(
  connection: ProtocolConnection,
  request: IdempotencyRequest,
  statusCode: number,
  responseJson: string,
): Promise<void> {
  await connection.query(
    `UPDATE idempotency_receipts
     SET response_status = ?, response_json = ?
     WHERE device_id = UNHEX(REPLACE(?, '-', ''))
       AND idempotency_key = ?`,
    [
      statusCode,
      responseJson,
      request.deviceId,
      request.idempotencyKey,
    ],
  );
}

async function readReplay<T>(
  connection: ProtocolConnection,
  request: IdempotencyRequest,
  payloadHash: Buffer,
  now: Date,
): Promise<IdempotencyResult<T> | null> {
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const rows = await connection.query<ReceiptRow[]>(
      `SELECT payload_hash, response_status, response_json
       FROM idempotency_receipts
       WHERE device_id = UNHEX(REPLACE(?, '-', ''))
         AND idempotency_key = ?
         AND expires_at > ?
       FOR UPDATE`,
      [request.deviceId, request.idempotencyKey, now],
    );
    const existing = rows[0];
    if (!existing) {
      await connection.rollback();
      transactionStarted = false;
      return null;
    }
    const existingHash = Buffer.from(existing.payload_hash);
    if (
      existingHash.length !== payloadHash.length ||
      !existingHash.equals(payloadHash)
    ) {
      throw new IdempotencyError(
        'IDEMPOTENCY_MISMATCH',
        409,
        'Idempotency key payload mismatch',
      );
    }
    const statusCode = Number(existing.response_status);
    if (statusCode === RESERVATION_STATUS) {
      throw new Error('Committed idempotency receipt is incomplete');
    }
    await connection.commit();
    transactionStarted = false;
    return {
      statusCode,
      body: parseStoredJson(existing.response_json) as T,
      replayed: true,
    };
  } catch (error) {
    if (transactionStarted) {
      await rollbackPreservingOriginal(connection);
    }
    throw error;
  }
}

async function rollbackPreservingOriginal(
  connection: ProtocolConnection,
): Promise<void> {
  try {
    await connection.rollback();
  } catch {
    // Preserve the transaction's original failure.
  }
}

function databaseErrorNumber(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  if ('errno' in error && typeof error.errno === 'number') {
    return error.errno;
  }
  return undefined;
}

function databaseErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;
}

function isDuplicateEntry(error: unknown): boolean {
  return (
    databaseErrorNumber(error) === 1062 ||
    databaseErrorCode(error) === 'ER_DUP_ENTRY'
  );
}

function isRetryableLockError(error: unknown): boolean {
  const number = databaseErrorNumber(error);
  const code = databaseErrorCode(error);
  return (
    number === 1213 ||
    number === 1205 ||
    code === 'ER_LOCK_DEADLOCK' ||
    code === 'ER_LOCK_WAIT_TIMEOUT'
  );
}
