import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { MariaDbCatalogueImageRepository } from '../src/catalogue/mariadb-image-repository.js';
import type {
  CatalogueImageAsset,
  CatalogueImageJob,
} from '../src/catalogue/image-worker.js';
import type {
  ProtocolConnection,
  ProtocolPool,
} from '../src/sync/idempotency.js';

const job: CatalogueImageJob = {
  id: '11111111-1111-4111-8111-111111111111',
  skuId: '22222222-2222-4222-8222-222222222222',
  sourceUrl: 'https://res.bigseller.pro/a.png',
  attemptCount: 1,
};
const bytes = Buffer.from('cached-image');
const contentHash = createHash('sha256').update(bytes).digest('hex');
const asset: CatalogueImageAsset = {
  contentHash,
  mimeType: 'image/png',
  byteSize: bytes.length,
  width: 32,
  height: 24,
  storagePath: `images/sha256/${contentHash.slice(0, 2)}/${contentHash}.bin`,
};

function harness() {
  const events: string[] = [];
  const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
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
    query: async <T>(
      sql: string,
      values: readonly unknown[] = [],
    ): Promise<T> => {
      const compact = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: compact, values });
      if (compact.includes('FROM business_write_lock')) {
        return [{ singleton_id: 1 }] as T;
      }
      if (
        compact.includes('FROM image_jobs') &&
        compact.includes('FOR UPDATE SKIP LOCKED')
      ) {
        return [
          {
            id_hex: job.id.replaceAll('-', ''),
            sku_id_hex: job.skuId.replaceAll('-', ''),
            source_url: job.sourceUrl,
            attempt_count: 0,
          },
        ] as T;
      }
      if (
        compact.includes('FROM skus') &&
        compact.includes('primary_identifier')
      ) {
        return [
          {
            id_hex: job.skuId.replaceAll('-', ''),
            primary_identifier: 'SKU-A',
            name: 'Produk A',
            price_rupiah: 15_000,
            image_hash: Buffer.from(contentHash, 'hex'),
            source_image_url: job.sourceUrl,
            source_note: 'Rak A',
            source_created_at: '2026-07-30 09:24',
            row_version: 1,
            archived_at: null,
            created_at: new Date('2026-07-30T02:00:00.000Z'),
            updated_at: new Date('2026-07-30T02:01:00.000Z'),
          },
        ] as T;
      }
      if (compact.includes('FROM image_assets')) {
        return [
          {
            mime_type: asset.mimeType,
            storage_path: asset.storagePath,
            byte_size: asset.byteSize,
          },
        ] as T;
      }
      return { affectedRows: 1 } as T;
    },
  };
  const pool: ProtocolPool & {
    query<T>(
      sql: string,
      values?: readonly unknown[],
    ): Promise<T>;
  } = {
    getConnection: vi.fn(async () => connection),
    query: (sql, values) => connection.query(sql, values),
  };
  const storage = {
    readImage: vi.fn(async () => Buffer.from(bytes)),
  };
  return {
    events,
    queries,
    repository: new MariaDbCatalogueImageRepository(pool, storage),
    storage,
  };
}

describe('MariaDB catalogue image repository', () => {
  it('claims one due job under a row lock', async () => {
    const { events, queries, repository } = harness();

    await expect(repository.claimNext()).resolves.toEqual(job);

    expect(events).toEqual(['begin', 'commit', 'release']);
    expect(
      queries.some(({ sql }) => sql.includes('FOR UPDATE SKIP LOCKED')),
    ).toBe(true);
    expect(
      queries.some(
        ({ sql }) =>
          sql.includes("status = 'processing'") &&
          sql.includes('claimed_at') &&
          sql.includes('INTERVAL 15 MINUTE'),
      ),
    ).toBe(true);
    expect(
      queries.some(
        ({ sql }) =>
          sql.startsWith('UPDATE image_jobs') &&
          sql.includes("status = 'processing'") &&
          sql.includes('claimed_at = CURRENT_TIMESTAMP(6)'),
      ),
    ).toBe(true);
  });

  it('deduplicates the asset and atomically publishes the SKU image hash', async () => {
    const { events, queries, repository } = harness();

    await repository.complete(job, asset);

    expect(events).toEqual(['begin', 'commit', 'release']);
    const lockIndex = queries.findIndex(({ sql }) =>
      sql.includes('FROM business_write_lock'),
    );
    const skuIndex = queries.findIndex(({ sql }) =>
      sql.startsWith('UPDATE skus'),
    );
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(skuIndex);
    expect(
      queries.some(
        ({ sql }) =>
          sql.startsWith('INSERT INTO image_assets') &&
          sql.includes('ON DUPLICATE KEY UPDATE'),
      ),
    ).toBe(true);
    expect(
      queries.some(
        ({ sql, values }) =>
          sql.startsWith('UPDATE skus') &&
          values.some(
            (value) =>
              Buffer.isBuffer(value) &&
              value.equals(Buffer.from(contentHash, 'hex')),
          ),
      ),
    ).toBe(true);
    const change = queries.find(({ sql }) =>
      sql.startsWith('INSERT INTO change_log'),
    );
    expect(change?.values).toEqual(
      expect.arrayContaining([
        'sku',
        job.skuId,
        expect.stringContaining(`"imageHash":"${contentHash}"`),
      ]),
    );
  });

  it('records retryable failure state without changing the SKU', async () => {
    const { events, queries, repository } = harness();

    await repository.fail(job, 'IMAGE_TIMEOUT');

    expect(events).toEqual([]);
    const update = queries.find(({ sql }) =>
      sql.startsWith('UPDATE image_jobs'),
    );
    expect(update?.sql).toContain("THEN 'retry'");
    expect(update?.sql).toContain('claimed_at = NULL');
    expect(update?.values).toEqual(
      expect.arrayContaining(['IMAGE_TIMEOUT', job.id]),
    );
    expect(
      queries.some(({ sql }) => sql.startsWith('UPDATE skus')),
    ).toBe(false);
  });

  it('serves only a verified content-hash asset from private storage', async () => {
    const { repository, storage } = harness();

    await expect(repository.read(contentHash)).resolves.toEqual({
      bytes,
      mimeType: 'image/png',
    });
    expect(storage.readImage).toHaveBeenCalledWith(asset.storagePath);
    await expect(repository.read('../secret')).rejects.toMatchObject({
      code: 'INVALID_IMAGE_HASH',
      statusCode: 400,
    });
  });
});
