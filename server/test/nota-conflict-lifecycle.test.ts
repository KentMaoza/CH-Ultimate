import { describe, expect, it } from 'vitest';

import { reapplyLifecycleConflictIntent } from '../src/nota/mariadb-nota-conflict-lifecycle.js';
import type { NotaRepository } from '../src/nota/service.js';
import type { ProtocolConnection } from '../src/sync/idempotency.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const NOTA_ID = '33333333-3333-4333-8333-333333333333';

function harness(
  initialStatus: string,
  cancelledFromStatus: string | null,
  mutate = true,
) {
  const row: Record<string, unknown> = {
    id_hex: NOTA_ID.replaceAll('-', ''),
    status: initialStatus,
    cancelled_from_status: cancelledFromStatus,
    lifecycle_version: 4n,
    completion_destination: 'archive',
  };
  const connection = {
    query: async <T>(sql: string): Promise<T> => {
      if (sql.includes('FROM notas')) return [row] as T;
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as Pick<ProtocolConnection, 'query'>;
  const mutation = {
    statusCode: 200,
    body: {},
    audits: [],
    changes: [],
  };
  const operations = {
    restore: async () => {
      if (mutate) {
        row.status = row.cancelled_from_status ?? 'draft';
        row.cancelled_from_status = null;
        row.lifecycle_version = BigInt(String(row.lifecycle_version)) + 1n;
      }
      return mutation;
    },
    reopen: async () => {
      if (mutate) {
        row.status = 'reopened';
        row.lifecycle_version = BigInt(String(row.lifecycle_version)) + 1n;
      }
      return mutation;
    },
    complete: async () => {
      if (mutate) {
        row.status = 'completed';
        row.completion_destination = 'archive';
        row.lifecycle_version = BigInt(String(row.lifecycle_version)) + 1n;
      }
      return mutation;
    },
    cancel: async () => {
      if (mutate) {
        row.cancelled_from_status = row.status;
        row.status = 'cancelled';
        row.lifecycle_version = BigInt(String(row.lifecycle_version)) + 1n;
      }
      return mutation;
    },
  } as Pick<NotaRepository, 'restore' | 'reopen' | 'complete' | 'cancel'>;
  return {
    context: {
      connection: connection as ProtocolConnection,
      operations,
      deviceId: DEVICE_ID,
      operationId: OPERATION_ID,
      notaId: NOTA_ID,
    },
    row,
  };
}

describe('Nota lifecycle conflict intent', () => {
  it.each([
    { status: 'completed', cancelledFromStatus: null },
    { status: 'reopened', cancelledFromStatus: null },
    { status: 'cancelled', cancelledFromStatus: 'completed' },
    { status: 'cancelled', cancelledFromStatus: 'reopened' },
  ])(
    'finishes reopen mine as reopened from $status previously $cancelledFromStatus',
    async ({ status, cancelledFromStatus }) => {
      const { context, row } = harness(status, cancelledFromStatus);
      await reapplyLifecycleConflictIntent(context, 'reopen', {
        lifecycleVersion: '2',
      });
      expect(row.status).toBe('reopened');
    },
  );

  it.each([
    { status: 'draft', cancelledFromStatus: null },
    { status: 'cancelled', cancelledFromStatus: 'draft' },
  ])(
    'rejects impossible reopen mine from $status previously $cancelledFromStatus',
    async ({ status, cancelledFromStatus }) => {
      const { context, row } = harness(status, cancelledFromStatus);
      await expect(reapplyLifecycleConflictIntent(
        context,
        'reopen',
        { lifecycleVersion: '1' },
      )).rejects.toMatchObject({
        code: 'CONFLICT_OVERRIDE_STALE',
        statusCode: 409,
      });
      expect(row.status).toBe(status);
    },
  );

  it('rejects a successful mutation response that did not apply reopen', async () => {
    const { context, row } = harness('completed', null, false);
    await expect(reapplyLifecycleConflictIntent(
      context,
      'reopen',
      { lifecycleVersion: '4' },
    )).rejects.toMatchObject({
      code: 'CONFLICT_OVERRIDE_STALE',
      statusCode: 409,
    });
    expect(row.status).toBe('completed');
  });
});
