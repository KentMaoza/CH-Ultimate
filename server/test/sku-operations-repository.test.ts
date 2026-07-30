import { describe, expect, it } from 'vitest';

import {
  CatalogueConflictError,
  MariaDbSkuOperationsRepository,
} from '../src/catalogue/mariadb-sku-operations-repository.js';
import type { ProtocolConnection } from '../src/sync/idempotency.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const SKU_ID = '22222222-2222-4222-8222-222222222222';

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
      patch: { skuNumber: 'NEW', referencePrice: 150 },
    });

    expect(result.body).toMatchObject({
      serverRevision: '24',
      entityVersion: '5',
    });
    expect(
      queries.some(
        ({ sql, values }) =>
          sql.startsWith('UPDATE sku_identifiers') &&
          values.includes('alias'),
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
        patch: { name: 'Mine' },
      }),
    ).rejects.toBeInstanceOf(CatalogueConflictError);
    await repository
      .update(connection, DEVICE_ID, SKU_ID, {
        rowVersion: '8',
        patch: { name: 'Mine' },
      })
      .catch((error: CatalogueConflictError) => {
        expect(error.conflict).toMatchObject({
          entityType: 'sku',
          entityId: SKU_ID,
          mine: { name: 'Mine' },
          server: { name: 'Server name', rowVersion: '9' },
        });
      });
    expect(
      queries.some(({ sql }) => /^(UPDATE|INSERT)/.test(sql)),
    ).toBe(false);
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
