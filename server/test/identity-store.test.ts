import { describe, expect, it } from 'vitest';

import { MariaDbIdentityStore } from '../src/auth/mariadb-identity-store.js';
import type {
  ProtocolConnection,
  ProtocolPool,
} from '../src/sync/idempotency.js';

const currentHash = Buffer.alloc(32, 1);

function createPool(options: { queryError?: Error } = {}) {
  const events: string[] = [];
  const connection: ProtocolConnection = {
    beginTransaction: async () => {
      events.push('begin');
    },
    commit: async () => {
      events.push('commit');
    },
    rollback: async () => {
      events.push('rollback');
    },
    release: () => {
      events.push('release');
    },
    query: async <T>(sql: string): Promise<T> => {
      events.push(sql.replace(/\s+/g, ' ').trim());
      if (options.queryError) {
        throw options.queryError;
      }
      if (sql.includes('FROM devices') && sql.includes('token_hash')) {
        return [
          {
            id_hex: '11111111111141118111111111111111',
            installation_id_hex: '22222222222242228222222222222222',
            role: 'owner',
            display_name: 'Owner Mac',
            platform: 'macos',
            token_hash: currentHash,
            token_expires_at: new Date('2027-01-25T00:00:00.000Z'),
            previous_token_hash: null,
            previous_token_expires_at: null,
            approved_at: new Date('2026-07-29T00:00:00.000Z'),
            revoked_at: null,
            created_at: new Date('2026-07-29T00:00:00.000Z'),
          },
        ] as T;
      }
      return [] as T;
    },
  };
  const pool: ProtocolPool = {
    getConnection: async () => connection,
  };
  return { pool, events };
}

describe('MariaDbIdentityStore', () => {
  it('maps binary UUIDs and commits work on one transaction connection', async () => {
    const { pool, events } = createPool();
    const store = new MariaDbIdentityStore(pool);

    const match = await store.transaction((session) =>
      session.findDeviceByTokenHash(currentHash),
    );

    expect(match).toMatchObject({
      tokenKind: 'current',
      device: {
        id: '11111111-1111-4111-8111-111111111111',
        installationId: '22222222-2222-4222-8222-222222222222',
        role: 'owner',
      },
    });
    expect(events[0]).toBe('begin');
    expect(events.at(-2)).toBe('commit');
    expect(events.at(-1)).toBe('release');
  });

  it('rolls back and releases when session work fails', async () => {
    const { pool, events } = createPool({
      queryError: new Error('database unavailable'),
    });
    const store = new MariaDbIdentityStore(pool);

    await expect(
      store.transaction((session) => session.findOwner()),
    ).rejects.toThrow('database unavailable');

    expect(events).toEqual(
      expect.arrayContaining(['begin', 'rollback', 'release']),
    );
    expect(events).not.toContain('commit');
  });
});
