import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadServerConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { executeIdempotent } from '../src/sync/idempotency.js';
import { MariaDbSyncStore } from '../src/sync/mariadb-sync-store.js';

const databaseUrl = process.env.CH_CORE_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'CH_CORE_TEST_DATABASE_URL must point to an explicitly isolated chu_test database',
  );
}
if (new URL(databaseUrl).pathname !== '/chu_test') {
  throw new Error('Integration tests refuse any database except chu_test');
}

const pool = createPool(
  loadServerConfig({ CH_CORE_DATABASE_URL: databaseUrl }),
);

function uuidHex(value: string): string {
  return value.replaceAll('-', '');
}

async function insertDevice(deviceId: string, installationId: string) {
  await pool.query(
    `INSERT INTO devices
       (id, role, installation_id, display_name, platform, token_hash,
        token_expires_at, approved_at)
     VALUES
       (UNHEX(?), 'owner', UNHEX(?), 'Protocol probe', 'test', ?,
        DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY), UTC_TIMESTAMP(6))`,
    [uuidHex(deviceId), uuidHex(installationId), randomBytes(32)],
  );
}

async function insertSku(skuId: string, identifier: string) {
  await pool.query(
    `INSERT INTO skus
       (id, primary_identifier, name, price_rupiah)
     VALUES (UNHEX(?), ?, 'Protocol SKU', 25000)`,
    [uuidHex(skuId), identifier],
  );
}

describe('identity and sync protocol against isolated chu_test', () => {
  beforeAll(async () => {
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('commits business, audit, change, and receipt rows on one real transaction', async () => {
    const deviceId = randomUUID();
    const installationId = randomUUID();
    const skuId = randomUUID();
    const idempotencyKey = randomUUID();
    await insertDevice(deviceId, installationId);

    await executeIdempotent(
      pool,
      {
        deviceId,
        idempotencyKey,
        payload: { skuId, priceRupiah: '25000' },
        receiptExpiresAt: new Date('2027-07-29T00:00:00.000Z'),
      },
      async (connection) => {
        await connection.query(
          `INSERT INTO skus
             (id, primary_identifier, name, price_rupiah)
           VALUES (UNHEX(?), ?, 'Atomic SKU', 25000)`,
          [uuidHex(skuId), `ATOMIC-${skuId}`],
        );
        return {
          statusCode: 201,
          body: { id: skuId },
          audits: [
            {
              action: 'sku.create',
              entityType: 'sku',
              entityId: skuId,
              detail: { priceRupiah: '25000' },
            },
          ],
          changes: [
            {
              entityType: 'sku',
              entityId: skuId,
              operation: 'upsert',
              payload: { id: skuId, priceRupiah: '25000' },
            },
          ],
        };
      },
    );

    const rows = await pool.query<
      Array<{
        sku_count: bigint;
        audit_count: bigint;
        change_count: bigint;
        receipt_count: bigint;
      }>
    >(
      `SELECT
         (SELECT COUNT(*) FROM skus WHERE id = UNHEX(?)) AS sku_count,
         (SELECT COUNT(*) FROM audit_events WHERE entity_id = UNHEX(?))
           AS audit_count,
         (SELECT COUNT(*) FROM change_log WHERE entity_id = UNHEX(?))
           AS change_count,
         (SELECT COUNT(*) FROM idempotency_receipts
          WHERE device_id = UNHEX(?) AND idempotency_key = ?)
           AS receipt_count`,
      [
        uuidHex(skuId),
        uuidHex(skuId),
        uuidHex(skuId),
        uuidHex(deviceId),
        idempotencyKey,
      ],
    );

    expect(rows[0]).toMatchObject({
      sku_count: 1n,
      audit_count: 1n,
      change_count: 1n,
      receipt_count: 1n,
    });
  });

  it('rolls back a real business write when the idempotent callback fails', async () => {
    const deviceId = randomUUID();
    const skuId = randomUUID();
    const idempotencyKey = randomUUID();
    await insertDevice(deviceId, randomUUID());

    await expect(
      executeIdempotent(
        pool,
        {
          deviceId,
          idempotencyKey,
          payload: { skuId },
          receiptExpiresAt: new Date('2027-07-29T00:00:00.000Z'),
        },
        async (connection) => {
          await connection.query(
            `INSERT INTO skus
               (id, primary_identifier, name, price_rupiah)
             VALUES (UNHEX(?), ?, 'Rollback SKU', 25000)`,
            [uuidHex(skuId), `ROLLBACK-${skuId}`],
          );
          throw new Error('deliberate callback failure');
        },
      ),
    ).rejects.toThrow('deliberate callback failure');

    const rows = await pool.query<
      Array<{ sku_count: bigint; receipt_count: bigint }>
    >(
      `SELECT
         (SELECT COUNT(*) FROM skus WHERE id = UNHEX(?)) AS sku_count,
         (SELECT COUNT(*) FROM idempotency_receipts
          WHERE device_id = UNHEX(?) AND idempotency_key = ?)
           AS receipt_count`,
      [uuidHex(skuId), uuidHex(deviceId), idempotencyKey],
    );
    expect(rows[0]).toMatchObject({
      sku_count: 0n,
      receipt_count: 0n,
    });
  });

  it('keeps bootstrap rows aligned with the real snapshot watermark', async () => {
    const baseSkuId = randomUUID();
    const concurrentSkuId = randomUUID();
    await insertSku(baseSkuId, `SNAPSHOT-BASE-${baseSkuId}`);
    const inserted = await pool.query<{ insertId: bigint }>(
      `INSERT INTO change_log
         (entity_type, entity_id, operation, payload_json)
       VALUES ('sku', UNHEX(?), 'upsert', JSON_OBJECT('id', ?))`,
      [uuidHex(baseSkuId), baseSkuId],
    );
    const expectedWatermark = BigInt(inserted.insertId);
    const store = new MariaDbSyncStore(pool);

    const snapshot = await store.readConsistent(async (session) => {
      const watermark = await session.getWatermark();
      await insertSku(
        concurrentSkuId,
        `SNAPSHOT-CONCURRENT-${concurrentSkuId}`,
      );
      await pool.query(
        `INSERT INTO change_log
           (entity_type, entity_id, operation, payload_json)
         VALUES ('sku', UNHEX(?), 'upsert', JSON_OBJECT('id', ?))`,
        [uuidHex(concurrentSkuId), concurrentSkuId],
      );
      return {
        watermark,
        collections: await session.getBootstrapCollections(),
      };
    });

    expect(snapshot.watermark).toBe(expectedWatermark);
    expect(snapshot.collections.skus).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: baseSkuId })]),
    );
    expect(snapshot.collections.skus).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: concurrentSkuId }),
      ]),
    );
  });
});
