import { describe, expect, it } from 'vitest';

import {
  CatalogueConflictError,
} from '../src/catalogue/mariadb-sku-operations-repository.js';
import { MariaDbTemplateOperationsRepository } from '../src/catalogue/mariadb-template-operations-repository.js';
import type { ProtocolConnection } from '../src/sync/idempotency.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';
const definition = {
  medium: 'thermal' as const,
  widthMm: 50,
  heightMm: 30,
  columns: 1,
  marginMm: 2,
  gapMm: 1,
  fontSize: 10,
  alignment: 'center' as const,
  fields: ['qr' as const, 'name' as const],
};

function connectionWith(
  row?: Record<string, unknown>,
) {
  const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
  let revision = 40n;
  const connection = {
    async query<T>(sql: string, values: readonly unknown[] = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: compact, values });
      if (compact.includes('FROM templates') && compact.includes('FOR UPDATE')) {
        return (row ? [row] : []) as T;
      }
      if (compact.startsWith('INSERT INTO change_log')) {
        revision += 1n;
        return { insertId: revision } as T;
      }
      return [] as T;
    },
  } as Pick<ProtocolConnection, 'query'>;
  return { connection, queries };
}

describe('MariaDB authoritative template repository', () => {
  it('creates the only row for a template kind when its version is null', async () => {
    const test = connectionWith();
    const repository = new MariaDbTemplateOperationsRepository({
      uuid: () => TEMPLATE_ID,
      now: () => new Date('2026-07-30T04:00:00.000Z'),
    });

    const result = await repository.update(
      test.connection,
      DEVICE_ID,
      'label',
      { rowVersion: null, definition },
    );

    expect(result.body).toMatchObject({
      serverRevision: '41',
      entityVersion: '1',
      entity: {
        id: TEMPLATE_ID,
        templateKind: 'label',
        definition,
        rowVersion: '1',
      },
    });
    const insert = test.queries.find(({ sql }) =>
      sql.startsWith('INSERT INTO templates'),
    );
    expect(insert?.sql).toContain('template_kind');
    expect(insert?.values).toEqual(
      expect.arrayContaining([TEMPLATE_ID, 'label', JSON.stringify(definition)]),
    );
  });

  it('updates the existing row by exact version instead of creating history duplicates', async () => {
    const test = connectionWith({
      id_hex: TEMPLATE_ID.replaceAll('-', ''),
      template_kind: 'label',
      name: 'Label',
      definition_json: JSON.stringify({ ...definition, fontSize: 9 }),
      row_version: 3,
      archived_at: null,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    });
    const repository = new MariaDbTemplateOperationsRepository({
      now: () => new Date('2026-07-30T04:00:00.000Z'),
    });

    const result = await repository.update(
      test.connection,
      DEVICE_ID,
      'label',
      { rowVersion: '3', definition },
    );

    expect(result.body).toMatchObject({ entityVersion: '4' });
    expect(
      test.queries.filter(({ sql }) => sql.startsWith('UPDATE templates')),
    ).toHaveLength(1);
    expect(
      test.queries.filter(({ sql }) => sql.startsWith('INSERT INTO templates')),
    ).toHaveLength(0);
  });

  it('returns a typed conflict for stale and null-on-existing versions', async () => {
    const row = {
      id_hex: TEMPLATE_ID.replaceAll('-', ''),
      template_kind: 'invoice',
      name: 'Invoice',
      definition_json: JSON.stringify({
        widthMm: 210,
        heightMm: 297,
        fontSize: 10,
        logoUrl: '',
        bankAccount: '',
        address: '',
        phone: '',
        elements: [],
      }),
      row_version: 6,
      archived_at: null,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    const test = connectionWith(row);
    const repository = new MariaDbTemplateOperationsRepository();

    await expect(
      repository.update(test.connection, DEVICE_ID, 'invoice', {
        rowVersion: null,
        definition: JSON.parse(String(row.definition_json)),
      }),
    ).rejects.toBeInstanceOf(CatalogueConflictError);
    expect(
      test.queries.some(({ sql }) => /^(INSERT|UPDATE)/.test(sql)),
    ).toBe(false);
  });
});
