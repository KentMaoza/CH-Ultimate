import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mariadb, { type Pool } from 'mariadb';

import { runMigrations } from '../src/db/migrate.js';
import { NotaOperationsService } from '../src/nota/service.js';
import type { ProtocolPool } from '../src/sync/idempotency.js';

const databaseUrl = process.env.CH_CORE_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('Nota lifecycle against isolated chu_test MariaDB', () => {
  let pool: Pool;

  beforeAll(async () => {
    const parsed = new URL(databaseUrl!);
    if (parsed.pathname !== '/chu_test') {
      throw new Error('CH_CORE_TEST_DATABASE_URL must target the isolated chu_test schema');
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

  it('provides durable Nota conflict, posting, and revenue tables', async () => {
    const rows = await pool.query<Array<{ table_name: string }>>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name IN
           ('nota_daily_sequences', 'nota_conflicts', 'nota_postings',
            'revenue_postings')
       ORDER BY table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      'nota_conflicts',
      'nota_daily_sequences',
      'nota_postings',
      'revenue_postings',
    ]);
  });

  it('posts, recompletes by delta, reverses, restores, and replays exactly once', async () => {
    const deviceId = randomUUID();
    const skuId = randomUUID();
    await pool.query(
      `INSERT INTO devices
         (id, role, installation_id, display_name, platform, token_hash,
          token_expires_at, approved_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), 'client',
          UNHEX(REPLACE(?, '-', '')), 'Nota integration', 'test',
          UNHEX(SHA2(?, 256)), DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY),
          UTC_TIMESTAMP(6))`,
      [deviceId, randomUUID(), randomUUID()],
    );
    await pool.query(
      `INSERT INTO skus
         (id, primary_identifier, name, price_rupiah)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), 'NOTA-INTEGRATION',
          'Nota integration SKU', 10000)`,
      [skuId],
    );
    await pool.query(
      `INSERT INTO stock_balances (sku_id, quantity_pcs, row_version)
       VALUES (UNHEX(REPLACE(?, '-', '')), 100, 1)`,
      [skuId],
    );

    const service = new NotaOperationsService(pool as unknown as ProtocolPool);
    const context = () => ({ deviceId, idempotencyKey: randomUUID() });
    const created = await service.create(context(), {}) as {
      entity: {
        id: string;
        pages: Array<{ id: string; lines: Array<{ id: string }> }>;
      };
    };
    const notaId = created.entity.id;
    const pageId = created.entity.pages[0]!.id;
    const lineId = created.entity.pages[0]!.lines[0]!.id;
    const firstLine = {
      linePosition: 0,
      skuId,
      description: 'Nota integration SKU',
      kind: 'test',
      quantity: 2,
      unit: 'pcs' as const,
      pcsPrice: 10_000,
      lsnPrice: 120_000,
    };
    await service.updateLine(context(), notaId, pageId, lineId, {
      pageVersion: '1',
      lineVersion: '1',
      base: {
        linePosition: 0,
        skuId: null,
        description: '',
        kind: '',
        quantity: 0,
        unit: 'pcs',
        pcsPrice: 0,
        lsnPrice: 0,
      },
      mine: firstLine,
    });

    const completionContext = context();
    await service.complete(completionContext, notaId, {
      lifecycleVersion: '1',
      destination: 'archive',
    });
    await service.reopen(context(), notaId, { lifecycleVersion: '2' });
    await service.updateLine(context(), notaId, pageId, lineId, {
      pageVersion: '1',
      lineVersion: '2',
      base: firstLine,
      mine: { ...firstLine, quantity: 3 },
    });
    await service.complete(context(), notaId, {
      lifecycleVersion: '3',
      destination: 'archive',
    });
    await service.cancel(context(), notaId, { lifecycleVersion: '4' });
    await service.restore(context(), notaId, { lifecycleVersion: '5' });
    await service.complete(completionContext, notaId, {
      lifecycleVersion: '1',
      destination: 'archive',
    });

    const rows = await pool.query<Array<Record<string, unknown>>>(
      `SELECT
         (SELECT quantity_pcs FROM stock_balances
          WHERE sku_id = UNHEX(REPLACE(?, '-', ''))) AS quantity_pcs,
         (SELECT COALESCE(SUM(amount_rupiah), 0) FROM revenue_postings
          WHERE nota_id = UNHEX(REPLACE(?, '-', ''))) AS revenue_rupiah,
         (SELECT COUNT(*) FROM nota_postings
          WHERE nota_id = UNHEX(REPLACE(?, '-', ''))) AS posting_count,
         (SELECT COUNT(*) FROM stock_movements
          WHERE nota_posting_id IN (
            SELECT id FROM nota_postings
            WHERE nota_id = UNHEX(REPLACE(?, '-', ''))
          )) AS movement_count`,
      [skuId, notaId, notaId, notaId],
    );
    expect(String(rows[0]!.quantity_pcs)).toBe('97');
    expect(String(rows[0]!.revenue_rupiah)).toBe('30000');
    expect(Number(rows[0]!.posting_count)).toBe(4);
    expect(Number(rows[0]!.movement_count)).toBe(4);
  });
});
