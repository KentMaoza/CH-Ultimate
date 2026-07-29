import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  IdempotencyError,
  executeIdempotent,
  type ProtocolConnection,
  type ProtocolPool,
} from '../src/sync/idempotency.js';

interface StoredReceipt {
  payloadHash: Buffer;
  status: number;
  body: string;
  expiresAt: Date;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class ConcurrentReceiptPool implements ProtocolPool {
  businessCalls = 0;
  committed: StoredReceipt | null = null;
  deadlockOnce = false;
  private nextConnectionId = 0;
  private pending:
    | (StoredReceipt & { owner: number })
    | null = null;
  private readonly firstBusiness = deferred();
  private readonly contender = deferred();
  private readonly releaseBusiness = deferred();
  private readonly receiptCommitted = deferred();

  waitForFirstBusiness(): Promise<void> {
    return this.firstBusiness.promise;
  }

  waitForContender(): Promise<void> {
    return this.contender.promise;
  }

  release(): void {
    this.releaseBusiness.resolve();
  }

  async getConnection(): Promise<ProtocolConnection> {
    const id = ++this.nextConnectionId;
    let ownsReservation = false;
    return {
      beginTransaction: async () => undefined,
      commit: async () => {
        if (ownsReservation && this.pending?.owner === id) {
          this.committed = {
            payloadHash: this.pending.payloadHash,
            status: this.pending.status,
            body: this.pending.body,
            expiresAt: this.pending.expiresAt,
          };
          this.pending = null;
          ownsReservation = false;
          this.receiptCommitted.resolve();
        }
      },
      rollback: async () => {
        if (ownsReservation && this.pending?.owner === id) {
          this.pending = null;
          ownsReservation = false;
        }
      },
      release: () => undefined,
      query: async <T>(
        sql: string,
        values: readonly unknown[] = [],
      ): Promise<T> => {
        if (sql.startsWith('DELETE FROM idempotency_receipts')) {
          return { affectedRows: 0 } as T;
        }
        if (sql.startsWith('SELECT payload_hash')) {
          if (this.pending && this.pending.owner !== id) {
            await this.receiptCommitted.promise;
          }
          return (
            this.committed
              ? [{
                  payload_hash: this.committed.payloadHash,
                  response_status: this.committed.status,
                  response_json: this.committed.body,
                }]
              : []
          ) as T;
        }
        if (sql.startsWith('INSERT INTO business_probe')) {
          this.businessCalls += 1;
          this.firstBusiness.resolve();
          if (this.businessCalls > 1) {
            this.contender.resolve();
          }
          await this.releaseBusiness.promise;
          return { affectedRows: 1 } as T;
        }
        if (sql.startsWith('INSERT INTO idempotency_receipts')) {
          if (this.deadlockOnce) {
            this.deadlockOnce = false;
            throw Object.assign(new Error('deadlock'), { errno: 1213 });
          }
          if (this.pending || this.committed) {
            this.contender.resolve();
            throw Object.assign(new Error('duplicate'), { errno: 1062 });
          }
          this.pending = {
            owner: id,
            payloadHash: Buffer.from(values[2] as Buffer),
            status: Number(values[3]),
            body: String(values[4]),
            expiresAt: new Date(values[5] as Date),
          };
          ownsReservation = true;
          return { affectedRows: 1 } as T;
        }
        if (sql.startsWith('UPDATE idempotency_receipts')) {
          if (!this.pending || this.pending.owner !== id) {
            throw new Error('No owned reservation');
          }
          this.pending.status = Number(values[0]);
          this.pending.body = String(values[1]);
          return { affectedRows: 1 } as T;
        }
        if (
          sql.startsWith('INSERT INTO audit_events') ||
          sql.startsWith('INSERT INTO change_log')
        ) {
          return { affectedRows: 1 } as T;
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
  }
}

const requestBase = {
  deviceId: '11111111-1111-4111-8111-111111111111',
  idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

function executeProbe(pool: ProtocolPool, payload: unknown) {
  return executeIdempotent(
    pool,
    {
      ...requestBase,
      payload,
    },
    async (connection) => {
      await connection.query('INSERT INTO business_probe (id) VALUES (?)', [
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ]);
      return {
        statusCode: 201,
        body: { ok: true },
        audits: [],
        changes: [],
      };
    },
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('replay-safe idempotency reservations', () => {
  it('reserves before business work so concurrent first use mutates once', async () => {
    const pool = new ConcurrentReceiptPool();
    const first = executeProbe(pool, { amount: 1000 });
    await pool.waitForFirstBusiness();
    const second = executeProbe(pool, { amount: 1000 });
    await pool.waitForContender();
    pool.release();

    const results = await Promise.all([first, second]);

    expect(results.map((result) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(pool.businessCalls).toBe(1);
  });

  it('returns a mismatch to a concurrent loser with another payload', async () => {
    const pool = new ConcurrentReceiptPool();
    const first = executeProbe(pool, { amount: 1000 });
    await pool.waitForFirstBusiness();
    const second = executeProbe(pool, { amount: 2000 });
    await pool.waitForContender();
    pool.release();

    await expect(first).resolves.toMatchObject({ replayed: false });
    await expect(second).rejects.toBeInstanceOf(IdempotencyError);
    await expect(second).rejects.toMatchObject({
      code: 'IDEMPOTENCY_MISMATCH',
    });
    expect(pool.businessCalls).toBe(1);
  });

  it('retries a deadlock before invoking business work', async () => {
    const pool = new ConcurrentReceiptPool();
    pool.deadlockOnce = true;
    const result = executeProbe(pool, { amount: 1000 });
    await pool.waitForFirstBusiness();
    pool.release();

    await expect(result).resolves.toMatchObject({ replayed: false });
    expect(pool.businessCalls).toBe(1);
  });

  it('uses a fixed 365-day receipt lifetime', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T00:00:00.000Z'));
    const pool = new ConcurrentReceiptPool();
    const result = executeProbe(pool, { amount: 1000 });
    await pool.waitForFirstBusiness();
    pool.release();
    await result;

    expect(pool.committed?.expiresAt.toISOString()).toBe(
      '2027-07-29T00:00:00.000Z',
    );
  });
});
