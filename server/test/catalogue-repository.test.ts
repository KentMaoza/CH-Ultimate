import { describe, expect, it, vi } from 'vitest';

import { MariaDbCatalogueRepository } from '../src/catalogue/mariadb-repository.js';
import type {
  CatalogueCommitResult,
  CatalogueImportRecord,
} from '../src/catalogue/service.js';
import type { CatalogueWorkbook } from '../src/catalogue/workbook.js';
import type {
  ProtocolConnection,
  ProtocolPool,
} from '../src/sync/idempotency.js';

const importId = '11111111-1111-4111-8111-111111111111';
const deviceId = '22222222-2222-4222-8222-222222222222';
const skuId = '33333333-3333-4333-8333-333333333333';
const primaryIdentifierId = '44444444-4444-4444-8444-444444444444';
const productIdentifierId = '55555555-5555-4555-8555-555555555555';
const imageJobId = '66666666-6666-4666-8666-666666666666';
const priceHistoryId = '77777777-7777-4777-8777-777777777777';
const stockMovementId = '88888888-8888-4888-8888-888888888888';

const record: CatalogueImportRecord = {
  id: importId,
  workbookSha256: 'a'.repeat(64),
  sourceFileName: 'catalogue.xlsx',
  stagedPath: `imports/staged/${'a'.repeat(64)}.xlsx`,
  status: 'staged',
  preview: {
    rowCount: 1,
    imageJobCount: 1,
    missingImageCount: 0,
    priceMismatchCount: 1,
    selectedPriceTotal: 15_000,
    stockTotal: 12,
    maximumCellTextLength: 30,
    warnings: [],
    priceMismatches: [
      {
        rowNumber: 2,
        primarySku: 'SKU-A',
        modalPrice: 12_000,
        salePrice: 15_000,
        selectedPrice: 15_000,
      },
    ],
  },
  createdByDeviceId: deviceId,
  createdAt: '2026-07-30T01:00:00.000Z',
  expiresAt: '2026-07-31T01:00:00.000Z',
  committedAt: null,
  result: null,
};

const workbook: CatalogueWorkbook = {
  rows: [
    {
      rowNumber: 2,
      primarySku: 'SKU-A',
      productCode: '87000001',
      name: 'Produk A',
      selectedPrice: 15_000,
      stockPcs: 12,
      note: 'Rak A',
      imageSourceUrl: 'https://res.bigseller.pro/a.jpg',
      sourceCreatedAt: '2026-07-30 09:24',
    },
  ],
  preview: record.preview,
};

type QueryResult = unknown;

function commitHarness(
  options: {
    lockedStatus?: 'staged' | 'committed';
    existingSkuRows?: Array<{
      sku_id_hex: string;
      primary_identifier: string;
      row_version: string;
      balance_row_version: string | null;
      quantity_pcs: string | null;
      created_at: Date;
      image_hash_hex: string | null;
      archived_at: Date | null;
      identifier_id_hex: string;
      identifier_value: string;
      identifier_kind: string;
      identifier_created_at: Date;
    }>;
    failOn?: RegExp;
  } = {},
) {
  const events: string[] = [];
  const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
  const committedResult: CatalogueCommitResult = {
    importId,
    workbookSha256: record.workbookSha256,
    rowCount: 1,
    imageJobCount: 1,
    matchedExistingCount: 0,
    createdSkuCount: 1,
    untouchedExistingCount: 0,
    stockAdjustedCount: 0,
    zeroDeltaMatchedCount: 0,
    committedAt: '2026-07-30T02:00:00.000Z',
    replayed: false,
  };
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
      if (options.failOn?.test(compact)) throw new Error('database failed');
      if (compact.includes('FROM business_write_lock')) {
        return [{ singleton_id: 1 }] as T;
      }
      if (compact.includes('FROM imports') && compact.includes('FOR UPDATE')) {
        return [
          {
            status: options.lockedStatus ?? 'staged',
            result_json:
              options.lockedStatus === 'committed'
                ? JSON.stringify(committedResult)
                : null,
          },
        ] as T;
      }
      if (compact.includes('FROM skus s') && compact.includes('sku_id_hex')) {
        const rows = options.existingSkuRows ?? [];
        return (
          compact.includes('WHERE s.archived_at IS NULL')
            ? rows.filter((row) => row.archived_at === null)
            : rows
        ) as T;
      }
      return { affectedRows: 1 } as T;
    },
  };
  const pool: ProtocolPool & {
    query<T>(sql: string, values?: readonly unknown[]): Promise<T>;
  } = {
    getConnection: vi.fn(async () => connection),
    query: (sql, values) => connection.query(sql, values),
  };
  const uuids = [
    skuId,
    primaryIdentifierId,
    productIdentifierId,
    imageJobId,
    priceHistoryId,
    stockMovementId,
  ];
  const repository = new MariaDbCatalogueRepository(pool, {
    randomUuid: () => uuids.shift()!,
  });
  return { committedResult, events, queries, repository };
}

describe('MariaDB catalogue repository', () => {
  it('persists staged source identity and preview without changing the workbook path', async () => {
    const query = vi.fn(async <T>() => ({ affectedRows: 1 }) as T);
    const repository = new MariaDbCatalogueRepository({ query } as never);

    await expect(repository.createStage(record)).resolves.toEqual(record);

    expect(query).toHaveBeenCalledOnce();
    const [sql, values] = query.mock.calls[0]! as unknown as [
      string,
      readonly unknown[],
    ];
    expect(sql).toContain('INSERT INTO imports');
    expect(sql).toContain('source_file_name');
    expect(sql).toContain('preview_json');
    expect(values).toEqual(
      expect.arrayContaining([
        importId,
        Buffer.from(record.workbookSha256, 'hex'),
        record.sourceFileName,
        record.stagedPath,
      ]),
    );
  });

  it('refreshes and lists only expired uncommitted stage byte paths', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{ staged_path: record.stagedPath }]);
    const repository = new MariaDbCatalogueRepository({ query } as never);
    const refreshed = {
      ...record,
      sourceFileName: 'catalogue-refresh.xlsx',
      expiresAt: '2026-08-01T01:00:00.000Z',
    };

    await expect(repository.refreshStage(refreshed)).resolves.toEqual(
      refreshed,
    );
    await expect(
      repository.listExpiredStagePaths(new Date('2026-08-02T00:00:00.000Z')),
    ).resolves.toEqual([record.stagedPath]);

    expect(query.mock.calls[0]?.[0]).toContain("status = 'staged'");
    expect(query.mock.calls[1]?.[0]).toContain('expires_at <= ?');
    expect(query.mock.calls[1]?.[0]).toContain("status = 'staged'");
  });

  it('atomically writes SKU provenance, aliases, stock, price, image job, audit, and changes', async () => {
    const { events, queries, repository } = commitHarness();

    const result = await repository.commit(
      record,
      workbook,
      new Date('2026-07-30T02:00:00.000Z'),
    );

    expect(result).toEqual({
      importId,
      workbookSha256: record.workbookSha256,
      rowCount: 1,
      imageJobCount: 1,
      matchedExistingCount: 0,
      createdSkuCount: 1,
      untouchedExistingCount: 0,
      stockAdjustedCount: 0,
      zeroDeltaMatchedCount: 0,
      committedAt: '2026-07-30T02:00:00.000Z',
      replayed: false,
    });
    expect(events).toEqual(['begin', 'commit', 'release']);
    const insert = (table: string) =>
      queries.find(({ sql }) => sql.startsWith(`INSERT INTO ${table}`));
    expect(insert('skus')?.values).toEqual(
      expect.arrayContaining([
        skuId,
        'SKU-A',
        'Produk A',
        15_000,
        'https://res.bigseller.pro/a.jpg',
        importId,
        'Rak A',
        '2026-07-30 09:24',
      ]),
    );
    expect(insert('sku_identifiers')?.values).toEqual(
      expect.arrayContaining([
        primaryIdentifierId,
        'SKU-A',
        'primary',
        productIdentifierId,
        '87000001',
        'product_code',
      ]),
    );
    expect(insert('stock_balances')?.values).toContain(12);
    expect(insert('stock_balances')?.sql).not.toContain(
      'ON DUPLICATE KEY UPDATE',
    );
    expect(insert('stock_movements')).toBeUndefined();
    expect(insert('price_history')?.values).toContain('catalogue_import');
    expect(insert('image_jobs')?.values).toEqual(
      expect.arrayContaining([
        imageJobId,
        importId,
        skuId,
        'https://res.bigseller.pro/a.jpg',
      ]),
    );
    expect(insert('audit_events')).toBeDefined();
    expect(insert('change_log')).toBeDefined();
    expect(
      queries.some(({ sql }) => sql.startsWith('UPDATE imports SET status =')),
    ).toBe(true);
    const lockIndex = queries.findIndex(({ sql }) =>
      sql.includes('FROM business_write_lock'),
    );
    const firstWriteIndex = queries.findIndex(({ sql }) =>
      sql.startsWith('INSERT INTO skus'),
    );
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(firstWriteIndex);
    expect(
      queries.some(({ sql }) => sql.includes('AS has_live_transactions')),
    ).toBe(false);
  });

  it('returns a locked committed result as an idempotent replay', async () => {
    const { committedResult, events, queries, repository } = commitHarness({
      lockedStatus: 'committed',
    });

    await expect(
      repository.commit(record, workbook, new Date('2026-07-30T03:00:00.000Z')),
    ).resolves.toEqual({ ...committedResult, replayed: true });

    expect(events).toEqual(['begin', 'commit', 'release']);
    expect(queries.some(({ sql }) => sql.startsWith('INSERT INTO skus'))).toBe(
      false,
    );
  });

  it('does not query or delete live history before a safe reconciliation', async () => {
    const { events, queries, repository } = commitHarness();

    await expect(
      repository.commit(record, workbook, new Date('2026-07-30T02:00:00.000Z')),
    ).resolves.toMatchObject({ replayed: false });

    expect(events).toEqual(['begin', 'commit', 'release']);
    expect(
      queries.some(({ sql }) => sql.includes('AS has_live_transactions')),
    ).toBe(false);
    expect(queries.some(({ sql }) => sql.startsWith('DELETE FROM'))).toBe(
      false,
    );
  });

  it('rolls back every catalogue write when one insert fails', async () => {
    const { events, repository } = commitHarness({
      failOn: /^INSERT INTO stock_balances/,
    });

    await expect(
      repository.commit(record, workbook, new Date('2026-07-30T02:00:00.000Z')),
    ).rejects.toThrow('database failed');
    expect(events).toEqual(['begin', 'rollback', 'release']);
  });

  it('rolls back catalogue metadata when a reconciliation movement fails', async () => {
    const existingSkuId = '89898989-8989-4989-8989-898989898989';
    const { events, repository } = commitHarness({
      existingSkuRows: [
        {
          sku_id_hex: existingSkuId.replaceAll('-', '').toUpperCase(),
          primary_identifier: 'SKU-A',
          row_version: '1',
          balance_row_version: '7',
          quantity_pcs: '7',
          created_at: new Date('2026-07-29T02:00:00.000Z'),
          image_hash_hex: null,
          archived_at: null,
          identifier_id_hex: '90909090909040908090909090909090',
          identifier_value: 'SKU-A',
          identifier_kind: 'primary',
          identifier_created_at: new Date('2026-07-29T02:01:00.000Z'),
        },
      ],
      failOn: /^INSERT INTO stock_movements/,
    });

    await expect(
      repository.commit(record, workbook, new Date('2026-07-30T02:00:00.000Z')),
    ).rejects.toThrow('database failed');
    expect(events).toEqual(['begin', 'rollback', 'release']);
  });

  it('adds a new baseline beside retained catalogue rows without clearing history', async () => {
    const { queries, repository } = commitHarness();

    await repository.commit(
      record,
      workbook,
      new Date('2026-07-30T02:00:00.000Z'),
    );

    expect(queries.some(({ sql }) => sql.startsWith('DELETE FROM'))).toBe(
      false,
    );
    expect(
      queries.some(
        ({ sql, values }) =>
          sql.startsWith('INSERT INTO change_log') &&
          values[0] === 'catalogue_epoch',
      ),
    ).toBe(false);
    expect(queries.some(({ sql }) => sql.startsWith('INSERT INTO skus'))).toBe(
      true,
    );
  });

  it('reconciles a matching imported SKU without replacing its identity', async () => {
    const existingSkuId = '88888888-8888-4888-8888-888888888888';
    const { queries, repository } = commitHarness({
      existingSkuRows: [
        {
          sku_id_hex: existingSkuId.replaceAll('-', '').toUpperCase(),
          primary_identifier: 'SKU-A',
          row_version: '1',
          balance_row_version: '7',
          quantity_pcs: '7',
          created_at: new Date('2026-07-29T02:00:00.000Z'),
          image_hash_hex: null,
          archived_at: null,
          identifier_id_hex: '99999999999949998999999999999999'.toUpperCase(),
          identifier_value: 'SKU-A',
          identifier_kind: 'primary',
          identifier_created_at: new Date('2026-07-29T02:01:00.000Z'),
        },
        {
          sku_id_hex: existingSkuId.replaceAll('-', '').toUpperCase(),
          primary_identifier: 'SKU-A',
          row_version: '1',
          balance_row_version: '7',
          quantity_pcs: '7',
          created_at: new Date('2026-07-29T02:00:00.000Z'),
          image_hash_hex: null,
          archived_at: null,
          identifier_id_hex: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa'.toUpperCase(),
          identifier_value: '87000001',
          identifier_kind: 'product_code',
          identifier_created_at: new Date('2026-07-29T02:02:00.000Z'),
        },
      ],
    });

    await repository.commit(
      record,
      workbook,
      new Date('2026-07-30T02:00:00.000Z'),
    );

    expect(queries.some(({ sql }) => sql.startsWith('DELETE FROM skus'))).toBe(
      false,
    );
    expect(
      queries.some(
        ({ sql, values }) =>
          sql.startsWith('UPDATE skus') && values.includes(existingSkuId),
      ),
    ).toBe(true);
    expect(
      queries.some(
        ({ sql, values }) =>
          sql.startsWith('INSERT INTO skus') && values.includes(existingSkuId),
      ),
    ).toBe(false);
    expect(
      queries.some(
        ({ sql, values }) =>
          sql.startsWith('UPDATE stock_balances') &&
          values.includes(12) &&
          values.includes(existingSkuId),
      ),
    ).toBe(true);
    const movementInsert = queries.find(({ sql }) =>
      sql.startsWith('INSERT INTO stock_movements'),
    );
    expect(movementInsert?.sql).toContain('catalogue_reconciliation');
    expect(movementInsert?.values).toEqual(
      expect.arrayContaining([existingSkuId, '5', deviceId, importId]),
    );
    const changePayloads = queries
      .filter(({ sql }) => sql.startsWith('INSERT INTO change_log'))
      .flatMap(({ values }) => values)
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.startsWith('{'),
      )
      .map((value) => JSON.parse(value) as Record<string, unknown>);
    expect(changePayloads).toContainEqual(
      expect.objectContaining({
        skuId: existingSkuId,
        quantityPcs: '12',
        rowVersion: '8',
      }),
    );
    expect(changePayloads).toContainEqual(
      expect.objectContaining({
        skuId: existingSkuId,
        deltaPcs: '5',
        reason: 'catalogue_reconciliation',
        beforeQuantityPcs: '7',
        afterQuantityPcs: '12',
      }),
    );
    const stockAudit = queries.find(
      ({ sql }) =>
        sql.startsWith('INSERT INTO audit_events') &&
        sql.includes('catalogue.stock_reconciled'),
    );
    const stockAuditDetail = stockAudit?.values.find(
      (value): value is string =>
        typeof value === 'string' && value.startsWith('{'),
    );
    expect(JSON.parse(String(stockAuditDetail))).toMatchObject({
      beforeQuantityPcs: '7',
      afterQuantityPcs: '12',
      deltaPcs: '5',
      importId,
      workbookSha256: record.workbookSha256,
    });
    const importAudit = queries.find(
      ({ sql }) =>
        sql.startsWith('INSERT INTO audit_events') &&
        sql.includes('catalogue.import_committed'),
    );
    expect(JSON.parse(String(importAudit?.values.at(-1)))).toMatchObject({
      matchedExistingCount: 1,
      createdSkuCount: 0,
      untouchedExistingCount: 0,
      stockAdjustedCount: 1,
      zeroDeltaMatchedCount: 0,
    });
    expect(changePayloads).toContainEqual(
      expect.objectContaining({
        id: '99999999-9999-4999-8999-999999999999',
        identifierValue: 'SKU-A',
        createdAt: '2026-07-29T02:01:00.000Z',
      }),
    );
  });

  it('does not create stock movement or balance change for a zero-delta match', async () => {
    const existingSkuId = '91919191-9191-4191-8191-919191919191';
    const { queries, repository } = commitHarness({
      existingSkuRows: [
        {
          sku_id_hex: existingSkuId.replaceAll('-', '').toUpperCase(),
          primary_identifier: 'SKU-A',
          row_version: '1',
          balance_row_version: '7',
          quantity_pcs: '12',
          created_at: new Date('2026-07-29T02:00:00.000Z'),
          image_hash_hex: null,
          archived_at: null,
          identifier_id_hex: '92929292929242928292929292929292',
          identifier_value: 'SKU-A',
          identifier_kind: 'primary',
          identifier_created_at: new Date('2026-07-29T02:01:00.000Z'),
        },
      ],
    });

    await repository.commit(
      record,
      workbook,
      new Date('2026-07-30T02:00:00.000Z'),
    );

    expect(
      queries.some(({ sql }) => sql.startsWith('UPDATE stock_balances')),
    ).toBe(false);
    expect(
      queries.some(({ sql }) => sql.startsWith('INSERT INTO stock_movements')),
    ).toBe(false);
    const balanceChanges = queries
      .filter(({ sql }) => sql.startsWith('INSERT INTO change_log'))
      .flatMap(({ values }) => values)
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.startsWith('{'),
      )
      .map((value) => JSON.parse(value) as Record<string, unknown>)
      .filter((payload) => payload.skuId === existingSkuId)
      .filter((payload) => 'quantityPcs' in payload || 'deltaPcs' in payload);
    expect(balanceChanges).toEqual([]);
    const importAudit = queries.find(
      ({ sql }) =>
        sql.startsWith('INSERT INTO audit_events') &&
        sql.includes('catalogue.import_committed'),
    );
    expect(JSON.parse(String(importAudit?.values.at(-1)))).toMatchObject({
      stockAdjustedCount: 0,
      zeroDeltaMatchedCount: 1,
    });
  });

  it('retains unmatched active SKU rows while adding workbook rows', async () => {
    const unmatchedSkuId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const { events, queries, repository } = commitHarness({
      existingSkuRows: [
        {
          sku_id_hex: unmatchedSkuId.replaceAll('-', '').toUpperCase(),
          primary_identifier: 'SKU-Z',
          row_version: '3',
          balance_row_version: '1',
          quantity_pcs: '3',
          created_at: new Date('2026-07-28T02:00:00.000Z'),
          image_hash_hex: null,
          archived_at: null,
          identifier_id_hex: 'cccccccccccc4ccc8ccccccccccccccc'.toUpperCase(),
          identifier_value: 'SKU-Z',
          identifier_kind: 'primary',
          identifier_created_at: new Date('2026-07-28T02:01:00.000Z'),
        },
      ],
    });

    await expect(
      repository.commit(record, workbook, new Date('2026-07-30T02:00:00.000Z')),
    ).resolves.toMatchObject({ replayed: false });

    expect(events).toEqual(['begin', 'commit', 'release']);
    expect(
      queries.some(
        ({ sql, values }) =>
          sql.startsWith('INSERT INTO skus') && values.includes(skuId),
      ),
    ).toBe(true);
    expect(
      queries.some(({ values }) => values.includes(unmatchedSkuId)),
    ).toBe(false);
    expect(queries.some(({ sql }) => sql.startsWith('DELETE FROM'))).toBe(
      false,
    );
    const importAudit = queries.find(
      ({ sql }) =>
        sql.startsWith('INSERT INTO audit_events') &&
        sql.includes('catalogue.import_committed'),
    );
    expect(JSON.parse(String(importAudit?.values.at(-1)))).toMatchObject({
      untouchedExistingCount: 1,
    });
  });

  it('restores a matching archived SKU instead of creating a duplicate identity', async () => {
    const archivedSkuId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const { queries, repository } = commitHarness({
      existingSkuRows: [
        {
          sku_id_hex: archivedSkuId.replaceAll('-', '').toUpperCase(),
          primary_identifier: 'SKU-A',
          row_version: '4',
          balance_row_version: '2',
          quantity_pcs: '2',
          created_at: new Date('2026-07-27T02:00:00.000Z'),
          image_hash_hex: null,
          archived_at: new Date('2026-07-29T02:00:00.000Z'),
          identifier_id_hex: 'eeeeeeeeeeee4eee8eeeeeeeeeeeeeee'.toUpperCase(),
          identifier_value: 'SKU-A',
          identifier_kind: 'primary',
          identifier_created_at: new Date('2026-07-27T02:01:00.000Z'),
        },
        {
          sku_id_hex: archivedSkuId.replaceAll('-', '').toUpperCase(),
          primary_identifier: 'SKU-A',
          row_version: '4',
          balance_row_version: '2',
          quantity_pcs: '2',
          created_at: new Date('2026-07-27T02:00:00.000Z'),
          image_hash_hex: null,
          archived_at: new Date('2026-07-29T02:00:00.000Z'),
          identifier_id_hex: 'ffffffffffff4fff8fffffffffffffff'.toUpperCase(),
          identifier_value: '87000001',
          identifier_kind: 'product_code',
          identifier_created_at: new Date('2026-07-27T02:02:00.000Z'),
        },
      ],
    });

    await repository.commit(
      record,
      workbook,
      new Date('2026-07-30T02:00:00.000Z'),
    );

    expect(
      queries.some(
        ({ sql, values }) =>
          sql.startsWith('UPDATE skus') && values.includes(archivedSkuId),
      ),
    ).toBe(true);
    expect(queries.some(({ sql }) => sql.startsWith('INSERT INTO skus'))).toBe(
      false,
    );
  });

  it('preserves an extra existing identifier while reconciling its SKU', async () => {
    const existingSkuId = '12121212-1212-4212-8212-121212121212';
    const base = {
      sku_id_hex: existingSkuId.replaceAll('-', '').toUpperCase(),
      primary_identifier: 'SKU-A',
      row_version: '2',
      balance_row_version: '1',
      quantity_pcs: '7',
      created_at: new Date('2026-07-26T02:00:00.000Z'),
      image_hash_hex: null,
      archived_at: null,
    };
    const { events, queries, repository } = commitHarness({
      existingSkuRows: [
        {
          ...base,
          identifier_id_hex: '13131313131343138313131313131313'.toUpperCase(),
          identifier_value: 'SKU-A',
          identifier_kind: 'primary',
          identifier_created_at: new Date('2026-07-26T02:01:00.000Z'),
        },
        {
          ...base,
          identifier_id_hex: '14141414141444148414141414141414'.toUpperCase(),
          identifier_value: '87000001',
          identifier_kind: 'product_code',
          identifier_created_at: new Date('2026-07-26T02:02:00.000Z'),
        },
        {
          ...base,
          identifier_id_hex: '15151515151545158515151515151515'.toUpperCase(),
          identifier_value: 'LEGACY-A',
          identifier_kind: 'alias',
          identifier_created_at: new Date('2026-07-26T02:03:00.000Z'),
        },
      ],
    });

    await expect(
      repository.commit(record, workbook, new Date('2026-07-30T02:00:00.000Z')),
    ).resolves.toMatchObject({ replayed: false });

    expect(events).toEqual(['begin', 'commit', 'release']);
    expect(
      queries.some(
        ({ sql, values }) =>
          sql.startsWith('UPDATE skus') && values.includes(existingSkuId),
      ),
    ).toBe(true);
    expect(
      queries.some(
        ({ sql, values }) =>
          (sql.startsWith('UPDATE sku_identifiers') ||
            sql.startsWith('DELETE FROM sku_identifiers')) &&
          values.includes('15151515-1515-4515-8515-151515151515'),
      ),
    ).toBe(false);
  });
});
