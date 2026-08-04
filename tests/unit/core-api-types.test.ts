import { describe, expect, it } from 'vitest';

import {
  CoreApiSchemaError,
  parseCoreApiError,
  parseCoreBootstrap,
  parseCoreChangePage,
} from '../../src/gateway/core-api-types';
import {
  LINE_ID,
  NOTA_ID,
  SKU_ID,
  bootstrapBody,
  populatedBootstrap,
} from './core-gateway-test-support';

describe('CH Core API envelope validation', () => {
  it('accepts the complete bootstrap shape emitted by the approved server', () => {
    const parsed = parseCoreBootstrap(populatedBootstrap('42'));

    expect(parsed.serverRevision).toBe('42');
    expect(parsed.skus[0]).toMatchObject({
      id: SKU_ID,
      priceRupiah: '25000',
      rowVersion: '1',
    });
    expect(parsed.notas[0]).toMatchObject({
      id: NOTA_ID,
      structureVersion: '1',
      lifecycleVersion: '1',
    });
    expect(parsed.notaLines[0]).toMatchObject({
      id: LINE_ID,
      quantityPcs: '1',
      lineTotalRupiah: '25000',
    });
  });

  it.each([
    ['negative revision', bootstrapBody('-1')],
    ['leading-zero revision', bootstrapBody('01')],
    [
      'numeric rupiah',
      populatedBootstrap('1', {
        skus: [{ ...populatedBootstrap().skus[0]!, priceRupiah: 25000 }],
      }),
    ],
  ])('rejects %s instead of coercing the API envelope', (_name, body) => {
    expect(() => parseCoreBootstrap(body)).toThrow(CoreApiSchemaError);
  });

  it('requires API schema v2 and marks v3 as upgrade-required', () => {
    const { apiSchemaVersion: _version, ...missingMarker } = bootstrapBody();
    expect(() => parseCoreBootstrap(missingMarker)).toThrow(CoreApiSchemaError);
    expect(() =>
      parseCoreBootstrap({
        ...bootstrapBody(),
        apiSchemaVersion: 3,
      }),
    ).toThrow(
      expect.objectContaining({
        name: 'CoreApiUpgradeRequiredError',
      }),
    );
  });

  it('accepts ascending changes and validates their complete envelope', () => {
    const parsed = parseCoreChangePage({
      apiSchemaVersion: 2,
      serverRevision: '3',
      nextAfter: '3',
      changes: [
        {
          revision: '2',
          entityType: 'device',
          entityId: SKU_ID,
          operation: 'upsert',
          payload: { id: SKU_ID, role: 'owner' },
          createdAt: '2026-07-29T00:00:01.000Z',
        },
        {
          revision: '3',
          entityType: 'pairing',
          entityId: NOTA_ID,
          operation: 'upsert',
          payload: { id: NOTA_ID, status: 'approved' },
          createdAt: '2026-07-29T00:00:02.000Z',
        },
      ],
    });

    expect(parsed.changes.map((change) => change.revision)).toEqual(['2', '3']);
  });

  it.each([
    {
      name: 'out-of-order revisions',
      body: {
        apiSchemaVersion: 2,
        serverRevision: '3',
        nextAfter: '2',
        changes: [
          {
            revision: '3',
            entityType: 'device',
            entityId: SKU_ID,
            operation: 'upsert',
            payload: {},
            createdAt: '2026-07-29T00:00:01.000Z',
          },
          {
            revision: '2',
            entityType: 'device',
            entityId: SKU_ID,
            operation: 'upsert',
            payload: {},
            createdAt: '2026-07-29T00:00:02.000Z',
          },
        ],
      },
    },
    {
      name: 'noncanonical next cursor',
      body: { apiSchemaVersion: 2, serverRevision: '3', nextAfter: '03', changes: [] },
    },
  ])('rejects $name', ({ body }) => {
    expect(() => parseCoreChangePage(body)).toThrow(CoreApiSchemaError);
  });

  it('parses cursor recovery and typed conflict errors without widening choices', () => {
    expect(
      parseCoreApiError(409, {
        code: 'CURSOR_AHEAD',
        bootstrapRequired: true,
      }),
    ).toEqual({
      status: 409,
      code: 'CURSOR_AHEAD',
      bootstrapRequired: true,
    });

    expect(
      parseCoreApiError(409, {
        code: 'CONFLICT',
        conflict: {
          id: '88888888-8888-4888-8888-888888888888',
          entityType: 'nota',
          entityId: NOTA_ID,
          field: 'customerName',
          base: 'Amelia',
          mine: 'Amina',
          server: 'Amelia Baru',
        },
      }),
    ).toMatchObject({
      code: 'CONFLICT',
      conflict: {
        mine: 'Amina',
        server: 'Amelia Baru',
      },
    });
  });
});
