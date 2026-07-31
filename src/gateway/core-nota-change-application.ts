import { noteSuffixFromIndex } from '../domain/nota';
import type {
  DemoState,
  Nota,
  NotaTransaction,
} from '../domain/types';
import {
  coreNotaLineRowSchema,
  coreNotaPageRowSchema,
  coreNotaPostingRowSchema,
  coreNotaRowSchema,
  coreRevenuePostingRowSchema,
  coreTemplateRowSchema,
  type CoreChange,
} from './core-api-types';
import {
  blankCoreLine,
  integerFromDecimal,
  mapCorePostingLine,
  safeIntegerProduct,
} from './core-bootstrap-mapping';

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
    ...(row.completionDestination
      ? { completionDestination: row.completionDestination }
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
  const owner = state.notaTransactions.find(
    (nota) => nota.id === row.notaId,
  );
  const existingOwner = state.notaTransactions.find((nota) =>
    nota.pages.some((page) => page.id === row.id),
  );
  if (!owner || (existingOwner && existingOwner.id !== row.notaId)) {
    throw new CoreChangeRequiresBootstrapError(
      'Nota page does not match an existing Nota',
    );
  }
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
        status: row.status,
        lines:
          existing?.lines ??
          Array.from({ length: 15 }, (_, position) =>
            blankCoreLine(row.id, position),
          ),
      };
      return {
        ...nota,
        pages: [...without, page].sort(
          (left, right) =>
            noteIndexFromSuffix(left.suffix) -
            noteIndexFromSuffix(right.suffix),
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
  const owner = state.notaTransactions.find(
    (nota) => nota.id === row.notaId,
  );
  const page = owner?.pages.find((candidate) => candidate.id === row.pageId);
  const existingOwner = state.notaTransactions.find((nota) =>
    nota.pages.some((candidate) =>
      candidate.lines.some((line) => line.id === row.id),
    ),
  );
  if (
    !owner ||
    !page ||
    (existingOwner && existingOwner.id !== row.notaId) ||
    (row.skuId && !state.skus.some((sku) => sku.id === row.skuId))
  ) {
    throw new CoreChangeRequiresBootstrapError(
      'Nota line does not match its related entities',
    );
  }
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
            const quantityPcs = integerFromDecimal(
              row.quantityPcs,
              'quantityPcs',
            );
            const pcsPrice = row.pcsPriceRupiah
              ? integerFromDecimal(row.pcsPriceRupiah, 'pcsPriceRupiah')
              : row.unitKind === 'pcs'
                ? price
                : Math.floor(price / 12);
            const lsnPrice = row.lsnPriceRupiah
              ? integerFromDecimal(row.lsnPriceRupiah, 'lsnPriceRupiah')
              : row.unitKind === 'lsn'
                ? price
                : safeIntegerProduct(price, 12, 'lsnPrice');
            lines[row.linePosition] = {
              id: row.id,
              ...(row.skuId ? { skuId: row.skuId } : {}),
              description: row.skuNameSnapshot,
              kind: row.kindSnapshot,
              quantity: row.unitKind === 'lsn' ? quantityPcs / 12 : quantityPcs,
              unit: row.unitKind,
              pcsPrice,
              lsnPrice,
            };
          }
          return { ...page, lines };
        }),
      };
    }),
  };
}

export function applyNotaPostingChange(
  state: DemoState,
  change: CoreChange,
): DemoState {
  if (change.operation !== 'upsert') {
    throw new CoreChangeRequiresBootstrapError('Unknown Nota posting operation');
  }
  const row = coreNotaPostingRowSchema.parse(change.payload);
  requireIdentity(change, row.id);
  if (
    !state.notaTransactions.some((nota) => nota.id === row.notaId) ||
    row.snapshot.lines.some(
      (line) => line.skuId && !state.skus.some((sku) => sku.id === line.skuId),
    )
  ) {
    throw new CoreChangeRequiresBootstrapError(
      'Nota posting does not match its related entities',
    );
  }
  const posting = {
    id: row.id,
    notaId: row.notaId,
    postingKind: row.postingKind,
    amountRupiah: integerFromDecimal(row.amountRupiah, 'amountRupiah'),
    lines: row.snapshot.lines.map(mapCorePostingLine),
    stockEffects: Object.fromEntries(
      Object.entries(row.snapshot.stockEffects).map(([skuId, quantity]) => [
        skuId,
        -integerFromDecimal(quantity, 'stockEffect'),
      ]),
    ),
    trackedLineIds: row.snapshot.trackedLineIds,
    lifecycleVersion: row.lifecycleVersion,
    ...(row.reversesPostingId
      ? { reversesPostingId: row.reversesPostingId }
      : {}),
    postedAt: row.postedAt,
  };
  const positive = ['complete', 'recomplete', 'restore'].includes(
    row.postingKind,
  );
  return {
    ...state,
    notaPostings: [
      ...(state.notaPostings ?? []).filter((item) => item.id !== row.id),
      posting,
    ],
    notaTransactions: positive
      ? state.notaTransactions.map((nota) =>
          nota.id === row.notaId
            ? {
                ...nota,
                postedLines: posting.lines,
                postedStockEffects: posting.stockEffects,
                postedTrackedLineIds: posting.trackedLineIds,
              }
            : nota)
      : state.notaTransactions,
  };
}

export function applyRevenuePostingChange(
  state: DemoState,
  change: CoreChange,
): DemoState {
  if (change.operation !== 'upsert') {
    throw new CoreChangeRequiresBootstrapError('Unknown revenue posting operation');
  }
  const row = coreRevenuePostingRowSchema.parse(change.payload);
  requireIdentity(change, row.id);
  if (
    !state.notaTransactions.some((nota) => nota.id === row.notaId) ||
    !(state.notaPostings ?? []).some(
      (posting) => posting.id === row.notaPostingId,
    )
  ) {
    throw new CoreChangeRequiresBootstrapError(
      'Revenue posting does not match its Nota posting',
    );
  }
  return {
    ...state,
    revenuePostings: [
      ...(state.revenuePostings ?? []).filter((item) => item.id !== row.id),
      {
        id: row.id,
        notaId: row.notaId,
        notaPostingId: row.notaPostingId,
        amountRupiah: integerFromDecimal(row.amountRupiah, 'amountRupiah'),
        postingKind: row.postingKind,
        postedAt: row.postedAt,
      },
    ],
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
  throw new CoreChangeRequiresBootstrapError(
    `Template ${row.templateKind} change requires a full bootstrap`,
  );
}

function noteIndexFromSuffix(suffix: string): number {
  let value = 0;
  for (const character of suffix) {
    value = value * 26 + character.charCodeAt(0) - 64;
  }
  return value - 1;
}
