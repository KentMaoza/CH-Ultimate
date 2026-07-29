import type { ProtocolConnection } from './idempotency.js';

export async function pruneChangeLog(
  connection: ProtocolConnection,
): Promise<number> {
  const result = await connection.query<{ affectedRows: unknown }>(
    `DELETE FROM change_log
     WHERE created_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 180 DAY)
       AND sequence < COALESCE(
         (
           SELECT retained_boundary.sequence
           FROM (
             SELECT sequence
             FROM change_log
             ORDER BY sequence DESC
             LIMIT 1 OFFSET 249999
           ) AS retained_boundary
         ),
         0
       )`,
  );
  return Number(result.affectedRows);
}

export async function pruneExpiredReceipts(
  connection: ProtocolConnection,
): Promise<number> {
  const result = await connection.query<{ affectedRows: unknown }>(
    `DELETE FROM idempotency_receipts
     WHERE expires_at <= UTC_TIMESTAMP(6)`,
  );
  return Number(result.affectedRows);
}
