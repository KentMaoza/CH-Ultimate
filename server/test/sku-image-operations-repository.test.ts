import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { MariaDbSkuImageOperationsRepository } from '../src/catalogue/mariadb-sku-image-operations-repository.js';
import type { ProtocolConnection } from '../src/sync/idempotency.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const SKU_ID = '22222222-2222-4222-8222-222222222222';
const bytes = Buffer.from('validated image bytes');
const hash = createHash('sha256').update(bytes).digest('hex');
const currentRow = {
  id_hex: SKU_ID.replaceAll('-', ''),
  primary_identifier: 'SKU-001',
  name: 'Produk Core',
  price_rupiah: 25_000,
  image_hash: Buffer.from('a'.repeat(64), 'hex'),
  source_image_url: 'https://res.bigseller.pro/a.png',
  source_note: 'Rak A',
  row_version: 4,
  archived_at: null,
  created_at: new Date('2026-07-30T01:00:00.000Z'),
  updated_at: new Date('2026-07-30T01:00:00.000Z'),
};

function harness(options: { storageFailure?: Error } = {}) {
  const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
  const connection = {
    async query<T>(sql: string, values: readonly unknown[] = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: compact, values });
      if (compact.includes('FROM skus') && compact.includes('FOR UPDATE')) {
        return [currentRow] as T;
      }
      if (compact.startsWith('INSERT INTO change_log')) {
        return { insertId: 51n } as T;
      }
      return { affectedRows: 1 } as T;
    },
  } as Pick<ProtocolConnection, 'query'>;
  const storage = {
    writeImage: options.storageFailure
      ? vi.fn(async () => {
          throw options.storageFailure;
        })
      : vi.fn(
          async () =>
            `images/sha256/${hash.slice(0, 2)}/${hash}.bin`,
        ),
  };
  return {
    connection,
    queries,
    storage,
    repository: new MariaDbSkuImageOperationsRepository(storage, {
      now: () => new Date('2026-07-30T02:00:00.000Z'),
    }),
  };
}

const input = {
  rowVersion: '4',
  base: {
    imageHash: 'a'.repeat(64),
    sourceImageUrl: 'https://res.bigseller.pro/a.png',
  },
  bytes,
  mimeType: 'image/png',
  width: 32,
  height: 24,
};

describe('MariaDB authoritative SKU image repository', () => {
  it('deduplicates content and publishes the authoritative SKU in one mutation', async () => {
    const test = harness();

    const result = await test.repository.replace(
      test.connection,
      DEVICE_ID,
      SKU_ID,
      input,
    );

    expect(test.storage.writeImage).toHaveBeenCalledWith(hash, bytes);
    expect(
      test.queries.some(
        ({ sql }) =>
          sql.startsWith('INSERT INTO image_assets') &&
          sql.includes('ON DUPLICATE KEY UPDATE'),
      ),
    ).toBe(true);
    expect(
      test.queries.some(
        ({ sql }) =>
          sql.startsWith('UPDATE skus') &&
          sql.includes('image_hash = UNHEX(?)') &&
          sql.includes('source_image_url = NULL'),
      ),
    ).toBe(true);
    expect(result.body).toMatchObject({
      serverRevision: '51',
      entityVersion: '5',
      entity: {
        id: SKU_ID,
        imageHash: hash,
        sourceImageUrl: null,
        rowVersion: '5',
      },
    });
  });

  it('does not change the SKU when deterministic storage fails', async () => {
    const test = harness({ storageFailure: new Error('disk full') });

    await expect(
      test.repository.replace(
        test.connection,
        DEVICE_ID,
        SKU_ID,
        input,
      ),
    ).rejects.toThrow('disk full');

    expect(
      test.queries.some(({ sql }) => sql.startsWith('UPDATE skus')),
    ).toBe(false);
    expect(
      test.queries.some(({ sql }) => sql.startsWith('INSERT INTO audit_events')),
    ).toBe(false);
    expect(
      test.queries.some(({ sql }) => sql.startsWith('INSERT INTO change_log')),
    ).toBe(false);
  });

  it('returns a typed conflict before writing bytes for a stale version', async () => {
    const test = harness();

    await expect(
      test.repository.replace(
        test.connection,
        DEVICE_ID,
        SKU_ID,
        { ...input, rowVersion: '3' },
      ),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      statusCode: 409,
      conflict: {
        base: input.base,
        mine: { imageHash: hash, sourceImageUrl: null },
      },
    });
    expect(test.storage.writeImage).not.toHaveBeenCalled();
    expect(
      test.queries.some(({ sql }) => /^(INSERT|UPDATE)/.test(sql)),
    ).toBe(false);
  });
});
