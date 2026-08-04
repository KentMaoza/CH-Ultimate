import { describe, expect, it } from 'vitest';

import { MariaDbPackageBarcodeRepository } from '../src/package-barcode/mariadb-repository.js';
import type { ProtocolConnection } from '../src/sync/idempotency.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const SKU_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_SKU_ID = '33333333-3333-4333-8333-333333333333';
const IDENTIFIER_ID = '44444444-4444-4444-8444-444444444444';

function repository() {
  return new MariaDbPackageBarcodeRepository({
    uuid: () => IDENTIFIER_ID,
    now: () => new Date('2026-08-04T02:00:00.000Z'),
  });
}

describe('MariaDB package-barcode repository', () => {
  it('registers in the global identifier table and treats the same mapping as idempotent', async () => {
    const queries: string[] = [];
    let existing = false;
    const connection = {
      async query<T>(sql: string) {
        const compact = sql.replace(/\s+/g, ' ').trim();
        queries.push(compact);
        if (compact.includes('FROM skus')) {
          return [{ id_hex: SKU_ID.replaceAll('-', '') }] as T;
        }
        if (compact.includes('FROM sku_identifiers') && compact.includes('identifier_hash')) {
          return existing
            ? [{
                id_hex: IDENTIFIER_ID.replaceAll('-', ''),
                sku_id_hex: SKU_ID.replaceAll('-', ''),
                identifier_value: '8990001234567',
                identifier_kind: 'package_barcode',
                created_at: new Date('2026-08-04T02:00:00.000Z'),
              }] as T
            : [] as T;
        }
        if (compact.startsWith('INSERT INTO sku_identifiers')) existing = true;
        if (compact.startsWith('INSERT INTO change_log')) return { insertId: 12n } as T;
        return [] as T;
      },
    } as Pick<ProtocolConnection, 'query'>;

    const first = await repository().register(connection, DEVICE_ID, SKU_ID, '8990001234567');
    const second = await repository().register(connection, DEVICE_ID, SKU_ID, '8990001234567');

    expect(first.body).toMatchObject({ apiSchemaVersion: 2, entity: { identifierKind: 'package_barcode' } });
    expect(second.body).toEqual(first.body);
    expect(queries.filter((sql) => sql.startsWith('INSERT INTO sku_identifiers'))).toHaveLength(1);
    expect(queries.some((sql) => sql.includes('package_barcodes'))).toBe(false);
  });

  it('rejects a barcode already assigned to a different SKU', async () => {
    const connection = {
      async query<T>(sql: string) {
        const compact = sql.replace(/\s+/g, ' ').trim();
        if (compact.includes('FROM skus')) {
          return [{ id_hex: SKU_ID.replaceAll('-', '') }] as T;
        }
        if (compact.includes('FROM sku_identifiers')) {
          return [{
            id_hex: IDENTIFIER_ID.replaceAll('-', ''),
            sku_id_hex: OTHER_SKU_ID.replaceAll('-', ''),
            identifier_value: '8990001234567',
            identifier_kind: 'package_barcode',
            created_at: new Date(),
          }] as T;
        }
        return [] as T;
      },
    } as Pick<ProtocolConnection, 'query'>;

    await expect(
      repository().register(connection, DEVICE_ID, SKU_ID, '8990001234567'),
    ).rejects.toMatchObject({ code: 'IDENTIFIER_CONFLICT', statusCode: 409 });
  });

  it('removes and reassigns only package-barcode identifiers', async () => {
    const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
    let targetSku = SKU_ID;
    const connection = {
      async query<T>(sql: string, values: readonly unknown[] = []) {
        const compact = sql.replace(/\s+/g, ' ').trim();
        queries.push({ sql: compact, values });
        if (compact.includes('FROM sku_identifiers') && compact.includes('WHERE id =')) {
          return [{
            id_hex: IDENTIFIER_ID.replaceAll('-', ''),
            sku_id_hex: targetSku.replaceAll('-', ''),
            identifier_value: '8990001234567',
            identifier_kind: 'package_barcode',
            created_at: new Date('2026-08-04T02:00:00.000Z'),
          }] as T;
        }
        if (compact.includes('FROM skus')) {
          const requested = String(values[0]);
          return [{ id_hex: requested.replaceAll('-', '') }] as T;
        }
        if (compact.startsWith('UPDATE sku_identifiers')) targetSku = String(values[0]);
        if (compact.startsWith('INSERT INTO change_log')) return { insertId: 13n } as T;
        return [] as T;
      },
    } as Pick<ProtocolConnection, 'query'>;

    const reassigned = await repository().reassign(
      connection,
      DEVICE_ID,
      IDENTIFIER_ID,
      OTHER_SKU_ID,
    );
    const removed = await repository().remove(connection, DEVICE_ID, IDENTIFIER_ID);

    expect(reassigned.body).toMatchObject({ entity: { skuId: OTHER_SKU_ID } });
    expect(removed.body).toMatchObject({ entityId: IDENTIFIER_ID });
    expect(queries.some(({ sql }) => sql.startsWith('DELETE FROM sku_identifiers'))).toBe(true);
  });
});
