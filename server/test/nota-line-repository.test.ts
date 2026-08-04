import { describe, expect, it, vi } from 'vitest';

import { MariaDbNotaLineRepository } from '../src/nota/mariadb-nota-line-repository.js';
import type { ProtocolConnection } from '../src/sync/idempotency.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const NOTA_ID = '33333333-3333-4333-8333-333333333333';
const PAGE_ID = '44444444-4444-4444-8444-444444444444';
const LINE_ID = '55555555-5555-4555-8555-555555555555';

describe('MariaDB Nota line repository', () => {
  it('clears a line in place and acknowledges its physical UUID and next version', async () => {
    const createdAt = new Date('2026-08-04T08:00:00.000Z');
    const now = new Date('2026-08-04T09:00:00.000Z');
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
      subtotal_rupiah: 20_000n,
      total_rupiah: 20_000n,
      created_by_device_id_hex: DEVICE_ID.replaceAll('-', ''),
      completed_at: null,
      cancelled_at: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
    const page = {
      id_hex: PAGE_ID.replaceAll('-', ''),
      nota_id_hex: NOTA_ID.replaceAll('-', ''),
      page_position: 0,
      status: 'active',
      row_version: 1n,
      lifecycle_version: 1n,
      created_at: createdAt,
      updated_at: createdAt,
    };
    const line = {
      id_hex: LINE_ID.replaceAll('-', ''),
      nota_id_hex: NOTA_ID.replaceAll('-', ''),
      page_id_hex: PAGE_ID.replaceAll('-', ''),
      sku_id_hex: null,
      line_position: 0,
      sku_identifier_snapshot: '',
      sku_name_snapshot: 'Kopi',
      kind_snapshot: 'Minuman',
      quantity_pcs: 2n,
      unit_kind: 'pcs',
      unit_price_rupiah: 10_000n,
      pcs_price_rupiah: 10_000n,
      lsn_price_rupiah: 120_000n,
      line_total_rupiah: 20_000n,
      row_version: 1n,
      deleted_at: null as Date | null,
      created_at: createdAt,
      updated_at: createdAt,
    };
    let changeParameters: unknown[] | undefined;
    const connection = {
      query: vi.fn(async <T>(sql: string, parameters?: unknown[]): Promise<T> => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        if (compact.includes('FROM notas')) return [nota] as T;
        if (compact.includes('FROM nota_pages')) return [page] as T;
        if (compact.includes('FROM nota_lines')) return [line] as T;
        if (compact.includes('FROM nota_postings')) return [] as T;
        if (compact.startsWith('UPDATE nota_lines')) {
          line.row_version += 1n;
          line.updated_at = now;
          if (compact.includes('SET deleted_at = ?')) {
            line.deleted_at = now;
          } else {
            line.sku_id_hex = null;
            line.sku_identifier_snapshot = '';
            line.sku_name_snapshot = '';
            line.kind_snapshot = '';
            line.quantity_pcs = 0n;
            line.unit_kind = 'pcs';
            line.unit_price_rupiah = 0n;
            line.pcs_price_rupiah = 0n;
            line.lsn_price_rupiah = 0n;
            line.line_total_rupiah = 0n;
            line.deleted_at = null;
          }
          return {} as T;
        }
        if (compact.startsWith('INSERT INTO change_log')) {
          changeParameters = parameters;
          return { insertId: 9n } as T;
        }
        if (compact.startsWith('INSERT INTO audit_events')) return {} as T;
        throw new Error(`Unexpected SQL: ${compact}`);
      }),
    } as unknown as ProtocolConnection;
    const repository = new MariaDbNotaLineRepository({ now: () => now });

    const result = await repository.deleteLine(
      connection,
      DEVICE_ID,
      OPERATION_ID,
      NOTA_ID,
      PAGE_ID,
      LINE_ID,
      {
        lifecycleVersion: '1',
        pageVersion: '1',
        lineVersion: '1',
        base: {
          linePosition: 0,
          skuId: null,
          description: 'Kopi',
          kind: 'Minuman',
          quantity: 2,
          unit: 'pcs',
          pcsPrice: 10_000,
          lsnPrice: 120_000,
        },
      },
    );

    expect(result.body).toMatchObject({
      entityVersion: '2',
      versionState: {
        notaId: NOTA_ID,
        lineVersions: { [LINE_ID]: '2' },
      },
    });
    const entity = result.body.entity as {
      id: string;
      pages: Array<{ id: string; lines: Array<Record<string, unknown>> }>;
    };
    expect(entity.id).toBe(NOTA_ID);
    expect(entity.pages[0]?.id).toBe(PAGE_ID);
    expect(entity.pages[0]?.lines[0]).toEqual({
      id: LINE_ID,
      description: '',
      kind: '',
      quantity: 0,
      unit: 'pcs',
      pcsPrice: 0,
      lsnPrice: 0,
    });
    expect(changeParameters?.[2]).toBe('upsert');
    expect(JSON.parse(String(changeParameters?.[3]))).toMatchObject({
      id: LINE_ID,
      rowVersion: '2',
      deletedAt: null,
      quantityPcs: '0',
    });
  });
});
