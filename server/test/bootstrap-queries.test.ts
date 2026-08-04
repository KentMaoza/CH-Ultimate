import { describe, expect, it } from 'vitest';

import { readBootstrapCollections } from '../src/sync/mariadb-bootstrap-queries.js';
import type { ProtocolConnection } from '../src/sync/idempotency.js';

describe('readBootstrapCollections', () => {
  it('serializes reads on the single consistent-snapshot connection', async () => {
    let activeQueries = 0;
    let maximumConcurrentQueries = 0;
    const connection: ProtocolConnection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
      query: async <T>(): Promise<T> => {
        activeQueries += 1;
        maximumConcurrentQueries = Math.max(
          maximumConcurrentQueries,
          activeQueries,
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        activeQueries -= 1;
        return [] as T;
      },
    };

    await expect(readBootstrapCollections(connection)).resolves.toEqual({
      skuIdentifiers: [],
      skus: [],
      balances: [],
      stockChecks: [],
      priceHistory: [],
      stockMovements: [],
      notas: [],
      notaPages: [],
      notaLines: [],
      notaPostings: [],
      revenuePostings: [],
      templates: [],
    });
    expect(maximumConcurrentQueries).toBe(1);
  });

  it('normalizes driver DATE values and preserves completion destination', async () => {
    const idHex = '11111111111141118111111111111111';
    const deviceHex = '22222222222242228222222222222222';
    const postingHex = '33333333333343338333333333333333';
    const revenueHex = '44444444444444448444444444444444';
    const timestamp = new Date('2026-07-30T01:02:03.000Z');
    const connection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
      query: async <T>(sql: string): Promise<T> => {
        if (sql.includes('FROM notas')) {
          return [{
            id_hex: idHex,
            nota_number: 'CHU-20260730-0001',
            business_date: new Date('2026-07-30T00:00:00.000Z'),
            status: 'completed',
            completion_destination: 'finished',
            header_json: '{}',
            field_versions: '{}',
            structure_version: 1n,
            lifecycle_version: 2n,
            subtotal_rupiah: 1000n,
            total_rupiah: 1000n,
            created_by_device_id_hex: deviceHex,
            completed_at: timestamp,
            cancelled_at: null,
            created_at: timestamp,
            updated_at: timestamp,
          }] as T;
        }
        if (sql.includes('FROM nota_postings')) {
          return [{
            id_hex: postingHex,
            nota_id_hex: idHex,
            posting_kind: 'complete',
            amount_rupiah: 1000n,
            snapshot_json: JSON.stringify({
              lines: [],
              stockEffects: {},
              trackedLineIds: {},
            }),
            lifecycle_version: 2n,
            reverses_posting_id_hex: null,
            posted_at: timestamp,
          }] as T;
        }
        if (sql.includes('FROM revenue_postings')) {
          return [{
            id_hex: revenueHex,
            nota_id_hex: idHex,
            nota_posting_id_hex: postingHex,
            amount_rupiah: 1000n,
            posting_kind: 'complete',
            posted_at: timestamp,
          }] as T;
        }
        return [] as T;
      },
    } satisfies ProtocolConnection;

    const collections = await readBootstrapCollections(connection);

    expect(collections.notas).toEqual([
      expect.objectContaining({
        businessDate: '2026-07-30',
        completionDestination: 'finished',
      }),
    ]);
    expect(collections.notaPostings).toEqual([
      expect.objectContaining({
        notaId: '11111111-1111-4111-8111-111111111111',
        amountRupiah: 1000n,
        snapshot: { lines: [], stockEffects: {}, trackedLineIds: {} },
      }),
    ]);
    expect(collections.revenuePostings).toEqual([
      expect.objectContaining({
        notaPostingId: '33333333-3333-4333-8333-333333333333',
        amountRupiah: 1000n,
      }),
    ]);
  });

  it('reads last-check balance metadata and complete stock-check audit rows', async () => {
    const skuHex = '11111111111141118111111111111111';
    const checkHex = '22222222222242228222222222222222';
    const deviceHex = '33333333333343338333333333333333';
    const timestamp = new Date('2026-08-04T01:02:03.000Z');
    const connection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
      query: async <T>(sql: string): Promise<T> => {
        if (sql.includes('FROM stock_balances')) {
          return [{
            sku_id_hex: skuHex,
            quantity_pcs: 8n,
            row_version: 5n,
            last_checked_at: timestamp,
            updated_at: timestamp,
          }] as T;
        }
        if (sql.includes('FROM stock_checks')) {
          return [{
            id_hex: checkHex,
            sku_id_hex: skuHex,
            observed_quantity_pcs: 10n,
            counted_quantity_pcs: 8n,
            server_quantity_before_pcs: 7n,
            applied_delta_pcs: 1n,
            base_balance_version: 3n,
            forced_offline: 1,
            counted_at: timestamp,
            applied_at: timestamp,
            device_id_hex: deviceHex,
            device_display_name: 'HP Gudang',
            note: 'Rak utara',
          }] as T;
        }
        return [] as T;
      },
    } satisfies ProtocolConnection;

    const collections = await readBootstrapCollections(connection);

    expect(collections.balances).toEqual([
      expect.objectContaining({ rowVersion: 5n, lastCheckedAt: timestamp }),
    ]);
    expect(collections.stockChecks).toEqual([
      {
        id: '22222222-2222-4222-8222-222222222222',
        skuId: '11111111-1111-4111-8111-111111111111',
        observedQuantityPcs: 10n,
        countedQuantityPcs: 8n,
        serverQuantityBeforePcs: 7n,
        appliedDeltaPcs: 1n,
        baseBalanceVersion: 3n,
        forcedOffline: true,
        countedAt: timestamp,
        appliedAt: timestamp,
        deviceId: '33333333-3333-4333-8333-333333333333',
        deviceDisplayName: 'HP Gudang',
        note: 'Rak utara',
      },
    ]);
  });
});
