import { describe, expect, it } from 'vitest';

import {
  CatalogueConflictError,
  MariaDbSkuOperationsRepository,
} from '../src/catalogue/mariadb-sku-operations-repository.js';
import type { ProtocolConnection } from '../src/sync/idempotency.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const SKU_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_SKU_ID = '33333333-3333-4333-8333-333333333333';

type Query = { sql: string; values: readonly unknown[] };

function connectionWith(
  responder: (sql: string, values: readonly unknown[]) => unknown = () => [],
) {
  const queries: Query[] = [];
  const connection = {
    async query<T>(sql: string, values: readonly unknown[] = []) {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
      return responder(sql, values) as T;
    },
  } as Pick<ProtocolConnection, 'query'>;
  return { connection, queries };
}

describe('MariaDB authoritative SKU repository', () => {
  it('creates the SKU, normalized identifier, balance, price history, audit, and ordered changes', async () => {
    let revision = 10n;
    const { connection, queries } = connectionWith((sql) => {
      if (sql.includes('INSERT INTO change_log')) {
        revision += 1n;
        return { insertId: revision };
      }
      return [];
    });
    const repository = new MariaDbSkuOperationsRepository({
      uuid: (() => {
        let next = 2;
        return () =>
          `${String(next++).padStart(8, '0')}-0000-4000-8000-000000000000`;
      })(),
      now: () => new Date('2026-07-30T01:00:00.000Z'),
    });

    const result = await repository.create(connection, DEVICE_ID, {
      skuNumber: 'ＡBC-Long',
      name: 'Produk',
      referencePrice: 25_000,
      openingStock: -3,
      tracked: true,
      note: 'catatan',
      imageUrl: 'https://example.test/a.png',
    });

    expect(result.body.serverRevision).toBe('14');
    expect(result.body.entity).toMatchObject({
      skuNumber: 'ＡBC-Long',
      referencePrice: 25_000,
      stock: -3,
      tracked: true,
      identifiers: [
        {
          id: '00000003-0000-4000-8000-000000000000',
          skuId: '00000002-0000-4000-8000-000000000000',
          value: 'ＡBC-Long',
          kind: 'primary',
          createdAt: '2026-07-30T01:00:00.000Z',
        },
      ],
    });
    expect(
      queries.some(({ sql }) => sql.startsWith('INSERT INTO skus')),
    ).toBe(true);
    const identifier = queries.find(({ sql }) =>
      sql.startsWith('INSERT INTO sku_identifiers'),
    );
    expect(identifier?.values[3]).toEqual(
      Buffer.from(
        'c5d0d2a7a79ca0a4839ad809ec52ce58e2ec7dac44bcae54e7b233f1415a47ff',
        'hex',
      ),
    );
    expect(
      queries.some(({ sql }) => sql.startsWith('INSERT INTO price_history')),
    ).toBe(true);
    expect(
      queries.some(({ sql }) => sql.startsWith('INSERT INTO audit_events')),
    ).toBe(true);
    expect(
      queries.filter(({ sql }) => sql.startsWith('INSERT INTO change_log')),
    ).toHaveLength(4);
  });

  it('fails before inserts when a normalized identifier is already owned', async () => {
    const { connection, queries } = connectionWith((sql) =>
      sql.includes('FROM sku_identifiers')
        ? [{ sku_id_hex: SKU_ID.replaceAll('-', '') }]
        : [],
    );
    const repository = new MariaDbSkuOperationsRepository();

    await expect(
      repository.create(connection, DEVICE_ID, {
        skuNumber: 'ABC',
        name: 'Produk',
        referencePrice: 1,
        openingStock: 0,
        tracked: false,
      }),
    ).rejects.toMatchObject({ code: 'IDENTIFIER_CONFLICT', statusCode: 409 });
    expect(
      queries.some(({ sql }) => sql.startsWith('INSERT INTO skus')),
    ).toBe(false);
  });

  it('patches by row version, preserves the previous primary as alias, and appends price history', async () => {
    let revision = 20n;
    const { connection, queries } = connectionWith((sql) => {
      if (sql.includes('FROM skus') && sql.includes('FOR UPDATE')) {
        return [
          {
            id_hex: SKU_ID.replaceAll('-', ''),
            primary_identifier: 'OLD',
            name: 'Produk',
            price_rupiah: 100,
            source_image_url: null,
            source_note: '',
            row_version: 4,
            archived_at: null,
            created_at: new Date('2026-01-01T00:00:00.000Z'),
            updated_at: new Date('2026-01-01T00:00:00.000Z'),
          },
        ];
      }
      if (
        sql.includes('FROM sku_identifiers') &&
        sql.includes("identifier_kind = 'primary'")
      ) {
        return [
          {
            id_hex: '55555555555545558555555555555555',
            identifier_value: 'OLD',
            created_at: new Date('2026-01-01T00:00:00.000Z'),
          },
        ];
      }
      if (sql.includes('INSERT INTO change_log')) {
        revision += 1n;
        return { insertId: revision };
      }
      return [];
    });
    const repository = new MariaDbSkuOperationsRepository({
      now: () => new Date('2026-07-30T02:00:00.000Z'),
    });

    const result = await repository.update(connection, DEVICE_ID, SKU_ID, {
      rowVersion: '4',
      base: { skuNumber: 'OLD', referencePrice: 100 },
      patch: { skuNumber: 'NEW', referencePrice: 150 },
    });

    expect(result.body).toMatchObject({
      serverRevision: '24',
      entityVersion: '5',
    });
    expect(
      queries.some(
        ({ sql }) =>
          sql.startsWith('UPDATE sku_identifiers') &&
          sql.includes("identifier_kind = 'alias'"),
      ),
    ).toBe(true);
    expect(
      queries.some(({ sql }) => sql.startsWith('INSERT INTO price_history')),
    ).toBe(true);
    const identifierChanges = queries.filter(
      ({ sql, values }) =>
        sql.startsWith('INSERT INTO change_log') &&
        values[0] === 'sku_identifier',
    );
    expect(identifierChanges).toHaveLength(2);
    expect(identifierChanges[0]?.values[3]).toContain(
      '"identifierKind":"alias"',
    );
  });

  it('promotes an existing alias owned by the SKU instead of inserting the same hash', async () => {
    let revision = 30n;
    const primaryId = '55555555-5555-4555-8555-555555555555';
    const aliasId = '66666666-6666-4666-8666-666666666666';
    const { connection, queries } = connectionWith((sql) => {
      if (sql.includes('FROM skus') && sql.includes('FOR UPDATE')) {
        return [
          {
            id_hex: SKU_ID.replaceAll('-', ''),
            primary_identifier: 'OLD',
            name: 'Produk',
            price_rupiah: 100,
            image_hash: null,
            source_image_url: null,
            source_note: '',
            row_version: 4,
            archived_at: null,
            created_at: new Date('2026-01-01T00:00:00.000Z'),
            updated_at: new Date('2026-01-01T00:00:00.000Z'),
          },
        ];
      }
      if (
        sql.includes('FROM sku_identifiers') &&
        sql.includes('identifier_hash = ?')
      ) {
        return [
          {
            id_hex: aliasId.replaceAll('-', ''),
            sku_id_hex: SKU_ID.replaceAll('-', ''),
            identifier_value: 'ALIAS',
            identifier_kind: 'alias',
            created_at: new Date('2026-01-02T00:00:00.000Z'),
          },
        ];
      }
      if (
        sql.includes('FROM sku_identifiers') &&
        sql.includes("identifier_kind = 'primary'")
      ) {
        return [
          {
            id_hex: primaryId.replaceAll('-', ''),
            identifier_value: 'OLD',
            created_at: new Date('2026-01-01T00:00:00.000Z'),
          },
        ];
      }
      if (sql.includes('INSERT INTO change_log')) {
        revision += 1n;
        return { insertId: revision };
      }
      return [];
    });
    const repository = new MariaDbSkuOperationsRepository({
      now: () => new Date('2026-07-30T02:10:00.000Z'),
    });

    await repository.update(connection, DEVICE_ID, SKU_ID, {
      rowVersion: '4',
      base: { skuNumber: 'OLD' },
      patch: { skuNumber: 'ALIAS' },
    });

    expect(
      queries.some(({ sql }) => sql.startsWith('INSERT INTO sku_identifiers')),
    ).toBe(false);
    expect(
      queries.some(
        ({ sql, values }) =>
          sql.startsWith('UPDATE sku_identifiers') &&
          values.includes(aliasId) &&
          sql.includes("identifier_kind = 'primary'"),
      ),
    ).toBe(true);
  });

  it('updates the existing primary row for a case and spacing equivalent identifier', async () => {
    let revision = 40n;
    const primaryId = '55555555-5555-4555-8555-555555555555';
    const { connection, queries } = connectionWith((sql) => {
      if (sql.includes('FROM skus') && sql.includes('FOR UPDATE')) {
        return [
          {
            id_hex: SKU_ID.replaceAll('-', ''),
            primary_identifier: 'ABC',
            name: 'Produk',
            price_rupiah: 100,
            image_hash: null,
            source_image_url: null,
            source_note: '',
            row_version: 4,
            archived_at: null,
            created_at: new Date('2026-01-01T00:00:00.000Z'),
            updated_at: new Date('2026-01-01T00:00:00.000Z'),
          },
        ];
      }
      if (
        sql.includes('FROM sku_identifiers') &&
        sql.includes('identifier_hash = ?')
      ) {
        return [
          {
            id_hex: primaryId.replaceAll('-', ''),
            sku_id_hex: SKU_ID.replaceAll('-', ''),
            identifier_value: 'ABC',
            identifier_kind: 'primary',
            created_at: new Date('2026-01-01T00:00:00.000Z'),
          },
        ];
      }
      if (sql.includes('INSERT INTO change_log')) {
        revision += 1n;
        return { insertId: revision };
      }
      return [];
    });
    const repository = new MariaDbSkuOperationsRepository({
      now: () => new Date('2026-07-30T02:20:00.000Z'),
    });

    await repository.update(connection, DEVICE_ID, SKU_ID, {
      rowVersion: '4',
      base: { skuNumber: 'ABC' },
      patch: { skuNumber: '  ＡＢＣ  ' },
    });

    expect(
      queries.some(({ sql }) => sql.startsWith('INSERT INTO sku_identifiers')),
    ).toBe(false);
    expect(
      queries.some(
        ({ sql, values }) =>
          sql.startsWith('UPDATE sku_identifiers') &&
          values.includes(primaryId) &&
          values.includes('  ＡＢＣ  '),
      ),
    ).toBe(true);
  });

  it('rejects a normalized-equivalent identifier owned by another SKU before writes', async () => {
    const { connection, queries } = connectionWith((sql) => {
      if (sql.includes('FROM skus') && sql.includes('FOR UPDATE')) {
        return [
          {
            id_hex: SKU_ID.replaceAll('-', ''),
            primary_identifier: 'OLD',
            name: 'Produk',
            price_rupiah: 100,
            image_hash: null,
            source_image_url: null,
            source_note: '',
            row_version: 4,
            archived_at: null,
            created_at: new Date('2026-01-01T00:00:00.000Z'),
            updated_at: new Date('2026-01-01T00:00:00.000Z'),
          },
        ];
      }
      if (sql.includes('identifier_hash = ?')) {
        return [
          {
            id_hex: '77777777777747778777777777777777',
            sku_id_hex: OTHER_SKU_ID.replaceAll('-', ''),
            identifier_value: 'ABC',
            identifier_kind: 'alias',
            created_at: new Date('2026-01-01T00:00:00.000Z'),
          },
        ];
      }
      return [];
    });
    const repository = new MariaDbSkuOperationsRepository();

    await expect(
      repository.update(connection, DEVICE_ID, SKU_ID, {
        rowVersion: '4',
        base: { skuNumber: 'OLD' },
        patch: { skuNumber: '  abc  ' },
      }),
    ).rejects.toMatchObject({ code: 'IDENTIFIER_CONFLICT', statusCode: 409 });
    expect(
      queries.some(({ sql }) => /^(UPDATE|INSERT)/.test(sql)),
    ).toBe(false);
  });

  it('returns a typed conflict without writing when the SKU version is stale', async () => {
    const { connection, queries } = connectionWith((sql) =>
      sql.includes('FROM skus') && sql.includes('FOR UPDATE')
        ? [
            {
              id_hex: SKU_ID.replaceAll('-', ''),
              primary_identifier: 'SERVER',
              name: 'Server name',
              price_rupiah: 100,
              source_image_url: null,
              source_note: '',
              row_version: 9,
              archived_at: null,
              created_at: new Date('2026-01-01T00:00:00.000Z'),
              updated_at: new Date('2026-01-01T00:00:00.000Z'),
            },
          ]
        : [],
    );
    const repository = new MariaDbSkuOperationsRepository();

    await expect(
      repository.update(connection, DEVICE_ID, SKU_ID, {
        rowVersion: '8',
        base: { name: 'Name at version 8' },
        patch: { name: 'Mine' },
      }),
    ).rejects.toBeInstanceOf(CatalogueConflictError);
    await repository
      .update(connection, DEVICE_ID, SKU_ID, {
        rowVersion: '8',
        base: { name: 'Name at version 8' },
        patch: { name: 'Mine' },
      })
      .catch((error: CatalogueConflictError) => {
        expect(error.conflict).toMatchObject({
          entityType: 'sku',
          entityId: SKU_ID,
          base: { name: 'Name at version 8' },
          mine: { name: 'Mine' },
          server: { name: 'Server name', rowVersion: '9' },
        });
      });
    expect(
      queries.some(({ sql }) => /^(UPDATE|INSERT)/.test(sql)),
    ).toBe(false);
  });

  it('replaces the image hash and source metadata in the SKU and change payload', async () => {
    let revision = 50n;
    const oldHash = 'a'.repeat(64);
    const nextHash = 'b'.repeat(64);
    const { connection, queries } = connectionWith((sql) => {
      if (sql.includes('FROM skus') && sql.includes('FOR UPDATE')) {
        return [
          {
            id_hex: SKU_ID.replaceAll('-', ''),
            primary_identifier: 'SKU-1',
            name: 'Produk',
            price_rupiah: 100,
            image_hash: Buffer.from(oldHash, 'hex'),
            source_image_url: 'https://example.test/old.png',
            source_note: '',
            row_version: 4,
            archived_at: null,
            created_at: new Date('2026-01-01T00:00:00.000Z'),
            updated_at: new Date('2026-01-01T00:00:00.000Z'),
          },
        ];
      }
      if (sql.includes('INSERT INTO change_log')) {
        revision += 1n;
        return { insertId: revision };
      }
      return [];
    });
    const repository = new MariaDbSkuOperationsRepository({
      now: () => new Date('2026-07-30T03:00:00.000Z'),
    });

    const result = await repository.update(
      connection,
      DEVICE_ID,
      SKU_ID,
      {
        rowVersion: '4',
        base: {
          imageHash: oldHash,
          sourceImageUrl: 'https://example.test/old.png',
        },
        patch: { imageHash: nextHash, sourceImageUrl: null },
      },
    );

    expect(result.body.entity).toMatchObject({
      imageHash: nextHash,
      sourceImageUrl: null,
    });
    const update = queries.find(({ sql }) => sql.startsWith('UPDATE skus'));
    expect(update?.sql).toContain('image_hash');
    expect(update?.values).toContain(nextHash);
    const skuChange = queries.find(
      ({ sql, values }) =>
        sql.startsWith('INSERT INTO change_log') && values[0] === 'sku',
    );
    expect(skuChange?.values[3]).toContain(`"imageHash":"${nextHash}"`);
    expect(skuChange?.values[3]).toContain('"sourceImageUrl":null');
  });

  it('exposes an active-only locked lookup for future business operations', async () => {
    const active = connectionWith(() => [{ id_hex: SKU_ID.replaceAll('-', '') }]);
    const archived = connectionWith(() => []);
    const repository = new MariaDbSkuOperationsRepository();

    await expect(
      repository.requireActiveSku(active.connection, SKU_ID),
    ).resolves.toBe(SKU_ID);
    await expect(
      repository.requireActiveSku(archived.connection, SKU_ID),
    ).rejects.toMatchObject({ code: 'SKU_NOT_ACTIVE', statusCode: 409 });
    expect(active.queries[0]?.sql).toContain('archived_at IS NULL');
    expect(active.queries[0]?.sql).toContain('FOR UPDATE');
  });
});
