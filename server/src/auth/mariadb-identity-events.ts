import { randomUUID } from 'node:crypto';

import type {
  IdentityAuditEvent,
  IdentityChangeEvent,
} from './identity-types.js';
import type { ProtocolConnection } from '../sync/idempotency.js';
import { canonicalizeJson } from '../sync/idempotency.js';

export class MariaDbIdentityEvents {
  constructor(private readonly connection: ProtocolConnection) {}

  async writeAudit(event: IdentityAuditEvent): Promise<void> {
    await this.connection.query(
      `INSERT INTO audit_events
         (id, device_id, action, entity_type, entity_id, detail_json)
       VALUES
         (UNHEX(REPLACE(?, '-', '')),
          CASE WHEN ? IS NULL THEN NULL ELSE UNHEX(REPLACE(?, '-', '')) END,
          ?, ?, UNHEX(REPLACE(?, '-', '')), ?)`,
      [
        randomUUID(),
        event.deviceId,
        event.deviceId,
        event.action,
        event.entityType,
        event.entityId,
        canonicalizeJson(event.detail),
      ],
    );
  }

  async writeChange(event: IdentityChangeEvent): Promise<void> {
    await this.connection.query(
      `INSERT INTO change_log
         (entity_type, entity_id, operation, payload_json)
       VALUES (?, UNHEX(REPLACE(?, '-', '')), ?, ?)`,
      [
        event.entityType,
        event.entityId,
        event.operation,
        canonicalizeJson(event.payload),
      ],
    );
  }
}
