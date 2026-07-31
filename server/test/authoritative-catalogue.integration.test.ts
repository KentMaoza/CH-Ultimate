import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { identifierHash } from '../src/catalogue/catalogue-writer.js';
import { FileCatalogueStorage } from '../src/catalogue/file-storage.js';
import { MariaDbSkuImageOperationsRepository } from '../src/catalogue/mariadb-sku-image-operations-repository.js';
import { MariaDbSkuOperationsRepository } from '../src/catalogue/mariadb-sku-operations-repository.js';
import { MariaDbStockOperationsRepository } from '../src/catalogue/mariadb-stock-operations-repository.js';
import { loadServerConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { executeIdempotent } from '../src/sync/idempotency.js';

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
const temporaryRoots: string[] = [];

function uuidHex(value: string): string {
  return value.replaceAll('-', '');
}

async function insertDevice(deviceId: string): Promise<void> {
  await pool.query(
    `INSERT INTO devices
       (id, role, installation_id, display_name, platform, token_hash,
        token_expires_at, approved_at)
     VALUES
       (UNHEX(?), 'owner', UNHEX(?), 'Catalogue probe', 'test', ?,
        DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY), UTC_TIMESTAMP(6))`,
    [uuidHex(deviceId), uuidHex(randomUUID()), randomBytes(32)],
  );
}

async function insertTrackedSku(
  skuId: string,
  identifier: string,
  quantity: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO skus
       (id, primary_identifier, name, price_rupiah, source_note)
     VALUES (UNHEX(?), ?, 'Integration SKU', 25000, '')`,
    [uuidHex(skuId), identifier],
  );
  await pool.query(
    `INSERT INTO sku_identifiers
       (id, sku_id, identifier_value, identifier_hash, identifier_kind)
     VALUES
       (UNHEX(?), UNHEX(?), ?, ?, 'primary')`,
    [uuidHex(randomUUID()), uuidHex(skuId), identifier, identifierHash(identifier)],
  );
  await pool.query(
    `INSERT INTO stock_balances (sku_id, quantity_pcs, row_version)
     VALUES (UNHEX(?), ?, 1)`,
    [uuidHex(skuId), quantity],
  );
}

describe('authoritative catalogue operations against isolated chu_test', () => {
  beforeAll(async () => {
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
    );
  });

  it('preserves both concurrent signed stock deltas', async () => {
    const deviceId = randomUUID();
    const skuId = randomUUID();
    await insertDevice(deviceId);
    await insertTrackedSku(skuId, `CONCURRENT-${skuId}`, 10);
    const repository = new MariaDbStockOperationsRepository();
    const adjust = (delta: number) => {
      const operationId = randomUUID();
      return executeIdempotent(
        pool,
        {
          deviceId,
          idempotencyKey: operationId,
          payload: { skuId, delta },
        },
        (connection) =>
          repository.adjust(
            connection,
            deviceId,
            operationId,
            skuId,
            { delta },
          ),
      );
    };

    await Promise.all([adjust(5), adjust(-2)]);

    const rows = await pool.query<
      Array<{
        quantity_pcs: bigint;
        row_version: bigint;
        movement_count: bigint;
      }>
    >(
      `SELECT quantity_pcs, row_version,
         (SELECT COUNT(*) FROM stock_movements
          WHERE sku_id = UNHEX(?)) AS movement_count
       FROM stock_balances
       WHERE sku_id = UNHEX(?)`,
      [uuidHex(skuId), uuidHex(skuId)],
    );
    expect(rows[0]).toMatchObject({
      quantity_pcs: 13n,
      row_version: 3n,
      movement_count: 2n,
    });
  });

  it('replays a lost response without duplicating movement or balance', async () => {
    const deviceId = randomUUID();
    const skuId = randomUUID();
    const operationId = randomUUID();
    await insertDevice(deviceId);
    await insertTrackedSku(skuId, `REPLAY-${skuId}`, 4);
    const repository = new MariaDbStockOperationsRepository();
    let callbackCalls = 0;
    const execute = () =>
      executeIdempotent(
        pool,
        {
          deviceId,
          idempotencyKey: operationId,
          payload: { skuId, delta: 7 },
        },
        (connection) => {
          callbackCalls += 1;
          return repository.adjust(
            connection,
            deviceId,
            operationId,
            skuId,
            { delta: 7 },
          );
        },
      );

    const first = await execute();
    const replay = await execute();
    const rows = await pool.query<
      Array<{
        quantity_pcs: bigint;
        row_version: bigint;
        movement_count: bigint;
        receipt_count: bigint;
      }>
    >(
      `SELECT quantity_pcs, row_version,
         (SELECT COUNT(*) FROM stock_movements
          WHERE sku_id = UNHEX(?)) AS movement_count,
         (SELECT COUNT(*) FROM idempotency_receipts
          WHERE device_id = UNHEX(?) AND idempotency_key = ?)
           AS receipt_count
       FROM stock_balances
       WHERE sku_id = UNHEX(?)`,
      [uuidHex(skuId), uuidHex(deviceId), operationId, uuidHex(skuId)],
    );

    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(callbackCalls).toBe(1);
    expect(rows[0]).toMatchObject({
      quantity_pcs: 11n,
      row_version: 2n,
      movement_count: 1n,
      receipt_count: 1n,
    });
  });

  it('replays a lost SKU image response without duplicating its transaction', async () => {
    const deviceId = randomUUID();
    const skuId = randomUUID();
    const operationId = randomUUID();
    await insertDevice(deviceId);
    await insertTrackedSku(skuId, `IMAGE-${skuId}`, 0);
    const root = await mkdtemp(join(tmpdir(), 'chu-image-integration-'));
    temporaryRoots.push(root);
    const repository = new MariaDbSkuImageOperationsRepository(
      new FileCatalogueStorage(root),
    );
    const bytes = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
    bytes.write('IHDR', 12, 'ascii');
    bytes.writeUInt32BE(32, 16);
    bytes.writeUInt32BE(24, 20);
    const hash = createHash('sha256').update(bytes).digest('hex');
    let callbackCalls = 0;
    const execute = () =>
      executeIdempotent(
        pool,
        {
          deviceId,
          idempotencyKey: operationId,
          payload: {
            action: 'sku.image.replace',
            skuId,
            rowVersion: '1',
            bytesBase64: bytes.toString('base64'),
          },
        },
        (connection) => {
          callbackCalls += 1;
          return repository.replace(connection, deviceId, skuId, {
            rowVersion: '1',
            base: { imageHash: null, sourceImageUrl: null },
            bytes,
            mimeType: 'image/png',
            width: 32,
            height: 24,
          });
        },
      );

    const first = await execute();
    const replay = await execute();
    const rows = await pool.query<
      Array<{
        row_version: bigint;
        image_hash: string;
        asset_count: bigint;
        audit_count: bigint;
        receipt_count: bigint;
      }>
    >(
      `SELECT row_version, LOWER(HEX(image_hash)) AS image_hash,
         (SELECT COUNT(*) FROM image_assets
          WHERE content_hash = UNHEX(?)) AS asset_count,
         (SELECT COUNT(*) FROM audit_events
          WHERE device_id = UNHEX(?) AND action = 'sku.image.replace'
            AND entity_id = UNHEX(?)) AS audit_count,
         (SELECT COUNT(*) FROM idempotency_receipts
          WHERE device_id = UNHEX(?) AND idempotency_key = ?)
           AS receipt_count
       FROM skus
       WHERE id = UNHEX(?)`,
      [
        hash,
        uuidHex(deviceId),
        uuidHex(skuId),
        uuidHex(deviceId),
        operationId,
        uuidHex(skuId),
      ],
    );

    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(callbackCalls).toBe(1);
    expect(rows[0]).toMatchObject({
      row_version: 2n,
      image_hash: hash,
      asset_count: 1n,
      audit_count: 1n,
      receipt_count: 1n,
    });
  });

  it('rolls back an attempted rename to another SKU identifier', async () => {
    const deviceId = randomUUID();
    const firstSkuId = randomUUID();
    const secondSkuId = randomUUID();
    const operationId = randomUUID();
    const firstIdentifier = `OWNER-${firstSkuId}`;
    const secondIdentifier = `OTHER-${secondSkuId}`;
    await insertDevice(deviceId);
    await insertTrackedSku(firstSkuId, firstIdentifier, 0);
    await insertTrackedSku(secondSkuId, secondIdentifier, 0);
    const repository = new MariaDbSkuOperationsRepository();

    await expect(
      executeIdempotent(
        pool,
        {
          deviceId,
          idempotencyKey: operationId,
          payload: {
            skuId: secondSkuId,
            skuNumber: ` ${firstIdentifier} `,
          },
        },
        (connection) =>
          repository.update(connection, deviceId, secondSkuId, {
            rowVersion: '1',
            base: { skuNumber: secondIdentifier },
            patch: { skuNumber: ` ${firstIdentifier} ` },
          }),
      ),
    ).rejects.toMatchObject({
      code: 'IDENTIFIER_CONFLICT',
      statusCode: 409,
    });

    const rows = await pool.query<
      Array<{
        primary_identifier: string;
        row_version: bigint;
        own_identifier_count: bigint;
        receipt_count: bigint;
      }>
    >(
      `SELECT primary_identifier, row_version,
         (SELECT COUNT(*) FROM sku_identifiers
          WHERE sku_id = UNHEX(?)) AS own_identifier_count,
         (SELECT COUNT(*) FROM idempotency_receipts
          WHERE device_id = UNHEX(?) AND idempotency_key = ?)
           AS receipt_count
       FROM skus
       WHERE id = UNHEX(?)`,
      [
        uuidHex(secondSkuId),
        uuidHex(deviceId),
        operationId,
        uuidHex(secondSkuId),
      ],
    );
    expect(rows[0]).toMatchObject({
      primary_identifier: secondIdentifier,
      row_version: 1n,
      own_identifier_count: 1n,
      receipt_count: 0n,
    });
  });
});
