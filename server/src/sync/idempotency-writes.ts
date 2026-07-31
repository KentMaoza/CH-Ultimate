import { randomUUID } from 'node:crypto';

import {
  IdempotencyError,
  type IdempotentMutation,
  type ProtocolConnection,
} from './idempotency-contract.js';
import { canonicalizeJson } from './idempotency-json.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new IdempotencyError(
      'INVALID_IDEMPOTENCY_REQUEST',
      400,
      `${field} must be a UUID`,
    );
  }
}

export function assertMutation(
  mutation: IdempotentMutation<unknown>,
): void {
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

export async function writeMutationSideEffects(
  connection: ProtocolConnection,
  deviceId: string,
  mutation: IdempotentMutation<unknown>,
): Promise<void> {
  for (const audit of mutation.audits) {
    await connection.query(
      `INSERT INTO audit_events
         (id, device_id, action, entity_type, entity_id, detail_json)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?, ?,
          CASE WHEN ? IS NULL THEN NULL ELSE UNHEX(REPLACE(?, '-', '')) END,
          ?)`,
      [
        randomUUID(),
        deviceId,
        audit.action,
        audit.entityType,
        audit.entityId,
        audit.entityId,
        canonicalizeJson(audit.detail),
      ],
    );
  }
  for (const change of mutation.changes) {
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
}
