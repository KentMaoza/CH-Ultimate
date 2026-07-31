import {
  databaseDate,
  hexToUuid,
} from '../auth/mariadb-row-utils.js';
import type { ProtocolConnection } from './idempotency.js';
import type { ChangeRecord } from './service.js';

function parseJson(value: unknown): unknown {
  if (typeof value === 'string') {
    return JSON.parse(value);
  }
  if (Buffer.isBuffer(value)) {
    return JSON.parse(value.toString('utf8'));
  }
  return value;
}

export async function getWatermark(
  connection: ProtocolConnection,
): Promise<bigint> {
  const rows = await connection.query<Array<{ watermark: unknown }>>(
    'SELECT COALESCE(MAX(sequence), 0) AS watermark FROM change_log',
  );
  return BigInt(String(rows[0]?.watermark ?? 0));
}

export async function getMinimumRevision(
  connection: ProtocolConnection,
): Promise<bigint | null> {
  const rows = await connection.query<
    Array<{ minimum_revision: unknown }>
  >('SELECT MIN(sequence) AS minimum_revision FROM change_log');
  const value = rows[0]?.minimum_revision;
  return value === null || value === undefined ? null : BigInt(String(value));
}

export async function getChanges(
  connection: ProtocolConnection,
  after: bigint,
  watermark: bigint,
  limit: number,
): Promise<ChangeRecord[]> {
  const rows = await connection.query<
    Array<{
      revision: unknown;
      entity_type: unknown;
      entity_id_hex: unknown;
      operation: unknown;
      payload_json: unknown;
      created_at: unknown;
    }>
  >(
    `SELECT sequence AS revision, entity_type, HEX(entity_id) AS entity_id_hex,
            operation, payload_json, created_at
     FROM change_log
     WHERE sequence > ? AND sequence <= ?
     ORDER BY sequence ASC
     LIMIT ?`,
    [after.toString(), watermark.toString(), limit],
  );
  return rows.map((row) => ({
    revision: BigInt(String(row.revision)),
    entityType: String(row.entity_type),
    entityId: hexToUuid(row.entity_id_hex),
    operation: String(row.operation),
    payload: parseJson(row.payload_json),
    createdAt: databaseDate(row.created_at),
  }));
}
