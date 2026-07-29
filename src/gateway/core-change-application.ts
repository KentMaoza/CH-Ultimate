import type { DemoState, Sku } from '../domain/types';
import {
  coreBalanceRowSchema,
  coreSkuIdentifierRowSchema,
  coreSkuRowSchema,
  type CoreChange,
} from './core-api-types';
import { integerFromDecimal } from './core-bootstrap-mapping';
import {
  applyNotaChange,
  applyNotaLineChange,
  applyNotaPageChange,
  applyTemplateChange,
  CoreChangeRequiresBootstrapError,
} from './core-nota-change-application';

function requireIdentity(change: CoreChange, payloadId: string): void {
  if (payloadId !== change.entityId) {
    throw new CoreChangeRequiresBootstrapError(
      `Change identity mismatch for ${change.entityType}`,
    );
  }
}

function applySku(state: DemoState, change: CoreChange): DemoState {
  if (change.operation === 'delete') {
    return {
      ...state,
      skus: state.skus.filter((sku) => sku.id !== change.entityId),
    };
  }
  if (change.operation !== 'upsert') {
    throw new CoreChangeRequiresBootstrapError('Unknown SKU operation');
  }
  const row = coreSkuRowSchema.parse(change.payload);
  requireIdentity(change, row.id);
  const current = state.skus.find((sku) => sku.id === row.id);
  const next: Sku = {
    id: row.id,
    skuNumber: row.primaryIdentifier,
    aliases: current?.aliases ?? [],
    name: row.name,
    referencePrice: integerFromDecimal(row.priceRupiah, 'priceRupiah'),
    stock: current?.stock ?? 0,
    tracked: current?.tracked ?? false,
    note: current?.note ?? '',
    imageUrl: current?.imageUrl ?? '',
    createdAt: row.createdAt,
    archived: row.archivedAt !== null,
  };
  return {
    ...state,
    skus: current
      ? state.skus.map((sku) => (sku.id === row.id ? next : sku))
      : [...state.skus, next],
  };
}

function applyIdentifier(state: DemoState, change: CoreChange): DemoState {
  if (!['upsert', 'delete'].includes(change.operation)) {
    throw new CoreChangeRequiresBootstrapError('Unknown identifier operation');
  }
  const row = coreSkuIdentifierRowSchema.parse(change.payload);
  requireIdentity(change, row.id);
  return {
    ...state,
    skus: state.skus.map((sku) => {
      if (sku.id !== row.skuId || row.identifierValue === sku.skuNumber) {
        return sku;
      }
      const aliases =
        change.operation === 'delete'
          ? sku.aliases.filter((alias) => alias !== row.identifierValue)
          : [...new Set([...sku.aliases, row.identifierValue])];
      return { ...sku, aliases };
    }),
  };
}

function applyBalance(state: DemoState, change: CoreChange): DemoState {
  if (change.operation !== 'upsert') {
    throw new CoreChangeRequiresBootstrapError('Unknown balance operation');
  }
  const row = coreBalanceRowSchema.parse(change.payload);
  requireIdentity(change, row.skuId);
  return {
    ...state,
    skus: state.skus.map((sku) =>
      sku.id === row.skuId
        ? {
            ...sku,
            stock: integerFromDecimal(row.quantityPcs, 'quantityPcs'),
            tracked: true,
          }
        : sku,
    ),
  };
}

export function applyCoreChange(
  state: DemoState,
  change: CoreChange,
): DemoState {
  if (change.entityType === 'device') {
    if (!['upsert', 'revoke'].includes(change.operation)) {
      throw new CoreChangeRequiresBootstrapError('Unknown device operation');
    }
    return state;
  }
  if (change.entityType === 'pairing') {
    if (change.operation !== 'upsert') {
      throw new CoreChangeRequiresBootstrapError('Unknown pairing operation');
    }
    return state;
  }
  if (change.entityType === 'sku') return applySku(state, change);
  if (change.entityType === 'sku_identifier') {
    return applyIdentifier(state, change);
  }
  if (['balance', 'stock_balance'].includes(change.entityType)) {
    return applyBalance(state, change);
  }
  if (change.entityType === 'nota') return applyNotaChange(state, change);
  if (change.entityType === 'nota_page') {
    return applyNotaPageChange(state, change);
  }
  if (change.entityType === 'nota_line') {
    return applyNotaLineChange(state, change);
  }
  if (change.entityType === 'template') {
    return applyTemplateChange(state, change);
  }
  throw new CoreChangeRequiresBootstrapError(
    `Unknown change entity ${change.entityType}`,
  );
}

export { CoreChangeRequiresBootstrapError };
