import { describe, expect, it, vi } from 'vitest';

import { MariaDbNotaLifecycleRepository } from '../src/nota/mariadb-nota-lifecycle-repository.js';
import type { ProtocolConnection } from '../src/sync/idempotency.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const NOTA_ID = '33333333-3333-4333-8333-333333333333';
const PAGE_ID = '44444444-4444-4444-8444-444444444444';
const LINE_ID = '55555555-5555-4555-8555-555555555555';

describe('MariaDB Nota completion validation', () => {
  it('rejects a partially typed active line instead of silently omitting it', async () => {
    const createdAt = new Date('2026-08-11T00:00:00.000Z');
    const nota = {
      id_hex: NOTA_ID.replaceAll('-', ''),
      nota_number: 'CHU-20260811-0001',
      business_date: '2026-08-11',
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
    const partialLine = {
      id_hex: LINE_ID.replaceAll('-', ''),
      nota_id_hex: NOTA_ID.replaceAll('-', ''),
      page_id_hex: PAGE_ID.replaceAll('-', ''),
      sku_id_hex: null,
      line_position: 0,
      sku_identifier_snapshot: '',
      sku_name_snapshot: 'Produk Uji',
      kind_snapshot: 'Ukuran Besar',
      quantity_pcs: 0n,
      unit_kind: 'pcs',
      unit_price_rupiah: 10_000n,
      pcs_price_rupiah: 10_000n,
      lsn_price_rupiah: 120_000n,
      line_total_rupiah: 0n,
      row_version: 2n,
      deleted_at: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
    const connection = {
      query: vi.fn(async <T>(sql: string): Promise<T> => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        if (compact.includes('FROM notas')) return [nota] as T;
        if (compact.includes('FROM nota_pages')) return [page] as T;
        if (compact.includes('FROM nota_lines')) return [partialLine] as T;
        throw new Error(`Unexpected SQL after incomplete line: ${compact}`);
      }),
    } as unknown as ProtocolConnection;
    const repository = new MariaDbNotaLifecycleRepository();

    await expect(repository.complete(
      connection,
      DEVICE_ID,
      OPERATION_ID,
      NOTA_ID,
      { lifecycleVersion: '1', destination: 'archive' },
    )).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      statusCode: 422,
    });
  });
});
