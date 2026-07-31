import { randomUUID } from 'node:crypto';

import type { ProtocolConnection } from '../sync/idempotency.js';
import { canonicalizeJson } from '../sync/idempotency.js';

interface InsertResult {
  insertId?: bigint | number | string;
}

export async function writeOperationAudit(
  connection: Pick<ProtocolConnection, 'query'>,
  deviceId: string,
  action: string,
  entityType: string,
  entityId: string,
  detail: unknown,
  createdAt: Date,
): Promise<void> {
  await connection.query(
    `INSERT INTO audit_events
       (id, device_id, action, entity_type, entity_id, detail_json, created_at)
     VALUES
       (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?, ?,
        UNHEX(REPLACE(?, '-', '')), ?, ?)`,
    [
      randomUUID(),
      deviceId,
      action,
      entityType,
      entityId,
      canonicalizeJson(detail),
      createdAt,
    ],
  );
}

export async function writeOperationChange(
  connection: Pick<ProtocolConnection, 'query'>,
  entityType: string,
  entityId: string,
  payload: unknown,
  createdAt: Date,
  operation = 'upsert',
): Promise<string> {
  const result = await connection.query<InsertResult>(
    `INSERT INTO change_log
       (entity_type, entity_id, operation, payload_json, created_at)
     VALUES (?, UNHEX(REPLACE(?, '-', '')), ?, ?, ?)`,
    [
      entityType,
      entityId,
      operation,
      canonicalizeJson(payload),
      createdAt,
    ],
  );
  if (result.insertId === undefined) {
    throw new Error('Change sequence was not returned');
  }
  return String(result.insertId);
}
