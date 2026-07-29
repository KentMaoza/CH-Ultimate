import { describe, expect, it } from 'vitest';

import {
  SyncError,
  SyncService,
  type BootstrapCollections,
  type ChangeRecord,
  type SyncReadSession,
  type SyncStore,
} from '../src/sync/service.js';

interface MemoryState {
  collections: BootstrapCollections;
  changes: ChangeRecord[];
}

function cloneState(state: MemoryState): MemoryState {
  return structuredClone(state);
}

class MemorySyncStore implements SyncStore {
  state: MemoryState = {
    collections: {
      skuIdentifiers: [],
      skus: [],
      balances: [],
      notas: [],
      notaPages: [],
      notaLines: [],
      templates: [],
    },
    changes: [],
  };
  afterWatermarkRead: (() => void) | undefined;

  async readConsistent<T>(
    work: (session: SyncReadSession) => Promise<T>,
  ): Promise<T> {
    const snapshot = cloneState(this.state);
    let watermarkRead = false;
    const session: SyncReadSession = {
      getWatermark: async () => {
        const watermark = snapshot.changes.at(-1)?.revision ?? 0n;
        if (!watermarkRead) {
          watermarkRead = true;
          this.afterWatermarkRead?.();
        }
        return watermark;
      },
      getMinimumRevision: async () =>
        snapshot.changes[0]?.revision ?? null,
      getBootstrapCollections: async () => snapshot.collections,
      getChanges: async (after, watermark, limit) =>
        snapshot.changes
          .filter(
            (change) =>
              change.revision > after && change.revision <= watermark,
          )
          .slice(0, limit),
    };
    return work(session);
  }

  async pruneRetainedChanges(): Promise<number> {
    return 0;
  }
}

function change(revision: bigint): ChangeRecord {
  return {
    revision,
    entityType: 'sku',
    entityId: '11111111-1111-4111-8111-111111111111',
    operation: 'upsert',
    payload: { revision },
    createdAt: new Date(
      Date.parse('2026-07-29T00:00:00.000Z') + Number(revision) * 1_000,
    ),
  };
}

describe('SyncService.bootstrap', () => {
  it('returns rows and watermark from one consistent read snapshot', async () => {
    const store = new MemorySyncStore();
    store.state.collections.skus.push({
      id: '11111111-1111-4111-8111-111111111111',
      priceRupiah: 25_000n,
      rowVersion: 1n,
    });
    store.state.changes.push(change(1n));
    store.afterWatermarkRead = () => {
      store.state.collections.skus.push({
        id: '22222222-2222-4222-8222-222222222222',
        priceRupiah: 30_000n,
        rowVersion: 1n,
      });
      store.state.changes.push(change(2n));
    };

    const result = await new SyncService(store).bootstrap();

    expect(result.serverRevision).toBe('1');
    expect(result.skus).toEqual([
      {
        id: '11111111-1111-4111-8111-111111111111',
        priceRupiah: '25000',
        rowVersion: '1',
      },
    ]);
    expect(result).not.toHaveProperty('devices');
    expect(result).not.toHaveProperty('pairings');
    expect(result).not.toHaveProperty('ownerRecovery');
  });
});

describe('SyncService.changes', () => {
  it('orders revisions ascending and safely redelivers the same page', async () => {
    const store = new MemorySyncStore();
    store.state.changes = [change(1n), change(2n), change(3n)];
    const service = new SyncService(store);

    const first = await service.changes({ after: '1', limit: 2 });
    const duplicate = await service.changes({ after: '1', limit: 2 });

    expect(first).toEqual({
      serverRevision: '3',
      nextAfter: '3',
      changes: [
        expect.objectContaining({ revision: '2' }),
        expect.objectContaining({ revision: '3' }),
      ],
    });
    expect(duplicate).toEqual(first);
    expect(JSON.stringify(first)).not.toContain('"revision":2');
  });

  it('returns CURSOR_EXPIRED when retained history has a gap', async () => {
    const store = new MemorySyncStore();
    store.state.changes = [change(100n), change(101n)];

    await expect(
      new SyncService(store).changes({ after: '98', limit: 100 }),
    ).rejects.toMatchObject({
      code: 'CURSOR_EXPIRED',
      statusCode: 410,
    });
  });

  it('rejects a cursor ahead of the watermark and directs full bootstrap', async () => {
    const store = new MemorySyncStore();
    store.state.changes = [change(4n), change(5n)];

    await expect(
      new SyncService(store).changes({ after: '6', limit: 100 }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'CURSOR_AHEAD',
        statusCode: 409,
        bootstrapRequired: true,
      }),
    );
  });

  it('enforces canonical unsigned cursors and a page maximum of 500', async () => {
    const store = new MemorySyncStore();
    store.state.changes = Array.from({ length: 600 }, (_, index) =>
      change(BigInt(index + 1)),
    );
    const service = new SyncService(store);

    await expect(
      service.changes({ after: '0', limit: 501 }),
    ).rejects.toBeInstanceOf(SyncError);
    await expect(
      service.changes({ after: '01', limit: 100 }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(
      service.changes({ after: '-1', limit: 100 }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });

    const page = await service.changes({ after: '0', limit: 500 });
    expect(page.changes).toHaveLength(500);
    expect(page.nextAfter).toBe('500');
    expect(page.serverRevision).toBe('600');
  });
});
