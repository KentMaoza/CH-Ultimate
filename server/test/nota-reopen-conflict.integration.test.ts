import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mariadb, { type Pool } from 'mariadb';

import { runMigrations } from '../src/db/migrate.js';
import {
  NotaConflictError,
  NotaOperationError,
  NotaOperationsService,
} from '../src/nota/service.js';
import type { ProtocolPool } from '../src/sync/idempotency.js';

const databaseUrl = process.env.CH_CORE_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('Nota reopen conflict against isolated chu_test MariaDB', () => {
  let pool: Pool;
  let deviceId: string;

  beforeAll(async () => {
    const parsed = new URL(databaseUrl!);
    if (parsed.pathname !== '/chu_test') {
      throw new Error(
        'CH_CORE_TEST_DATABASE_URL must target the isolated chu_test schema',
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
    deviceId = randomUUID();
    await pool.query(
      `INSERT INTO devices
         (id, role, installation_id, display_name, platform, token_hash,
          token_expires_at, approved_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), 'client',
          UNHEX(REPLACE(?, '-', '')), 'Reopen conflict integration', 'test',
          UNHEX(SHA2(?, 256)), DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY),
          UTC_TIMESTAMP(6))`,
      [deviceId, randomUUID(), randomUUID()],
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it.each([
    {
      cancelledFromStatus: 'completed',
      expectedStatus: 'reopened',
      shouldReject: false,
    },
    {
      cancelledFromStatus: 'reopened',
      expectedStatus: 'reopened',
      shouldReject: false,
    },
    {
      cancelledFromStatus: 'draft',
      expectedStatus: 'cancelled',
      shouldReject: true,
    },
  ])(
    'reapplies reopen mine after cancellation from $cancelledFromStatus',
    async ({ cancelledFromStatus, expectedStatus, shouldReject }) => {
      const service = new NotaOperationsService(
        pool as unknown as ProtocolPool,
      );
      const context = () => ({
        deviceId,
        idempotencyKey: randomUUID(),
      });
      const created = await service.create(context(), {}) as {
        entity: { id: string };
      };
      const notaId = created.entity.id;

      if (cancelledFromStatus !== 'draft') {
        await service.complete(context(), notaId, {
          lifecycleVersion: '1',
          destination: 'archive',
        });
      }
      if (cancelledFromStatus === 'reopened') {
        await service.reopen(context(), notaId, { lifecycleVersion: '2' });
        await service.cancel(context(), notaId, { lifecycleVersion: '3' });
      } else {
        await service.cancel(context(), notaId, {
          lifecycleVersion:
            cancelledFromStatus === 'completed' ? '2' : '1',
        });
      }

      let conflict: NotaConflictError | undefined;
      try {
        await service.reopen(context(), notaId, {
          lifecycleVersion:
            cancelledFromStatus === 'draft' ? '1' : '2',
        });
      } catch (error) {
        if (error instanceof NotaConflictError) conflict = error;
        else throw error;
      }
      expect(conflict?.conflict.mine).toEqual({ action: 'reopen' });
      const resolutionContext = context();

      if (shouldReject) {
        await expect(service.resolveConflict(
          resolutionContext,
          conflict!.conflict.id,
          { choice: 'mine' },
        )).rejects.toMatchObject({
          code: 'CONFLICT_OVERRIDE_STALE',
          statusCode: 409,
        } satisfies Partial<NotaOperationError>);
      } else {
        const first = await service.resolveConflict(
          resolutionContext,
          conflict!.conflict.id,
          { choice: 'mine' },
        );
        const replay = await service.resolveConflict(
          resolutionContext,
          conflict!.conflict.id,
          { choice: 'mine' },
        );
        expect(replay).toEqual(first);
      }

      const evidence = await pool.query<Array<Record<string, unknown>>>(
        `SELECT
           n.status,
           c.resolved_choice,
           (SELECT COUNT(*) FROM nota_postings p WHERE p.nota_id = n.id)
             AS posting_count,
           (SELECT COUNT(*) FROM audit_events a
            WHERE a.entity_id = n.id
              AND a.action = 'nota.conflict.override') AS override_count,
           (SELECT COUNT(*) FROM idempotency_receipts r
            WHERE r.device_id = UNHEX(REPLACE(?, '-', ''))
              AND r.idempotency_key = ?) AS resolution_receipt_count
         FROM notas n
         JOIN nota_conflicts c ON c.nota_id = n.id
         WHERE n.id = UNHEX(REPLACE(?, '-', ''))
           AND c.id = UNHEX(REPLACE(?, '-', ''))`,
        [
          deviceId,
          resolutionContext.idempotencyKey,
          notaId,
          conflict!.conflict.id,
        ],
      );
      expect(evidence[0]).toMatchObject({
        status: expectedStatus,
        resolved_choice: shouldReject ? null : 'mine',
      });
      expect(Number(evidence[0]?.posting_count)).toBe(
        cancelledFromStatus === 'draft' ? 0 : 3,
      );
      expect(Number(evidence[0]?.override_count)).toBe(shouldReject ? 0 : 1);
      expect(Number(evidence[0]?.resolution_receipt_count)).toBe(
        shouldReject ? 0 : 1,
      );
    },
  );
});
