import { noteSuffixFromIndex } from '../domain/nota';
import type {
  DemoState,
  Nota,
  NotaTransaction,
} from '../domain/types';
import {
  coreNotaLineRowSchema,
  coreNotaPageRowSchema,
  coreNotaRowSchema,
  coreTemplateRowSchema,
  type CoreChange,
} from './core-api-types';
import {
  blankCoreLine,
  integerFromDecimal,
} from './core-bootstrap-mapping';
import {
  invoiceTemplateSchema,
  labelTemplateSchema,
} from './core-domain-schemas';

export class CoreChangeRequiresBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreChangeRequiresBootstrapError';
  }
}

function requireIdentity(change: CoreChange, payloadId: string): void {
  if (payloadId !== change.entityId) {
    throw new CoreChangeRequiresBootstrapError(
      `Change identity mismatch for ${change.entityType}`,
    );
  }
}

function notaFromRow(
  row: ReturnType<typeof coreNotaRowSchema.parse>,
  current?: NotaTransaction,
): NotaTransaction {
  return {
    id: row.id,
    baseNumber: row.notaNumber,
    customerName: row.header.customerName ?? '',
    customerPlace: row.header.customerPlace ?? '',
    transactionDate: row.header.transactionDate ?? row.businessDate,
    payment: row.header.payment ?? 'unclassified',
    status: row.status,
    ...(row.header.completionDestination
      ? { completionDestination: row.header.completionDestination }
      : {}),
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    nextNoteIndex: current?.nextNoteIndex ?? 0,
    pages: current?.pages ?? [],
    postedLines: current?.postedLines ?? [],
    postedStockEffects: current?.postedStockEffects ?? {},
    postedTrackedLineIds: current?.postedTrackedLineIds ?? {},
  };
}

export function applyNotaChange(
  state: DemoState,
  change: CoreChange,
): DemoState {
  if (change.operation === 'delete') {
    return {
      ...state,
      notaTransactions: state.notaTransactions.filter(
        (nota) => nota.id !== change.entityId,
      ),
    };
  }
  if (change.operation !== 'upsert') {
    throw new CoreChangeRequiresBootstrapError('Unknown Nota operation');
  }
  const row = coreNotaRowSchema.parse(change.payload);
  requireIdentity(change, row.id);
  const current = state.notaTransactions.find((nota) => nota.id === row.id);
  const next = notaFromRow(row, current);
  return {
    ...state,
    notaTransactions: current
      ? state.notaTransactions.map((nota) =>
          nota.id === row.id ? next : nota,
        )
      : [...state.notaTransactions, next],
  };
}

export function applyNotaPageChange(
  state: DemoState,
  change: CoreChange,
): DemoState {
  if (!['upsert', 'delete'].includes(change.operation)) {
    throw new CoreChangeRequiresBootstrapError('Unknown Nota page operation');
  }
  const row = coreNotaPageRowSchema.parse(change.payload);
  requireIdentity(change, row.id);
  return {
    ...state,
    notaTransactions: state.notaTransactions.map((nota) => {
      if (nota.id !== row.notaId) return nota;
      const without = nota.pages.filter((page) => page.id !== row.id);
      if (change.operation === 'delete') return { ...nota, pages: without };
      const existing = nota.pages.find((page) => page.id === row.id);
      const page: Nota = {
        id: row.id,
        suffix: noteSuffixFromIndex(row.pagePosition),
        status: existing?.status ?? 'active',
        lines:
          existing?.lines ??
          Array.from({ length: 15 }, (_, position) =>
            blankCoreLine(row.id, position),
          ),
      };
      return {
        ...nota,
        pages: [...without, page].sort((left, right) =>
          left.suffix.localeCompare(right.suffix),
        ),
        nextNoteIndex: Math.max(nota.nextNoteIndex, row.pagePosition + 1),
      };
    }),
  };
}

export function applyNotaLineChange(
  state: DemoState,
  change: CoreChange,
): DemoState {
  if (!['upsert', 'delete'].includes(change.operation)) {
    throw new CoreChangeRequiresBootstrapError('Unknown Nota line operation');
  }
  const row = coreNotaLineRowSchema.parse(change.payload);
  requireIdentity(change, row.id);
  return {
    ...state,
    notaTransactions: state.notaTransactions.map((nota) => {
      if (nota.id !== row.notaId) return nota;
      return {
        ...nota,
        pages: nota.pages.map((page) => {
          if (page.id !== row.pageId) return page;
          const lines = [...page.lines];
          if (change.operation === 'delete' || row.deletedAt) {
            lines[row.linePosition] = blankCoreLine(
              page.id,
              row.linePosition,
            );
          } else {
            const price = integerFromDecimal(
              row.unitPriceRupiah,
              'unitPriceRupiah',
            );
            lines[row.linePosition] = {
              id: row.id,
              ...(row.skuId ? { skuId: row.skuId } : {}),
              description: row.skuNameSnapshot,
              kind: '',
              quantity: integerFromDecimal(row.quantityPcs, 'quantityPcs'),
              unit: 'pcs',
              pcsPrice: price,
              lsnPrice: price * 12,
            };
          }
          return { ...page, lines };
        }),
      };
    }),
  };
}

export function applyTemplateChange(
  state: DemoState,
  change: CoreChange,
): DemoState {
  if (change.operation !== 'upsert') {
    throw new CoreChangeRequiresBootstrapError('Unknown template operation');
  }
  const row = coreTemplateRowSchema.parse(change.payload);
  requireIdentity(change, row.id);
  if (row.archivedAt) return state;
  if (row.templateKind === 'label') {
    return {
      ...state,
      labelTemplate: labelTemplateSchema.parse(row.definition),
    };
  }
  if (row.templateKind === 'invoice') {
    return {
      ...state,
      invoiceTemplate: invoiceTemplateSchema.parse(row.definition),
    };
  }
  throw new CoreChangeRequiresBootstrapError('Unknown template kind');
}
