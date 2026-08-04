import { describe, expect, it } from 'vitest';

import {
  IdempotencyError,
  executeIdempotent,
  type IdempotentMutation,
  type ProtocolConnection,
  type ProtocolPool,
} from '../src/sync/idempotency.js';

interface Receipt {
  payloadHash: Buffer;
  status: number;
  body: string;
  expiresAt: Date;
}

interface FakeState {
  businessRows: string[];
  businessWriteLocks: number;
  audits: unknown[][];
  changes: unknown[][];
  receipts: Map<string, Receipt>;
}

function cloneState(state: FakeState): FakeState {
  return {
    businessRows: [...state.businessRows],
    businessWriteLocks: state.businessWriteLocks,
    audits: state.audits.map((row) => [...row]),
    changes: state.changes.map((row) => [...row]),
    receipts: new Map(
      [...state.receipts].map(([key, receipt]) => [
        key,
        {
          payloadHash: Buffer.from(receipt.payloadHash),
          status: receipt.status,
          body: receipt.body,
          expiresAt: new Date(receipt.expiresAt),
        },
      ]),
    ),
  };
}

class FakeProtocolPool implements ProtocolPool {
  state: FakeState = {
    businessRows: [],
    businessWriteLocks: 0,
    audits: [],
    changes: [],
    receipts: new Map(),
  };
  failChangeInsert = false;

  async getConnection(): Promise<ProtocolConnection> {
    let before: FakeState | undefined;
    return {
      beginTransaction: async () => {
        before = cloneState(this.state);
      },
      commit: async () => {
        before = undefined;
      },
      rollback: async () => {
        if (before) {
          this.state = before;
          before = undefined;
        }
      },
      release: () => undefined,
      query: async <T>(
        sql: string,
        values: readonly unknown[] = [],
      ): Promise<T> => {
        if (sql.startsWith('SELECT payload_hash')) {
          const key = `${String(values[0])}:${String(values[1])}`;
          const receipt = this.state.receipts.get(key);
          return (
            receipt
              ? [
                  {
                    payload_hash: receipt.payloadHash,
                    response_status: receipt.status,
                    response_json: receipt.body,
                  },
                ]
              : []
          ) as T;
        }
        if (sql.includes('FROM business_write_lock')) {
          this.state.businessWriteLocks += 1;
          return [{ singleton_id: 1 }] as T;
        }
        if (sql.startsWith('DELETE FROM idempotency_receipts')) {
          const key = `${String(values[0])}:${String(values[1])}`;
          const receipt = this.state.receipts.get(key);
          if (
            receipt &&
            receipt.expiresAt.getTime() <=
              new Date(values[2] as Date).getTime()
          ) {
            this.state.receipts.delete(key);
            return { affectedRows: 1 } as T;
          }
          return { affectedRows: 0 } as T;
        }
        if (sql.startsWith('INSERT INTO business_probe')) {
          this.state.businessRows.push(String(values[0]));
          return { affectedRows: 1 } as T;
        }
        if (sql.startsWith('INSERT INTO audit_events')) {
          this.state.audits.push([...values]);
          return { affectedRows: 1 } as T;
        }
        if (sql.startsWith('INSERT INTO change_log')) {
          if (this.failChangeInsert) {
            throw new Error('deliberate change insert failure');
          }
          this.state.changes.push([...values]);
          return { affectedRows: 1, insertId: BigInt(this.state.changes.length) } as T;
        }
        if (sql.startsWith('INSERT INTO idempotency_receipts')) {
          const key = `${String(values[0])}:${String(values[1])}`;
          if (this.state.receipts.has(key)) {
            throw Object.assign(new Error('duplicate'), {
              code: 'ER_DUP_ENTRY',
            });
          }
          this.state.receipts.set(key, {
            payloadHash: Buffer.from(values[2] as Buffer),
            status: Number(values[3]),
            body: String(values[4]),
            expiresAt: new Date(values[5] as Date),
          });
          return { affectedRows: 1 } as T;
        }
        if (sql.startsWith('UPDATE idempotency_receipts')) {
          const key = `${String(values[2])}:${String(values[3])}`;
          const receipt = this.state.receipts.get(key);
          if (!receipt) {
            throw new Error('No reserved receipt');
          }
          receipt.status = Number(values[0]);
          receipt.body = String(values[1]);
          return { affectedRows: 1 } as T;
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
  }
}

const deviceId = '11111111-1111-4111-8111-111111111111';
const idempotencyKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const entityId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function execute(
  pool: FakeProtocolPool,
  payload: unknown,
  callback: (
    connection: ProtocolConnection,
  ) => Promise<IdempotentMutation<unknown>> = async (
    connection: ProtocolConnection,
  ) => {
    await connection.query('INSERT INTO business_probe (id) VALUES (?)', [
      entityId,
    ]);
    return {
      statusCode: 201,
      body: { ok: true, amount: '1000' },
      audits: [
        {
          action: 'probe.create',
          entityType: 'probe',
          entityId,
          detail: { amount: '1000' },
        },
      ],
      changes: [
        {
          entityType: 'probe',
          entityId,
          operation: 'upsert',
          payload: { id: entityId, amount: '1000' },
        },
      ],
    };
  },
) {
  return executeIdempotent(
    pool,
    {
      deviceId,
      idempotencyKey,
      payload,
    },
    callback,
  );
}

describe('executeIdempotent', () => {
  it('replays the original status and body for canonically identical JSON', async () => {
    const pool = new FakeProtocolPool();
    let callbackCalls = 0;
    const callback = async (connection: ProtocolConnection) => {
      callbackCalls += 1;
      await connection.query('INSERT INTO business_probe (id) VALUES (?)', [
        entityId,
      ]);
      return {
        statusCode: 202,
        body: { accepted: true },
        audits: [],
        changes: [],
      };
    };

    const first = await execute(pool, { b: 2, a: { y: 2, x: 1 } }, callback);
    const replay = await execute(pool, { a: { x: 1, y: 2 }, b: 2 }, callback);

    expect(first).toEqual({
      statusCode: 202,
      body: { apiSchemaVersion: 2, accepted: true },
      replayed: false,
    });
    expect(replay).toEqual({
      statusCode: 202,
      body: { apiSchemaVersion: 2, accepted: true },
      replayed: true,
    });
    expect(callbackCalls).toBe(1);
    expect(pool.state.businessRows).toEqual([entityId]);
  });

  it('returns 409 when the same device and key carry a different payload', async () => {
    const pool = new FakeProtocolPool();
    await execute(pool, { amount: '1000' });

    await expect(execute(pool, { amount: '2000' })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_MISMATCH',
      statusCode: 409,
    });
    expect(pool.state.businessRows).toEqual([entityId]);
  });

  it('commits business, audit, change, and receipt rows atomically', async () => {
    const pool = new FakeProtocolPool();

    await execute(pool, { amount: '1000' });

    expect(pool.state.businessRows).toEqual([entityId]);
    expect(pool.state.audits).toHaveLength(1);
    expect(pool.state.changes).toHaveLength(1);
    expect(pool.state.receipts).toHaveLength(1);
    expect(pool.state.businessWriteLocks).toBe(1);
  });

  it('acquires the shared transaction lock before entering a business mutation', async () => {
    const pool = new FakeProtocolPool();

    await execute(pool, { amount: '1000' }, async (connection) => {
      expect(pool.state.businessWriteLocks).toBe(1);
      await connection.query('INSERT INTO business_probe (id) VALUES (?)', [
        entityId,
      ]);
      return {
        statusCode: 200,
        body: { ok: true },
        audits: [],
        changes: [],
      };
    });
  });

  it('rolls back every row when any atomic side effect fails', async () => {
    const pool = new FakeProtocolPool();
    pool.failChangeInsert = true;

    await expect(execute(pool, { amount: '1000' })).rejects.toThrow(
      'deliberate change insert failure',
    );

    expect(pool.state.businessRows).toEqual([]);
    expect(pool.state.audits).toEqual([]);
    expect(pool.state.changes).toEqual([]);
    expect(pool.state.receipts).toHaveLength(0);
  });

  it('does not mistake a business duplicate for a receipt race', async () => {
    const pool = new FakeProtocolPool();
    const businessError = Object.assign(new Error('business duplicate'), {
      code: 'ER_DUP_ENTRY',
    });

    await expect(
      execute(pool, { amount: '1000' }, async () => {
        throw businessError;
      }),
    ).rejects.toBe(businessError);

    expect(pool.state.receipts).toHaveLength(0);
  });

  it('requires the idempotency key to be a UUID', async () => {
    const pool = new FakeProtocolPool();

    await expect(
      executeIdempotent(
        pool,
        {
          deviceId,
          idempotencyKey: 'not-a-uuid',
          payload: {},
        },
        async () => ({
          statusCode: 200,
          body: {},
          audits: [],
          changes: [],
        }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyError);
    expect(pool.state.receipts).toHaveLength(0);
  });

  it('prunes an expired receipt before reusing its key', async () => {
    const pool = new FakeProtocolPool();
    pool.state.receipts.set(`${deviceId}:${idempotencyKey}`, {
      payloadHash: Buffer.alloc(32, 9),
      status: 200,
      body: '{"stale":true}',
      expiresAt: new Date(0),
    });

    await expect(execute(pool, { amount: '1000' })).resolves.toMatchObject({
      replayed: false,
    });
    expect(pool.state.businessRows).toEqual([entityId]);
    expect(pool.state.receipts).toHaveLength(1);
  });
});
