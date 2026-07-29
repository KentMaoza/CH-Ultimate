import { createHash, randomUUID } from 'node:crypto';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ProtocolConnection {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void | Promise<void>;
  query<T = unknown>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<T>;
}

export interface ProtocolPool {
  getConnection(): Promise<ProtocolConnection>;
}

export interface AuditWrite {
  action: string;
  entityType: string;
  entityId: string | null;
  detail: unknown;
}

export interface ChangeWrite {
  entityType: string;
  entityId: string;
  operation: string;
  payload: unknown;
}

export interface IdempotentMutation<T> {
  statusCode: number;
  body: T;
  audits: AuditWrite[];
  changes: ChangeWrite[];
}

export interface IdempotencyRequest {
  deviceId: string;
  idempotencyKey: string;
  payload: unknown;
  receiptExpiresAt: Date;
}

export interface IdempotencyResult<T> {
  statusCode: number;
  body: T;
  replayed: boolean;
}

interface ReceiptRow {
  payload_hash: Buffer;
  response_status: unknown;
  response_json: unknown;
}

export class IdempotencyError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'IdempotencyError';
  }
}

function canonicalValue(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new IdempotencyError(
        'INVALID_JSON',
        400,
        'Payload must be valid JSON',
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(',')}]`;
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(object[key])}`)
      .join(',')}}`;
  }
  throw new IdempotencyError(
    'INVALID_JSON',
    400,
    'Payload must be valid JSON',
  );
}

export function canonicalizeJson(value: unknown): string {
  return canonicalValue(value);
}

function parseStoredJson(value: unknown): unknown {
  if (typeof value === 'string') {
    return JSON.parse(value);
  }
  if (Buffer.isBuffer(value)) {
    return JSON.parse(value.toString('utf8'));
  }
  return value;
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new IdempotencyError(
      'INVALID_IDEMPOTENCY_REQUEST',
      400,
      `${field} must be a UUID`,
    );
  }
}

function assertMutation(mutation: IdempotentMutation<unknown>): void {
  if (
    !Number.isInteger(mutation.statusCode) ||
    mutation.statusCode < 100 ||
    mutation.statusCode > 599
  ) {
    throw new Error('Idempotent mutation returned an invalid status code');
  }
  for (const audit of mutation.audits) {
    if (audit.entityId !== null) {
      assertUuid(audit.entityId, 'audit entity id');
    }
  }
  for (const change of mutation.changes) {
    assertUuid(change.entityId, 'change entity id');
  }
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
  if (
    !(request.receiptExpiresAt instanceof Date) ||
    Number.isNaN(request.receiptExpiresAt.getTime())
  ) {
    throw new IdempotencyError(
      'INVALID_IDEMPOTENCY_REQUEST',
      400,
      'Receipt expiry is invalid',
    );
  }

  const canonicalPayload = canonicalizeJson(request.payload);
  const payloadHash = createHash('sha256').update(canonicalPayload).digest();
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const receipts = await connection.query<ReceiptRow[]>(
      `SELECT payload_hash, response_status, response_json
       FROM idempotency_receipts
       WHERE device_id = UNHEX(REPLACE(?, '-', ''))
         AND idempotency_key = ?
       FOR UPDATE`,
      [request.deviceId, request.idempotencyKey],
    );
    const existing = receipts[0];
    if (existing) {
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
      await connection.commit();
      transactionStarted = false;
      return {
        statusCode: Number(existing.response_status),
        body: parseStoredJson(existing.response_json) as T,
        replayed: true,
      };
    }

    const result = await mutation(connection);
    assertMutation(result);
    const responseJson = canonicalizeJson(result.body);

    for (const audit of result.audits) {
      await connection.query(
        `INSERT INTO audit_events
           (id, device_id, action, entity_type, entity_id, detail_json)
         VALUES
           (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?, ?,
            CASE WHEN ? IS NULL THEN NULL ELSE UNHEX(REPLACE(?, '-', '')) END,
            ?)`,
        [
          randomUUID(),
          request.deviceId,
          audit.action,
          audit.entityType,
          audit.entityId,
          audit.entityId,
          canonicalizeJson(audit.detail),
        ],
      );
    }
    for (const change of result.changes) {
      await connection.query(
        `INSERT INTO change_log
           (entity_type, entity_id, operation, payload_json)
         VALUES (?, UNHEX(REPLACE(?, '-', '')), ?, ?)`,
        [
          change.entityType,
          change.entityId,
          change.operation,
          canonicalizeJson(change.payload),
        ],
      );
    }
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
        result.statusCode,
        responseJson,
        request.receiptExpiresAt,
      ],
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
      try {
        await connection.rollback();
      } catch {
        // Preserve the transaction's original failure.
      }
    }
    throw error;
  } finally {
    await connection.release();
  }
}
