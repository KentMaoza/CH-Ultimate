import type { ProtocolConnection } from './idempotency-contract.js';

/**
 * Serialize catalogue initialization with every live business mutation.
 *
 * Call this after beginTransaction() and before reading or writing business
 * state. InnoDB owns the row lock until that transaction commits or rolls back.
 */
export async function acquireBusinessWriteLock(
  connection: Pick<ProtocolConnection, 'query'>,
): Promise<void> {
  const rows = await connection.query<Array<{ singleton_id: unknown }>>(
    `SELECT singleton_id
     FROM business_write_lock
     WHERE singleton_id = 1
     FOR UPDATE`,
  );
  if (Number(rows[0]?.singleton_id) !== 1) {
    throw new Error('Business write lock is unavailable');
  }
}
