import { describe, expect, it, vi } from 'vitest';

import { MariaDbNotaConflictRepository } from '../src/nota/mariadb-nota-conflict-repository.js';
import type { ProtocolConnection } from '../src/sync/idempotency.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const CONFLICT_ID = '33333333-3333-4333-8333-333333333333';
const NOTA_ID = '44444444-4444-4444-8444-444444444444';
const PAGE_ID = '55555555-5555-4555-8555-555555555555';
const LINE_IDS = Array.from(
  { length: 15 },
  (_, index) =>
    `60000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);

describe('MariaDB Nota conflict resolution', () => {
  it('reads the server revision from the change-log sequence on a replay', async () => {
    const now = new Date('2026-08-04T12:00:00.000Z');
    const nota = {
      id_hex: NOTA_ID.replaceAll('-', ''),
      nota_number: 'CHU-20260804-0001',
      business_date: '2026-08-04',
      status: 'draft',
      completion_destination: null,
      cancelled_from_status: null,
      header_json: '{}',
      field_versions: '{}',
      structure_version: 1n,
      lifecycle_version: 1n,
      subtotal_rupiah: 0n,
      total_rupiah: 0n,
      created_by_device_id_hex: DEVICE_ID.replaceAll('-', ''),
      completed_at: null,
      cancelled_at: null,
      created_at: now,
      updated_at: now,
    };
    const queries: string[] = [];
    const connection = {
      query: vi.fn(async <T>(sql: string): Promise<T> => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        queries.push(compact);
        if (compact.includes('FROM nota_conflicts')) {
          return [{
            nota_id_hex: NOTA_ID.replaceAll('-', ''),
            resolved_choice: 'server',
          }] as T;
        }
        if (compact.includes('FROM notas')) return [nota] as T;
        if (compact.includes('FROM nota_pages')) return [] as T;
        if (compact.includes('FROM nota_lines')) return [] as T;
        if (compact.includes('FROM nota_postings')) return [] as T;
        if (compact.includes('FROM change_log')) return [{ revision: 17n }] as T;
        throw new Error(`Unexpected SQL: ${compact}`);
      }),
    } as unknown as ProtocolConnection;
    const unavailable = vi.fn(async () => {
      throw new Error('Resolved conflict must not replay an operation');
    });
    const repository = new MariaDbNotaConflictRepository({
      updateHeader: unavailable,
      updateLine: unavailable,
      deleteLine: unavailable,
      addPage: unavailable,
      restorePage: unavailable,
      cancelPage: unavailable,
      complete: unavailable,
      reopen: unavailable,
      cancel: unavailable,
      restore: unavailable,
    });

    const result = await repository.resolveConflict(
      connection,
      DEVICE_ID,
      OPERATION_ID,
      CONFLICT_ID,
      { choice: 'server' },
    );

    expect(result.body.serverRevision).toBe('17');
    expect(queries).toContain(
      'SELECT COALESCE(MAX(sequence), 0) AS revision FROM change_log',
    );
    expect(unavailable).not.toHaveBeenCalled();
  });

  it('replays the complete validated add-page intent with stable client IDs', async () => {
    const now = new Date('2026-08-04T12:00:00.000Z');
    const nota = {
      id_hex: NOTA_ID.replaceAll('-', ''),
      nota_number: 'CHU-20260804-0001',
      business_date: '2026-08-04',
      status: 'draft',
      completion_destination: null,
      cancelled_from_status: null,
      header_json: JSON.stringify({
        customerName: 'Amelia',
        customerPlace: 'Denpasar',
        transactionDate: '2026-08-04',
        payment: 'cash',
      }),
      field_versions: JSON.stringify({
        customerName: 1,
        customerPlace: 1,
        transactionDate: 1,
        payment: 1,
      }),
      structure_version: 1n,
      lifecycle_version: 1n,
      subtotal_rupiah: 0n,
      total_rupiah: 0n,
      created_by_device_id_hex: DEVICE_ID.replaceAll('-', ''),
      completed_at: null,
      cancelled_at: null,
      created_at: now,
      updated_at: now,
    };
    const pages: Array<Record<string, unknown>> = [];
    const lines: Array<Record<string, unknown>> = [];
    const originalInput = {
      lifecycleVersion: '1',
      structureVersion: '1',
      clientPageId: PAGE_ID,
      clientLineIds: LINE_IDS,
    };
    const connection = {
      query: vi.fn(async <T>(sql: string): Promise<T> => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        if (compact.includes('FROM nota_conflicts')) {
          return [{
            nota_id_hex: NOTA_ID.replaceAll('-', ''),
            intent_json: JSON.stringify({
              action: 'add-page',
              input: originalInput,
            }),
            resolved_choice: null,
          }] as T;
        }
        if (compact.includes('FROM notas')) return [nota] as T;
        if (compact.includes('FROM nota_pages')) return pages as T;
        if (compact.includes('FROM nota_lines')) return lines as T;
        if (compact.includes('FROM nota_postings')) return [] as T;
        if (compact.startsWith('UPDATE nota_conflicts')) return {} as T;
        if (compact.startsWith('INSERT INTO audit_events')) return {} as T;
        if (compact.startsWith('INSERT INTO change_log')) {
          return { insertId: 9n } as T;
        }
        throw new Error(`Unexpected SQL: ${compact}`);
      }),
    } as unknown as ProtocolConnection;
    const addPage = vi.fn(async () => {
      nota.structure_version = 2n;
      pages.push({
        id_hex: PAGE_ID.replaceAll('-', ''),
        nota_id_hex: NOTA_ID.replaceAll('-', ''),
        page_position: 0,
        status: 'active',
        row_version: 1n,
        lifecycle_version: 1n,
        created_at: now,
        updated_at: now,
      });
      lines.push(...LINE_IDS.map((lineId, linePosition) => ({
        id_hex: lineId.replaceAll('-', ''),
        nota_id_hex: NOTA_ID.replaceAll('-', ''),
        page_id_hex: PAGE_ID.replaceAll('-', ''),
        sku_id_hex: null,
        line_position: linePosition,
        sku_identifier_snapshot: '',
        sku_name_snapshot: '',
        kind_snapshot: '',
        quantity_pcs: 0n,
        unit_kind: 'pcs',
        unit_price_rupiah: 0n,
        pcs_price_rupiah: 0n,
        lsn_price_rupiah: 0n,
        line_total_rupiah: 0n,
        row_version: 1n,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      })));
      return { statusCode: 200, body: {}, audits: [], changes: [] };
    });
    const unavailable = vi.fn(async () => {
      throw new Error('Unexpected conflict operation');
    });
    const repository = new MariaDbNotaConflictRepository({
      updateHeader: unavailable,
      updateLine: unavailable,
      deleteLine: unavailable,
      addPage,
      restorePage: unavailable,
      cancelPage: unavailable,
      complete: unavailable,
      reopen: unavailable,
      cancel: unavailable,
      restore: unavailable,
    }, { now: () => now });

    const result = await repository.resolveConflict(
      connection,
      DEVICE_ID,
      OPERATION_ID,
      CONFLICT_ID,
      { choice: 'mine' },
    );

    expect(addPage).toHaveBeenCalledWith(
      connection,
      DEVICE_ID,
      OPERATION_ID,
      NOTA_ID,
      { ...originalInput, structureVersion: '1', lifecycleVersion: '1' },
    );
    expect(result.body.entity).toMatchObject({
      id: NOTA_ID,
      pages: [{ id: PAGE_ID, lines: LINE_IDS.map((id) => ({ id })) }],
    });
    expect(result.body.versionState).toMatchObject({
      notaId: NOTA_ID,
      structureVersion: '2',
      pageVersions: { [PAGE_ID]: '1' },
      lineVersions: Object.fromEntries(LINE_IDS.map((id) => [id, '1'])),
    });
  });

  it('leaves an impossible cancelled-from-draft reopen unresolved', async () => {
    const conflictUpdates: string[] = [];
    const connection = {
      query: vi.fn(async <T>(sql: string): Promise<T> => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        if (compact.includes('FROM nota_conflicts')) {
          return [{
            nota_id_hex: NOTA_ID.replaceAll('-', ''),
            intent_json: JSON.stringify({
              action: 'reopen',
              input: { lifecycleVersion: '1' },
            }),
            resolved_choice: null,
          }] as T;
        }
        if (compact.includes('FROM notas')) {
          return [{
            id_hex: NOTA_ID.replaceAll('-', ''),
            status: 'cancelled',
            cancelled_from_status: 'draft',
            lifecycle_version: 2n,
            completion_destination: null,
          }] as T;
        }
        if (compact.startsWith('UPDATE nota_conflicts')) {
          conflictUpdates.push(compact);
          throw new Error('Conflict was incorrectly marked resolved');
        }
        throw new Error(`Unexpected SQL: ${compact}`);
      }),
    } as unknown as ProtocolConnection;
    const unavailable = vi.fn(async () => {
      throw new Error('Lifecycle operation should not run');
    });
    const repository = new MariaDbNotaConflictRepository({
      updateHeader: unavailable,
      updateLine: unavailable,
      deleteLine: unavailable,
      addPage: unavailable,
      restorePage: unavailable,
      cancelPage: unavailable,
      complete: unavailable,
      reopen: unavailable,
      cancel: unavailable,
      restore: unavailable,
    });

    await expect(repository.resolveConflict(
      connection,
      DEVICE_ID,
      OPERATION_ID,
      CONFLICT_ID,
      { choice: 'mine' },
    )).rejects.toMatchObject({
      code: 'CONFLICT_OVERRIDE_STALE',
      statusCode: 409,
    });
    expect(conflictUpdates).toEqual([]);
  });
});
