import { describe, expect, it } from 'vitest';

import { demoStateSchema } from '../../src/gateway/core-domain-schemas';
import { emptyCoreState } from '../../src/gateway/core-bootstrap-mapping';
import { mapCoreBootstrapToDemoState } from '../../src/gateway/core-bootstrap-mapping';
import { parseCoreBootstrap } from '../../src/gateway/core-api-types';
import { applyCoreChange } from '../../src/gateway/core-change-application';
import { bootstrapBody } from './core-gateway-test-support';

describe('stock-check domain contract', () => {
  it('accepts typed package identifiers and the exact safe-integer stock-check model', () => {
    const state = emptyCoreState();
    const parsed = demoStateSchema.parse({
      ...state,
      skus: [{
        id: 'sku-1',
        skuNumber: 'SKU-1',
        aliases: ['8990001234567'],
        identifiers: [{
          id: 'identifier-1',
          skuId: 'sku-1',
          value: '8990001234567',
          kind: 'package_barcode',
          createdAt: '2026-08-04T01:00:00.000Z',
        }],
        name: 'Produk',
        referencePrice: 10_000,
        stock: 8,
        tracked: true,
        note: '',
        imageUrl: '',
        createdAt: '2026-08-04T01:00:00.000Z',
        archived: false,
        lastStockCheckedAt: '2026-08-04T01:10:00.000Z',
      }],
      stockChecks: [{
        id: 'check-1',
        skuId: 'sku-1',
        observedQuantityPcs: 10,
        countedQuantityPcs: 8,
        serverQuantityBeforePcs: 7,
        appliedDeltaPcs: 1,
        baseBalanceVersion: '3',
        forcedOffline: true,
        countedAt: '2026-08-04T01:10:00.000Z',
        appliedAt: '2026-08-04T01:15:00.000Z',
        deviceId: 'device-1',
        deviceDisplayName: 'HP Gudang',
        note: 'Rak utara',
      }],
    });

    expect(parsed.stockChecks[0]?.forcedOffline).toBe(true);
    expect(parsed.skus[0]?.identifiers[0]?.kind).toBe('package_barcode');
  });

  it('rejects quantities outside the JavaScript safe-integer boundary', () => {
    expect(() => demoStateSchema.parse({
      ...emptyCoreState(),
      stockChecks: [{
        id: 'check-1',
        skuId: 'sku-1',
        observedQuantityPcs: Number.MAX_SAFE_INTEGER + 1,
        countedQuantityPcs: 0,
        serverQuantityBeforePcs: 0,
        appliedDeltaPcs: 0,
        forcedOffline: false,
        countedAt: '2026-08-04T01:10:00.000Z',
        appliedAt: '2026-08-04T01:15:00.000Z',
        deviceId: 'device-1',
        deviceDisplayName: 'Owner Mac',
      }],
    })).toThrow();
  });

  it('rejects a bootstrap stock check that references a missing SKU', () => {
    const bootstrap = parseCoreBootstrap(bootstrapBody('1', {
      stockChecks: [{
        id: '11111111-1111-4111-8111-111111111111',
        skuId: '22222222-2222-4222-8222-222222222222',
        observedQuantityPcs: '1',
        countedQuantityPcs: '1',
        serverQuantityBeforePcs: '1',
        appliedDeltaPcs: '0',
        forcedOffline: false,
        countedAt: '2026-08-04T01:10:00.000Z',
        appliedAt: '2026-08-04T01:15:00.000Z',
        deviceId: '33333333-3333-4333-8333-333333333333',
        deviceDisplayName: 'Owner Mac',
      }],
    }));

    expect(() => mapCoreBootstrapToDemoState(bootstrap)).toThrow(
      'references a missing SKU',
    );
  });

  it('moves a reassigned package barcode between SKU projections by identifier id', () => {
    const state = mapCoreBootstrapToDemoState(
      parseCoreBootstrap(bootstrapBody('1', {
        skus: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            primaryIdentifier: 'SKU-1',
            name: 'Satu',
            priceRupiah: '1',
            rowVersion: '1',
            archivedAt: null,
            createdAt: '2026-08-04T01:00:00.000Z',
            updatedAt: '2026-08-04T01:00:00.000Z',
          },
          {
            id: '33333333-3333-4333-8333-333333333333',
            primaryIdentifier: 'SKU-2',
            name: 'Dua',
            priceRupiah: '1',
            rowVersion: '1',
            archivedAt: null,
            createdAt: '2026-08-04T01:00:00.000Z',
            updatedAt: '2026-08-04T01:00:00.000Z',
          },
        ],
      })),
    );
    const source = state.skus[0]!;
    const target = state.skus[1]!;
    const identifier = {
      id: '11111111-1111-4111-8111-111111111111',
      skuId: source.id,
      value: '8990001234567',
      kind: 'package_barcode' as const,
      createdAt: '2026-08-04T01:00:00.000Z',
    };
    state.skus[0] = {
      ...source,
      aliases: [identifier.value],
      identifiers: [identifier],
    };

    const next = applyCoreChange(state, {
      revision: '2',
      entityType: 'sku_identifier',
      entityId: identifier.id,
      operation: 'upsert',
      payload: {
        id: identifier.id,
        skuId: target.id,
        identifierValue: identifier.value,
        identifierKind: 'package_barcode',
        createdAt: identifier.createdAt,
      },
      createdAt: '2026-08-04T01:05:00.000Z',
    });

    expect(next.skus[0]?.identifiers).toEqual([]);
    expect(next.skus[0]?.aliases).toEqual([]);
    expect(next.skus[1]?.identifiers).toEqual([
      expect.objectContaining({ id: identifier.id, skuId: target.id }),
    ]);
  });
});
