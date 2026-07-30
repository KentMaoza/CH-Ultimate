import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mariadb, { type Pool } from 'mariadb';

import { runMigrations } from '../src/db/migrate.js';
import { OfflineOperationsService } from '../src/offline/service.js';
import type { OfflineNotaRequest } from '../src/offline/validation.js';
import type { ProtocolPool } from '../src/sync/idempotency.js';

const databaseUrl = process.env.CH_CORE_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('offline operations against exact isolated chu_test', () => {
  let pool: Pool;

  beforeAll(async () => {
    const parsed = new URL(databaseUrl!);
    if (parsed.pathname !== '/chu_test') {
      throw new Error(
        'CH_CORE_TEST_DATABASE_URL must target the exact isolated chu_test schema',
      );
    }
    pool = mariadb.createPool({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: 'chu_test',
      connectionLimit: 2,
    });
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('replays completed archived-SKU Nota and stock delta without duplicate posting', async () => {
    const deviceId = randomUUID();
    const skuId = randomUUID();
    await pool.query(
      `INSERT INTO devices
         (id, role, installation_id, display_name, platform, token_hash,
          token_expires_at, approved_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), 'client',
          UNHEX(REPLACE(?, '-', '')), 'Offline integration', 'test', ?,
          DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY), UTC_TIMESTAMP(6))`,
      [deviceId, randomUUID(), randomBytes(32)],
    );
    await pool.query(
      `INSERT INTO skus
         (id, primary_identifier, name, price_rupiah, archived_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), ?, 'Archived integration SKU',
          25000, UTC_TIMESTAMP(6))`,
      [skuId, `OFFLINE-${skuId}`],
    );
    await pool.query(
      `INSERT INTO stock_balances (sku_id, quantity_pcs, row_version)
       VALUES (UNHEX(REPLACE(?, '-', '')), 100, 1)`,
      [skuId],
    );
    const service = new OfflineOperationsService(
      pool as unknown as ProtocolPool,
    );
    const provisionalId = randomUUID();
    const notaOperationId = randomUUID();
    const pageId = randomUUID();
    const lineId = randomUUID();
    const input: OfflineNotaRequest = {
      provisionalId,
      completed: true,
      destination: 'archive',
      skuSnapshots: [
        {
          skuId,
          identifier: `OFFLINE-${skuId}`,
          name: 'Archived integration SKU',
          referencePrice: 25_000,
        },
      ],
      snapshot: {
        id: provisionalId,
        baseNumber: `OFFLINE-${provisionalId.slice(0, 8)}`,
        customerName: 'Toko integration',
        customerPlace: 'Samarinda',
        transactionDate: '2026-07-30',
        payment: 'cash',
        status: 'completed',
        completionDestination: 'archive',
        completedAt: new Date().toISOString(),
        nextNoteIndex: 1,
        pages: [
          {
            id: pageId,
            suffix: 'A',
            status: 'active',
            lines: [
              {
                id: lineId,
                skuId,
                description: 'Archived integration SKU',
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
    const context = {
      deviceId,
      idempotencyKey: notaOperationId,
    };

    const first = await service.importNota(context, input);
    const replay = await service.importNota(context, input);

    expect(replay).toEqual(first);
    const stockOperationId = randomUUID();
    const stockContext = {
      deviceId,
      idempotencyKey: stockOperationId,
    };
    const stockInput = {
      skuId,
      skuIdentifier: `OFFLINE-${skuId}`,
      skuName: 'Archived integration SKU',
      referencePrice: 25_000,
      delta: 5,
      reason: 'Koreksi integration',
    };
    const stockFirst = await service.adjustStock(stockContext, stockInput);
    const stockReplay = await service.adjustStock(stockContext, stockInput);
    expect(stockReplay).toEqual(stockFirst);

    const rows = await pool.query<
      Array<{
        quantity_pcs: bigint;
        nota_count: bigint;
        posting_count: bigint;
        revenue_rupiah: bigint;
        movement_count: bigint;
        warning_count: bigint;
      }>
    >(
      `SELECT
         (SELECT quantity_pcs FROM stock_balances
          WHERE sku_id = UNHEX(REPLACE(?, '-', ''))) AS quantity_pcs,
         (SELECT COUNT(*) FROM notas
          WHERE created_by_device_id = UNHEX(REPLACE(?, '-', '')))
            AS nota_count,
         (SELECT COUNT(*) FROM nota_postings
          WHERE nota_id = UNHEX(REPLACE(?, '-', ''))) AS posting_count,
         (SELECT COALESCE(SUM(amount_rupiah), 0) FROM revenue_postings
          WHERE nota_id = UNHEX(REPLACE(?, '-', ''))) AS revenue_rupiah,
         (SELECT COUNT(*) FROM stock_movements
          WHERE sku_id = UNHEX(REPLACE(?, '-', ''))) AS movement_count,
         (SELECT COUNT(*) FROM audit_events
          WHERE device_id = UNHEX(REPLACE(?, '-', ''))
            AND action IN
              ('offline.nota.sku_archived_snapshot',
               'offline.stock.sku_archived_snapshot')) AS warning_count`,
      [skuId, deviceId, (first as { entityId: string }).entityId,
        (first as { entityId: string }).entityId, skuId, deviceId],
    );
    expect(rows[0]).toMatchObject({
      quantity_pcs: 103n,
      nota_count: 1n,
      posting_count: 1n,
      revenue_rupiah: 50_000n,
      movement_count: 2n,
      warning_count: 2n,
    });
  });

  it('keeps a deleted offline stock SKU as a retained actionable error', async () => {
    const deviceId = randomUUID();
    await pool.query(
      `INSERT INTO devices
         (id, role, installation_id, display_name, platform, token_hash,
          token_expires_at, approved_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), 'client',
          UNHEX(REPLACE(?, '-', '')), 'Missing SKU integration', 'test', ?,
          DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY), UTC_TIMESTAMP(6))`,
      [deviceId, randomUUID(), randomBytes(32)],
    );
    const service = new OfflineOperationsService(
      pool as unknown as ProtocolPool,
    );

    await expect(
      service.adjustStock(
        { deviceId, idempotencyKey: randomUUID() },
        {
          skuId: randomUUID(),
          skuIdentifier: 'DELETED',
          skuName: 'Deleted SKU',
          referencePrice: 1,
          delta: 1,
          reason: 'Koreksi',
        },
      ),
    ).rejects.toMatchObject({
      code: 'SKU_MISSING',
      statusCode: 409,
    });
  });
});
