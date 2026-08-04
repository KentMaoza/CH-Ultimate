import { describe, expect, it, vi } from 'vitest';

import { CatalogueOperationError } from '../src/catalogue/mariadb-sku-operations-repository.js';
import { MariaDbOfflineRepository } from '../src/offline/mariadb-repository.js';
import type { OfflineNotaRequest } from '../src/offline/validation.js';
import type { ProtocolConnection } from '../src/sync/idempotency.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const PROVISIONAL_ID = '33333333-3333-4333-8333-333333333333';
const SKU_ID = '44444444-4444-4444-8444-444444444444';
const NOTA_ID = '50000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-07-30T02:00:00.000Z');

function offlineNota(): OfflineNotaRequest {
  return {
    provisionalId: PROVISIONAL_ID,
    completed: true,
    destination: 'archive',
    skuSnapshots: [
      {
        skuId: SKU_ID,
        identifier: 'SKU-CAPTURED',
        name: 'Nama tertangkap',
        referencePrice: 25_000,
      },
    ],
    snapshot: {
      id: PROVISIONAL_ID,
      baseNumber: 'OFFLINE-33333333',
      customerName: 'Toko',
      customerPlace: '',
      transactionDate: '2026-07-30',
      payment: 'cash',
      status: 'completed',
      completionDestination: 'archive',
      completedAt: NOW.toISOString(),
      nextNoteIndex: 1,
      pages: [
        {
          id: '60000000-0000-4000-8000-000000000001',
          suffix: 'A',
          status: 'active',
          lines: [
            {
              id: '70000000-0000-4000-8000-000000000001',
              skuId: SKU_ID,
              description: 'Nama lama',
              kind: '',
              quantity: 2,
              unit: 'pcs',
              pcsPrice: 25_000,
              lsnPrice: 300_000,
            },
          ],
        },
      ],
      postedLines: [],
      postedStockEffects: {},
      postedTrackedLineIds: {},
    },
  };
}

function generatedUuid(index: number): string {
  return `50000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

describe('MariaDB offline Nota repository', () => {
  it('keeps an archived SKU relation, writes its captured snapshot warning, and completes once', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const connection = {
      query: vi.fn(async <T>(sql: string, params?: unknown[]) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        queries.push({
          sql: compact,
          ...(params ? { params } : {}),
        });
        if (compact.startsWith('INSERT INTO nota_daily_sequences')) {
          return { insertId: 1 } as T;
        }
        if (compact.includes('FROM skus')) {
          return [
            {
              id_hex: SKU_ID.replaceAll('-', ''),
              archived_at: NOW,
            },
          ] as T;
        }
        return { insertId: 1 } as T;
      }),
    } as unknown as ProtocolConnection;
    let uuidIndex = 1;
    const complete = vi.fn(async () => ({
      statusCode: 200,
      body: {
        entityVersion: '2',
        entity: { id: NOTA_ID, status: 'completed' },
      },
      audits: [],
      changes: [],
    }));
    const repository = new MariaDbOfflineRepository({
      uuid: () => generatedUuid(uuidIndex++),
      now: () => NOW,
      complete,
      emitImportedChanges: vi.fn(async () => '50'),
    });

    const result = await repository.importNota(
      connection,
      DEVICE_ID,
      OPERATION_ID,
      offlineNota(),
    );

    expect(result).toMatchObject({
      statusCode: 201,
      body: {
        serverRevision: '50',
        entityId: NOTA_ID,
        entity: { status: 'completed' },
      },
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(
      connection,
      DEVICE_ID,
      OPERATION_ID,
      NOTA_ID,
      'archive',
    );
    const lineInserts = queries.filter((query) =>
      query.sql.startsWith('INSERT INTO nota_lines'),
    );
    expect(lineInserts).toHaveLength(15);
    expect(lineInserts[0]?.params).toEqual(
      expect.arrayContaining([
        SKU_ID,
        'SKU-CAPTURED',
        'Nama tertangkap',
        2,
        25_000,
        50_000,
      ]),
    );
    expect(
      queries.some(
        (query) =>
          query.sql.startsWith('INSERT INTO audit_events') &&
          query.params?.includes('offline.nota.sku_archived_snapshot'),
      ),
    ).toBe(true);
  });

  it('accepts a deleted Nota SKU only as a null relation with an explicit snapshot warning', async () => {
    const lineParams: unknown[][] = [];
    const auditActions: unknown[] = [];
    const connection = {
      query: vi.fn(async <T>(sql: string, params?: unknown[]) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        if (compact.startsWith('INSERT INTO nota_daily_sequences')) {
          return { insertId: 1 } as T;
        }
        if (compact.includes('FROM skus')) return [] as T;
        if (compact.startsWith('INSERT INTO nota_lines')) {
          lineParams.push(params ?? []);
        }
        if (compact.startsWith('INSERT INTO audit_events')) {
          auditActions.push(params?.[2]);
        }
        return { insertId: 1 } as T;
      }),
    } as unknown as ProtocolConnection;
    let uuidIndex = 1;
    const repository = new MariaDbOfflineRepository({
      uuid: () => generatedUuid(uuidIndex++),
      now: () => NOW,
      complete: vi.fn(async () => ({
        statusCode: 200,
        body: { entity: { id: NOTA_ID } },
        audits: [],
        changes: [],
      })),
      emitImportedChanges: vi.fn(async () => '51'),
    });

    await repository.importNota(
      connection,
      DEVICE_ID,
      OPERATION_ID,
      offlineNota(),
    );

    expect(lineParams[0]?.slice(3, 5)).toEqual([null, null]);
    expect(auditActions).toContain('offline.nota.sku_missing_snapshot');
  });
});

describe('MariaDB offline stock repository', () => {
  it('applies one additive signed movement and accepts an archived captured SKU with warning', async () => {
    let revision = 60;
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const connection = {
      query: vi.fn(async <T>(sql: string, params?: unknown[]) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        queries.push({
          sql: compact,
          ...(params ? { params } : {}),
        });
        if (compact.includes('FROM skus')) {
          return [
            {
              id_hex: SKU_ID.replaceAll('-', ''),
              archived_at: NOW,
            },
          ] as T;
        }
        if (compact.includes('FROM stock_balances')) {
          return [{ quantity_pcs: '10', row_version: '3' }] as T;
        }
        if (compact.startsWith('INSERT INTO change_log')) {
          return { insertId: revision++ } as T;
        }
        return { affectedRows: 1 } as T;
      }),
    } as unknown as ProtocolConnection;
    const repository = new MariaDbOfflineRepository({
      uuid: () => '80000000-0000-4000-8000-000000000001',
      now: () => NOW,
    });

    const result = await repository.adjustStock(
      connection,
      DEVICE_ID,
      OPERATION_ID,
      {
        skuId: SKU_ID,
        skuIdentifier: 'SKU-CAPTURED',
        skuName: 'Nama tertangkap',
        referencePrice: 25_000,
        delta: -3,
        reason: 'Barang rusak',
      },
    );

    expect(result.body).toMatchObject({
      serverRevision: '61',
      entityVersion: '4',
      entity: {
        skuId: SKU_ID,
        quantityPcs: '7',
      },
    });
    expect(
      queries.find((query) =>
        query.sql.startsWith('UPDATE stock_balances'),
      )?.params,
    ).toEqual([-3, NOW, SKU_ID]);
    expect(
      queries.find((query) =>
        query.sql.startsWith('INSERT INTO stock_movements'),
      )?.params,
    ).toEqual([
      '80000000-0000-4000-8000-000000000001',
      SKU_ID,
      -3,
      'Barang rusak',
      DEVICE_ID,
      OPERATION_ID,
      4n,
      NOW,
    ]);
    expect(
      queries.some(
        (query) =>
          query.sql.startsWith('INSERT INTO audit_events') &&
          query.params?.includes('offline.stock.sku_archived_snapshot'),
      ),
    ).toBe(true);
  });

  it('retains a missing captured SKU as an actionable conflict/error', async () => {
    const connection = {
      query: vi.fn(async <T>(sql: string) =>
        (sql.includes('FROM skus') ? [] : { affectedRows: 1 }) as T),
    } as unknown as ProtocolConnection;
    const repository = new MariaDbOfflineRepository({
      now: () => NOW,
    });

    await expect(
      repository.adjustStock(
        connection,
        DEVICE_ID,
        OPERATION_ID,
        {
          skuId: SKU_ID,
          skuIdentifier: 'SKU-CAPTURED',
          skuName: 'Nama',
          referencePrice: 25_000,
          delta: 1,
          reason: 'Koreksi',
        },
      ),
    ).rejects.toMatchObject({
      code: 'SKU_MISSING',
      statusCode: 409,
    } satisfies Partial<CatalogueOperationError>);
  });
});
