import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { identifierHash } from '../src/catalogue/catalogue-writer.js';
import { MariaDbCatalogueRepository } from '../src/catalogue/mariadb-repository.js';
import type { CatalogueImportRecord } from '../src/catalogue/service.js';
import type { CatalogueWorkbook } from '../src/catalogue/workbook.js';
import { loadServerConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';

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
  loadServerConfig({
    CH_CORE_DATABASE_URL: databaseUrl,
    CH_CORE_DATABASE_SOCKET: process.env.CH_CORE_TEST_DATABASE_SOCKET,
  }),
);

function uuidHex(value: string): string {
  return value.replaceAll('-', '');
}

describe('live catalogue reconciliation against isolated chu_test', () => {
  beforeAll(async () => {
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('preserves live history and replays without duplicating stock effects', async () => {
    const suffix = randomUUID();
    const deviceId = randomUUID();
    const matchedSkuId = randomUUID();
    const unmatchedSkuId = randomUUID();
    const notaId = randomUUID();
    const originalMovementId = randomUUID();
    const importId = randomUUID();
    const workbookSha256 = randomBytes(32).toString('hex');
    const matchedPrimary = `MATCHED-${suffix}`;
    const matchedProduct = `PRODUCT-${suffix}`;
    const unmatchedPrimary = `UNMATCHED-${suffix}`;

    const initialRows = await pool.query<Array<{ sku_count: bigint }>>(
      'SELECT COUNT(*) AS sku_count FROM skus',
    );
    const initialSkuCount = Number(initialRows[0]?.sku_count ?? 0n);

    await pool.query(
      `INSERT INTO devices
         (id, role, installation_id, display_name, platform, token_hash,
          token_expires_at, approved_at)
       VALUES
         (UNHEX(?), 'owner', UNHEX(?), 'Catalogue reconciliation probe',
          'test', ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY),
          UTC_TIMESTAMP(6))`,
      [uuidHex(deviceId), uuidHex(randomUUID()), randomBytes(32)],
    );
    await pool.query(
      `INSERT INTO skus
         (id, primary_identifier, name, price_rupiah, source_note)
       VALUES
         (UNHEX(?), ?, 'Matched live SKU', 25000, 'live'),
         (UNHEX(?), ?, 'Unmatched live SKU', 18000, 'retain')`,
      [
        uuidHex(matchedSkuId),
        matchedPrimary,
        uuidHex(unmatchedSkuId),
        unmatchedPrimary,
      ],
    );
    await pool.query(
      `INSERT INTO sku_identifiers
         (id, sku_id, identifier_value, identifier_hash, identifier_kind)
       VALUES
         (UNHEX(?), UNHEX(?), ?, ?, 'primary'),
         (UNHEX(?), UNHEX(?), ?, ?, 'product_code'),
         (UNHEX(?), UNHEX(?), ?, ?, 'alias'),
         (UNHEX(?), UNHEX(?), ?, ?, 'primary')`,
      [
        uuidHex(randomUUID()),
        uuidHex(matchedSkuId),
        matchedPrimary,
        identifierHash(matchedPrimary),
        uuidHex(randomUUID()),
        uuidHex(matchedSkuId),
        matchedProduct,
        identifierHash(matchedProduct),
        uuidHex(randomUUID()),
        uuidHex(matchedSkuId),
        `LEGACY-${suffix}`,
        identifierHash(`LEGACY-${suffix}`),
        uuidHex(randomUUID()),
        uuidHex(unmatchedSkuId),
        unmatchedPrimary,
        identifierHash(unmatchedPrimary),
      ],
    );
    await pool.query(
      `INSERT INTO stock_balances (sku_id, quantity_pcs, row_version)
       VALUES (UNHEX(?), 7, 3), (UNHEX(?), 4, 1)`,
      [uuidHex(matchedSkuId), uuidHex(unmatchedSkuId)],
    );
    await pool.query(
      `INSERT INTO notas
         (id, nota_number, business_date, status, header_json,
          field_versions, created_by_device_id)
       VALUES
         (UNHEX(?), ?, '2026-08-08', 'draft', '{}', '{}', UNHEX(?))`,
      [uuidHex(notaId), `TEST-${suffix.slice(0, 30)}`, uuidHex(deviceId)],
    );
    await pool.query(
      `INSERT INTO price_history
         (id, sku_id, price_rupiah, source, changed_by_device_id)
       VALUES (UNHEX(?), UNHEX(?), 25000, 'manual_adjustment', UNHEX(?))`,
      [uuidHex(randomUUID()), uuidHex(matchedSkuId), uuidHex(deviceId)],
    );
    await pool.query(
      `INSERT INTO stock_movements
         (id, sku_id, delta_pcs, reason, device_id, operation_id,
          balance_row_version_after)
       VALUES
         (UNHEX(?), UNHEX(?), 2, 'manual_adjustment', UNHEX(?), UNHEX(?), 3)`,
      [
        uuidHex(originalMovementId),
        uuidHex(matchedSkuId),
        uuidHex(deviceId),
        uuidHex(randomUUID()),
      ],
    );

    const preview = {
      rowCount: 2,
      imageJobCount: 0,
      missingImageCount: 2,
      priceMismatchCount: 0,
      selectedPriceTotal: 47_000,
      stockTotal: 21,
      maximumCellTextLength: 32,
      warnings: [],
      priceMismatches: [],
    };
    const record: CatalogueImportRecord = {
      id: importId,
      workbookSha256,
      sourceFileName: 'catalogue-live-reconciliation.xlsx',
      stagedPath: `imports/staged/${workbookSha256}.xlsx`,
      status: 'staged',
      preview,
      createdByDeviceId: deviceId,
      createdAt: '2026-08-08T10:00:00.000Z',
      expiresAt: '2026-08-09T10:00:00.000Z',
      committedAt: null,
      result: null,
    };
    const workbook: CatalogueWorkbook = {
      preview,
      rows: [
        {
          rowNumber: 2,
          primarySku: matchedPrimary,
          productCode: matchedProduct,
          name: 'Matched workbook SKU',
          selectedPrice: 29_000,
          stockPcs: 12,
          note: 'reconciled',
          imageSourceUrl: null,
          sourceCreatedAt: '2026-08-08 18:00',
        },
        {
          rowNumber: 3,
          primarySku: `NEW-${suffix}`,
          productCode: `NEW-PRODUCT-${suffix}`,
          name: 'New workbook SKU',
          selectedPrice: 18_000,
          stockPcs: 9,
          note: 'created',
          imageSourceUrl: null,
          sourceCreatedAt: '2026-08-08 18:01',
        },
      ],
    };
    await pool.query(
      `INSERT INTO imports
         (id, workbook_sha256, source_file_name, status, staged_path,
          preview_json, created_by_device_id, created_at, expires_at)
       VALUES
         (UNHEX(?), UNHEX(?), ?, 'staged', ?, ?, UNHEX(?), ?, ?)`,
      [
        uuidHex(importId),
        workbookSha256,
        record.sourceFileName,
        record.stagedPath,
        JSON.stringify(preview),
        uuidHex(deviceId),
        new Date(record.createdAt),
        new Date(record.expiresAt),
      ],
    );

    const repository = new MariaDbCatalogueRepository(pool);
    const first = await repository.commit(
      record,
      workbook,
      new Date('2026-08-08T10:30:00.000Z'),
    );
    expect(first).toMatchObject({
      matchedExistingCount: 1,
      createdSkuCount: 1,
      untouchedExistingCount: initialSkuCount + 1,
      stockAdjustedCount: 1,
      zeroDeltaMatchedCount: 0,
      replayed: false,
    });

    const evidenceQuery = () =>
      pool.query<
        Array<{
          matched_quantity: bigint;
          reconciliation_movements: bigint;
          nota_count: bigint;
          manual_price_count: bigint;
          original_movement_count: bigint;
          unmatched_active_count: bigint;
          legacy_identifier_count: bigint;
          created_sku_count: bigint;
        }>
      >(
        `SELECT
           (SELECT quantity_pcs FROM stock_balances
            WHERE sku_id = UNHEX(?)) AS matched_quantity,
           (SELECT COUNT(*) FROM stock_movements
            WHERE sku_id = UNHEX(?)
              AND reason = 'catalogue_reconciliation'
              AND operation_id = UNHEX(?)) AS reconciliation_movements,
           (SELECT COUNT(*) FROM notas WHERE id = UNHEX(?)) AS nota_count,
           (SELECT COUNT(*) FROM price_history
            WHERE sku_id = UNHEX(?) AND source = 'manual_adjustment')
             AS manual_price_count,
           (SELECT COUNT(*) FROM stock_movements WHERE id = UNHEX(?))
             AS original_movement_count,
           (SELECT COUNT(*) FROM skus
            WHERE id = UNHEX(?) AND archived_at IS NULL)
             AS unmatched_active_count,
           (SELECT COUNT(*) FROM sku_identifiers
            WHERE sku_id = UNHEX(?) AND identifier_kind = 'alias')
             AS legacy_identifier_count,
           (SELECT COUNT(*) FROM skus WHERE source_import_id = UNHEX(?))
             AS created_sku_count`,
        [
          uuidHex(matchedSkuId),
          uuidHex(matchedSkuId),
          uuidHex(importId),
          uuidHex(notaId),
          uuidHex(matchedSkuId),
          uuidHex(originalMovementId),
          uuidHex(unmatchedSkuId),
          uuidHex(matchedSkuId),
          uuidHex(importId),
        ],
      );

    const afterFirst = await evidenceQuery();
    expect(afterFirst[0]).toMatchObject({
      matched_quantity: 12n,
      reconciliation_movements: 1n,
      nota_count: 1n,
      manual_price_count: 1n,
      original_movement_count: 1n,
      unmatched_active_count: 1n,
      legacy_identifier_count: 1n,
      created_sku_count: 2n,
    });

    const replay = await repository.commit(
      record,
      workbook,
      new Date('2026-08-08T10:31:00.000Z'),
    );
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await evidenceQuery()).toEqual(afterFirst);
  });
});
