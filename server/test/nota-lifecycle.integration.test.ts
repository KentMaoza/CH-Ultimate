import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mariadb, { type Pool } from 'mariadb';

import { runMigrations } from '../src/db/migrate.js';
import {
  NotaConflictError,
  NotaOperationsService,
} from '../src/nota/service.js';
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
      lifecycleVersion: '1',
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
    const lineSnapshot = await pool.query<Array<{ sku_identifier_snapshot: string }>>(
      `SELECT sku_identifier_snapshot
       FROM nota_lines
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [lineId],
    );
    expect(lineSnapshot[0]?.sku_identifier_snapshot).toBe('NOTA-INTEGRATION');

    const completionContext = context();
    await service.complete(completionContext, notaId, {
      lifecycleVersion: '1',
      destination: 'archive',
    });
    await service.reopen(context(), notaId, { lifecycleVersion: '2' });
    await service.cancel(context(), notaId, { lifecycleVersion: '3' });
    await service.restore(context(), notaId, { lifecycleVersion: '4' });
    await pool.query(
      `UPDATE skus SET primary_identifier = 'NOTA-RENAMED'
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [skuId],
    );
    await service.updateLine(context(), notaId, pageId, lineId, {
      lifecycleVersion: '5',
      pageVersion: '1',
      lineVersion: '2',
      base: firstLine,
      mine: { ...firstLine, quantity: 3 },
    });
    await service.complete(context(), notaId, {
      lifecycleVersion: '5',
      destination: 'archive',
    });
    await service.cancel(context(), notaId, { lifecycleVersion: '6' });
    await service.restore(context(), notaId, { lifecycleVersion: '7' });
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
    expect(Number(rows[0]!.posting_count)).toBe(6);
    expect(Number(rows[0]!.movement_count)).toBe(6);
    const postingSnapshots = await pool.query<Array<{
      posting_kind: string;
      snapshot_json: string | Record<string, unknown>;
    }>>(
      `SELECT posting_kind, snapshot_json
       FROM nota_postings
       WHERE nota_id = UNHEX(REPLACE(?, '-', ''))
         AND posting_kind IN ('complete', 'recomplete')
       ORDER BY lifecycle_version`,
      [notaId],
    );
    const snapshots = postingSnapshots.map((row) =>
      typeof row.snapshot_json === 'string'
        ? JSON.parse(row.snapshot_json) as Record<string, unknown>
        : row.snapshot_json);
    expect(
      (snapshots[0]?.lines as Array<Record<string, unknown>>)[0]
        ?.skuIdentifierSnapshot,
    ).toBe('NOTA-INTEGRATION');
    expect(
      (snapshots[1]?.lines as Array<Record<string, unknown>>)[0]
        ?.skuIdentifierSnapshot,
    ).toBe('NOTA-RENAMED');
    const changeTypes = await pool.query<Array<{ entity_type: string }>>(
      `SELECT DISTINCT entity_type
       FROM change_log
       WHERE entity_type IN ('nota_posting', 'revenue_posting')`,
    );
    expect(changeTypes.map((row) => row.entity_type).sort()).toEqual([
      'nota_posting',
      'revenue_posting',
    ]);
  });

  it('durably resolves full multi-field conflict intent for mine and server', async () => {
    const deviceId = randomUUID();
    await pool.query(
      `INSERT INTO devices
         (id, role, installation_id, display_name, platform, token_hash,
          token_expires_at, approved_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), 'client',
          UNHEX(REPLACE(?, '-', '')), 'Conflict integration', 'test',
          UNHEX(SHA2(?, 256)), DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY),
          UTC_TIMESTAMP(6))`,
      [deviceId, randomUUID(), randomUUID()],
    );
    const service = new NotaOperationsService(pool as unknown as ProtocolPool);
    const context = () => ({ deviceId, idempotencyKey: randomUUID() });
    const created = await service.create(context(), {}) as {
      entity: { id: string };
    };
    const notaId = created.entity.id;
    await service.updateHeader(context(), notaId, {
      lifecycleVersion: '1',
      fields: {
        customerName: { version: '1', base: '', mine: 'Server' },
      },
    });
    let mineConflict: NotaConflictError | undefined;
    try {
      await service.updateHeader(context(), notaId, {
        lifecycleVersion: '1',
        fields: {
          customerName: { version: '1', base: '', mine: 'Mine' },
          customerPlace: { version: '1', base: '', mine: 'Denpasar' },
        },
      });
    } catch (error) {
      if (error instanceof NotaConflictError) mineConflict = error;
      else throw error;
    }
    expect(mineConflict?.conflict.entityType).toBe('nota');
    const mineResolution = await service.resolveConflict(
      context(),
      mineConflict!.conflict.id,
      { choice: 'mine' },
    ) as {
      serverRevision: string;
      entity: { customerName: string; customerPlace: string };
      versionState: {
        fieldVersions: Record<string, string>;
        pageVersions: Record<string, string>;
        lineVersions: Record<string, string>;
      };
    };
    expect(mineResolution.entity).toMatchObject({
      customerName: 'Mine',
      customerPlace: 'Denpasar',
    });
    expect(mineResolution.versionState.fieldVersions).toMatchObject({
      customerName: '3',
      customerPlace: '2',
    });
    expect(Object.keys(mineResolution.versionState.pageVersions)).toHaveLength(1);
    expect(Object.keys(mineResolution.versionState.lineVersions)).toHaveLength(15);
    expect(BigInt(mineResolution.serverRevision)).toBeGreaterThan(0n);

    let serverConflict: NotaConflictError | undefined;
    try {
      await service.updateHeader(context(), notaId, {
        lifecycleVersion: '1',
        fields: {
          customerName: { version: '1', base: '', mine: 'Discard me' },
        },
      });
    } catch (error) {
      if (error instanceof NotaConflictError) serverConflict = error;
      else throw error;
    }
    const serverResolution = await service.resolveConflict(
      context(),
      serverConflict!.conflict.id,
      { choice: 'server' },
    ) as {
      serverRevision: string;
      entity: { customerName: string };
    };
    expect(serverResolution.entity.customerName).toBe('Mine');
    const replay = await service.resolveConflict(
      context(),
      serverConflict!.conflict.id,
      { choice: 'server' },
    ) as { serverRevision: string; entity: { customerName: string } };
    expect(replay.entity.customerName).toBe('Mine');
    expect(BigInt(replay.serverRevision)).toBeGreaterThan(0n);
  });

  it('allocates concurrent Nota numbers and posts one concurrent completion', async () => {
    const deviceId = randomUUID();
    await pool.query(
      `INSERT INTO devices
         (id, role, installation_id, display_name, platform, token_hash,
          token_expires_at, approved_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), 'client',
          UNHEX(REPLACE(?, '-', '')), 'Concurrency integration', 'test',
          UNHEX(SHA2(?, 256)), DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY),
          UTC_TIMESTAMP(6))`,
      [deviceId, randomUUID(), randomUUID()],
    );
    const service = new NotaOperationsService(pool as unknown as ProtocolPool);
    const context = () => ({ deviceId, idempotencyKey: randomUUID() });
    const created = await Promise.all([
      service.create(context(), {}),
      service.create(context(), {}),
    ]) as Array<{ entity: { id: string; baseNumber: string } }>;
    expect(new Set(created.map((item) => item.entity.baseNumber)).size).toBe(2);

    const notaId = created[0]!.entity.id;
    const completions = await Promise.allSettled([
      service.complete(context(), notaId, {
        lifecycleVersion: '1',
        destination: 'archive',
      }),
      service.complete(context(), notaId, {
        lifecycleVersion: '1',
        destination: 'finished',
      }),
    ]);
    expect(completions.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(
      completions.filter(
        (item) =>
          item.status === 'rejected' &&
          item.reason instanceof NotaConflictError,
      ),
    ).toHaveLength(1);
    const count = await pool.query<Array<{ posting_count: number }>>(
      `SELECT COUNT(*) AS posting_count
       FROM nota_postings
       WHERE nota_id = UNHEX(REPLACE(?, '-', ''))`,
      [notaId],
    );
    expect(Number(count[0]?.posting_count)).toBe(1);
  });

  it('faithfully applies mine across completion and cancellation races', async () => {
    const deviceId = randomUUID();
    await pool.query(
      `INSERT INTO devices
         (id, role, installation_id, display_name, platform, token_hash,
          token_expires_at, approved_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), 'client',
          UNHEX(REPLACE(?, '-', '')), 'Override integration', 'test',
          UNHEX(SHA2(?, 256)), DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY),
          UTC_TIMESTAMP(6))`,
      [deviceId, randomUUID(), randomUUID()],
    );
    const service = new NotaOperationsService(pool as unknown as ProtocolPool);
    const context = () => ({ deviceId, idempotencyKey: randomUUID() });
    const captureConflict = async (
      command: () => Promise<unknown>,
    ): Promise<NotaConflictError> => {
      try {
        await command();
      } catch (error) {
        if (error instanceof NotaConflictError) return error;
        throw error;
      }
      throw new Error('Expected a durable Nota conflict');
    };

    const headerNota = await service.create(context(), {}) as {
      entity: { id: string };
    };
    await service.complete(context(), headerNota.entity.id, {
      lifecycleVersion: '1',
      destination: 'archive',
    });
    const headerConflict = await captureConflict(() =>
      service.updateHeader(context(), headerNota.entity.id, {
        lifecycleVersion: '1',
        fields: {
          customerName: { version: '1', base: '', mine: 'Override selesai' },
        },
      }),
    );
    const headerResolved = await service.resolveConflict(
      context(),
      headerConflict.conflict.id,
      { choice: 'mine' },
    ) as {
      entity: { status: string; customerName: string };
    };
    expect(headerResolved.entity).toMatchObject({
      status: 'completed',
      customerName: 'Override selesai',
    });

    const completionNota = await service.create(context(), {}) as {
      entity: { id: string };
    };
    await service.complete(context(), completionNota.entity.id, {
      lifecycleVersion: '1',
      destination: 'archive',
    });
    const completionConflict = await captureConflict(() =>
      service.complete(context(), completionNota.entity.id, {
        lifecycleVersion: '1',
        destination: 'finished',
      }),
    );
    const completionResolved = await service.resolveConflict(
      context(),
      completionConflict.conflict.id,
      { choice: 'mine' },
    ) as {
      entity: { status: string; completionDestination: string };
    };
    expect(completionResolved.entity).toMatchObject({
      status: 'completed',
      completionDestination: 'finished',
    });

    const lineNota = await service.create(context(), {}) as {
      entity: {
        id: string;
        pages: Array<{ id: string; lines: Array<{ id: string }> }>;
      };
    };
    const linePageId = lineNota.entity.pages[0]!.id;
    const lineId = lineNota.entity.pages[0]!.lines[0]!.id;
    await service.cancel(context(), lineNota.entity.id, {
      lifecycleVersion: '1',
    });
    const lineConflict = await captureConflict(() =>
      service.updateLine(
        context(),
        lineNota.entity.id,
        linePageId,
        lineId,
        {
          lifecycleVersion: '1',
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
          mine: {
            linePosition: 0,
            skuId: null,
            description: 'Baris sesudah batal',
            kind: 'manual',
            quantity: 1,
            unit: 'pcs',
            pcsPrice: 5000,
            lsnPrice: 60000,
          },
        },
      ),
    );
    const lineResolved = await service.resolveConflict(
      context(),
      lineConflict.conflict.id,
      { choice: 'mine' },
    ) as {
      entity: {
        status: string;
        pages: Array<{ lines: Array<{ description: string }> }>;
      };
    };
    expect(lineResolved.entity.status).toBe('cancelled');
    expect(lineResolved.entity.pages[0]?.lines[0]?.description).toBe(
      'Baris sesudah batal',
    );

    const evidence = await pool.query<Array<{
      nota_id: string;
      posting_count: number;
      override_count: number;
    }>>(
      `SELECT
         LOWER(CONCAT(
           SUBSTR(HEX(n.id), 1, 8), '-', SUBSTR(HEX(n.id), 9, 4), '-',
           SUBSTR(HEX(n.id), 13, 4), '-', SUBSTR(HEX(n.id), 17, 4), '-',
           SUBSTR(HEX(n.id), 21, 12)
         )) AS nota_id,
         (SELECT COUNT(*) FROM nota_postings p WHERE p.nota_id = n.id)
           AS posting_count,
         (SELECT COUNT(*) FROM audit_events a
          WHERE a.entity_id = n.id AND a.action = 'nota.conflict.override')
           AS override_count
       FROM notas n
       WHERE n.id IN (
         UNHEX(REPLACE(?, '-', '')),
         UNHEX(REPLACE(?, '-', '')),
         UNHEX(REPLACE(?, '-', ''))
       )`,
      [
        headerNota.entity.id,
        completionNota.entity.id,
        lineNota.entity.id,
      ],
    );
    const byId = new Map(evidence.map((row) => [row.nota_id, row]));
    expect(Number(byId.get(headerNota.entity.id)?.posting_count)).toBe(2);
    expect(Number(byId.get(completionNota.entity.id)?.posting_count)).toBe(2);
    expect(Number(byId.get(lineNota.entity.id)?.posting_count)).toBe(0);
    expect(
      evidence.map((row) => Number(row.override_count)),
    ).toEqual([1, 1, 1]);
  });
});
