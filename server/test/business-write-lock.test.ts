import { describe, expect, it } from 'vitest';

import { acquireBusinessWriteLock } from '../src/sync/business-write-lock.js';
import type { ProtocolConnection } from '../src/sync/idempotency.js';

class TransactionLock {
  private owner: string | null = null;
  private readonly waiters: Array<{
    owner: string;
    resolve: () => void;
  }> = [];

  async acquire(owner: string): Promise<void> {
    if (this.owner === null) {
      this.owner = owner;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push({ owner, resolve });
    });
  }

  release(owner: string): void {
    if (this.owner !== owner) throw new Error('lock owner mismatch');
    const next = this.waiters.shift();
    this.owner = next?.owner ?? null;
    next?.resolve();
  }
}

function connection(
  owner: string,
  lock: TransactionLock,
  queries: string[],
): ProtocolConnection {
  return {
    beginTransaction: async () => undefined,
    commit: async () => lock.release(owner),
    rollback: async () => lock.release(owner),
    release: () => undefined,
    query: async <T>(sql: string): Promise<T> => {
      queries.push(sql.replace(/\s+/g, ' ').trim());
      await lock.acquire(owner);
      return [{ singleton_id: 1 }] as T;
    },
  };
}

describe('business write lock', () => {
  it('uses one transaction-scoped database row lock for catalogue and business writers', async () => {
    const lock = new TransactionLock();
    const queries: string[] = [];
    const first = connection('first', lock, queries);
    const second = connection('second', lock, queries);

    await acquireBusinessWriteLock(first);
    let secondAcquired = false;
    const waiting = acquireBusinessWriteLock(second).then(() => {
      secondAcquired = true;
    });
    await Promise.resolve();

    expect(secondAcquired).toBe(false);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('FROM business_write_lock');
    expect(queries[0]).toContain('FOR UPDATE');

    await first.commit();
    await waiting;
    expect(secondAcquired).toBe(true);
    await second.commit();
  });

  it('fails closed when the singleton lock row is missing', async () => {
    const candidate = {
      query: async <T>() => [] as T,
    } as Pick<ProtocolConnection, 'query'>;

    await expect(acquireBusinessWriteLock(candidate)).rejects.toThrow(
      'Business write lock is unavailable',
    );
  });
});
