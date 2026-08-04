import { describe, expect, it, vi } from 'vitest';

import { MariaDbNotaConflictRepository } from '../src/nota/mariadb-nota-conflict-repository.js';
import type { ProtocolConnection } from '../src/sync/idempotency.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const CONFLICT_ID = '33333333-3333-4333-8333-333333333333';
const NOTA_ID = '44444444-4444-4444-8444-444444444444';

describe('MariaDB Nota conflict resolution', () => {
  it('leaves an impossible cancelled-from-draft reopen unresolved', async () => {
    const conflictUpdates: string[] = [];
    const connection = {
      query: vi.fn(async <T>(sql: string): Promise<T> => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        if (compact.includes('FROM nota_conflicts')) {
          return [{
            nota_id_hex: NOTA_ID.replaceAll('-', ''),
            intent_json: JSON.stringify({
              action: 'reopen',
              input: { lifecycleVersion: '1' },
            }),
            resolved_choice: null,
          }] as T;
        }
        if (compact.includes('FROM notas')) {
          return [{
            id_hex: NOTA_ID.replaceAll('-', ''),
            status: 'cancelled',
            cancelled_from_status: 'draft',
            lifecycle_version: 2n,
            completion_destination: null,
          }] as T;
        }
        if (compact.startsWith('UPDATE nota_conflicts')) {
          conflictUpdates.push(compact);
          throw new Error('Conflict was incorrectly marked resolved');
        }
        throw new Error(`Unexpected SQL: ${compact}`);
      }),
    } as unknown as ProtocolConnection;
    const unavailable = vi.fn(async () => {
      throw new Error('Lifecycle operation should not run');
    });
    const repository = new MariaDbNotaConflictRepository({
      updateHeader: unavailable,
      updateLine: unavailable,
      deleteLine: unavailable,
      addPage: unavailable,
      restorePage: unavailable,
      cancelPage: unavailable,
      complete: unavailable,
      reopen: unavailable,
      cancel: unavailable,
      restore: unavailable,
    });

    await expect(repository.resolveConflict(
      connection,
      DEVICE_ID,
      OPERATION_ID,
      CONFLICT_ID,
      { choice: 'mine' },
    )).rejects.toMatchObject({
      code: 'CONFLICT_OVERRIDE_STALE',
      statusCode: 409,
    });
    expect(conflictUpdates).toEqual([]);
  });
});
