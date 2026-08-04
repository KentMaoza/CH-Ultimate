import { noteSuffixFromIndex } from '../domain/nota';
import type { DemoState, Nota, NotaLine, StockCheck } from '../domain/types';
import {
  CoreApiSchemaError,
  type CoreBootstrap,
} from './core-api-types';
import { cloneCore } from './core-cache';
import {
  invoiceTemplateSchema,
  labelTemplateSchema,
} from './core-domain-schemas';
import {
  CORE_INVOICE_TEMPLATE_DEFAULT,
  CORE_LABEL_TEMPLATE_DEFAULT,
} from './core-presentation-defaults';

export function integerFromDecimal(value: string, field: string): number {
  const result = Number(BigInt(value));
  if (!Number.isSafeInteger(result)) {
    throw new CoreApiSchemaError(`${field} exceeds the renderer integer range`);
  }
  return result;
}

export function safeIntegerProduct(
  value: number,
  multiplier: number,
  field: string,
): number {
  return integerFromDecimal(
    (BigInt(value) * BigInt(multiplier)).toString(),
    field,
  );
}

export function mapCoreStockCheckRow(
  row: CoreBootstrap['stockChecks'][number],
): StockCheck {
  return {
    id: row.id,
    skuId: row.skuId,
    observedQuantityPcs: integerFromDecimal(
      row.observedQuantityPcs,
      'observedQuantityPcs',
    ),
    countedQuantityPcs: integerFromDecimal(
      row.countedQuantityPcs,
      'countedQuantityPcs',
    ),
    serverQuantityBeforePcs: integerFromDecimal(
      row.serverQuantityBeforePcs,
      'serverQuantityBeforePcs',
    ),
    appliedDeltaPcs: integerFromDecimal(
      row.appliedDeltaPcs,
      'appliedDeltaPcs',
    ),
    ...(row.baseBalanceVersion
      ? { baseBalanceVersion: row.baseBalanceVersion }
      : {}),
    forcedOffline: row.forcedOffline,
    countedAt: row.countedAt,
    appliedAt: row.appliedAt,
    deviceId: row.deviceId,
    deviceDisplayName: row.deviceDisplayName,
    ...(row.note ? { note: row.note } : {}),
  };
}

function safeIntegerIncrement(value: number, field: string): number {
  return integerFromDecimal((BigInt(value) + 1n).toString(), field);
}

function requireRelation(condition: boolean, message: string): void {
  if (!condition) throw new CoreApiSchemaError(message);
}

export function emptyCoreState(): DemoState {
  return {
    skus: [],
    adjustments: [],
    stockChecks: [],
    priceChanges: [],
    notaTransactions: [],
    notaPostings: [],
    revenuePostings: [],
    labelTemplate: cloneCore(CORE_LABEL_TEMPLATE_DEFAULT),
    invoiceTemplate: cloneCore(CORE_INVOICE_TEMPLATE_DEFAULT),
    sourceLabel: 'CH Core',
  };
}

export function blankCoreLine(pageId: string, position: number): NotaLine {
  return {
    id: `empty-${pageId}-${position}`,
    description: '',
    kind: '',
    quantity: 0,
    unit: 'pcs',
    pcsPrice: 0,
    lsnPrice: 0,
  };
}

export function mapCorePostingLine(
  line: CoreBootstrap['notaPostings'][number]['snapshot']['lines'][number],
): NotaLine {
  const quantityPcs = integerFromDecimal(line.quantityPcs, 'quantityPcs');
  return {
    id: line.id,
    ...(line.skuId ? { skuId: line.skuId } : {}),
    description: line.skuNameSnapshot,
    kind: line.kindSnapshot,
    quantity: line.unitKind === 'lsn' ? quantityPcs / 12 : quantityPcs,
    unit: line.unitKind,
    pcsPrice: integerFromDecimal(line.pcsPriceRupiah, 'pcsPriceRupiah'),
    lsnPrice: integerFromDecimal(line.lsnPriceRupiah, 'lsnPriceRupiah'),
  };
}

export function mapCoreBootstrapToDemoState(
  bootstrap: CoreBootstrap,
): DemoState {
  /*
   * Authoritative mapping:
   * - SKU + identifier + balance rows become SKU fields, aliases, and stock.
   * - Nota header/page/line rows become transactions and 15 renderer slots;
   *   blank slots are presentation controls, not seeded business records.
   * - Stock movements and price history become the renderer audit lists.
   * - Missing label/invoice rows retain only the neutral defaults above.
   */
  const state = emptyCoreState();
  const skuIds = new Set(bootstrap.skus.map((sku) => sku.id));
  const notaIds = new Set(bootstrap.notas.map((nota) => nota.id));
  const pageOwners = new Map<string, string>();
  for (const page of bootstrap.notaPages) {
    requireRelation(
      notaIds.has(page.notaId),
      `Nota page ${page.id} references a missing Nota`,
    );
    requireRelation(
      !pageOwners.has(page.id),
      `Nota page ${page.id} is duplicated`,
    );
    pageOwners.set(page.id, page.notaId);
  }
  for (const identifier of bootstrap.skuIdentifiers) {
    requireRelation(
      skuIds.has(identifier.skuId),
      `SKU identifier ${identifier.id} references a missing SKU`,
    );
  }
  for (const balance of bootstrap.balances) {
    requireRelation(
      skuIds.has(balance.skuId),
      `Balance ${balance.skuId} references a missing SKU`,
    );
  }
  for (const stockCheck of bootstrap.stockChecks) {
    requireRelation(
      skuIds.has(stockCheck.skuId),
      `Stock check ${stockCheck.id} references a missing SKU`,
    );
  }
  for (const line of bootstrap.notaLines) {
    requireRelation(
      pageOwners.get(line.pageId) === line.notaId,
      `Nota line ${line.id} does not match its page owner`,
    );
    requireRelation(
      line.skuId === null || skuIds.has(line.skuId),
      `Nota line ${line.id} references a missing SKU`,
    );
  }
  const postingIds = new Set(bootstrap.notaPostings.map((row) => row.id));
  for (const posting of bootstrap.notaPostings) {
    requireRelation(
      notaIds.has(posting.notaId),
      `Nota posting ${posting.id} references a missing Nota`,
    );
    for (const line of posting.snapshot.lines) {
      requireRelation(
        line.skuId === null || skuIds.has(line.skuId),
        `Nota posting ${posting.id} references a missing SKU`,
      );
    }
  }
  for (const posting of bootstrap.revenuePostings) {
    requireRelation(
      notaIds.has(posting.notaId) && postingIds.has(posting.notaPostingId),
      `Revenue posting ${posting.id} references a missing posting`,
    );
  }
  const identifiers = new Map<string, CoreBootstrap['skuIdentifiers']>();
  for (const identifier of bootstrap.skuIdentifiers) {
    const values = identifiers.get(identifier.skuId) ?? [];
    values.push(identifier);
    identifiers.set(identifier.skuId, values);
  }
  const balances = new Map(
    bootstrap.balances.map((balance) => [
      balance.skuId,
      balance,
    ]),
  );
  state.skus = bootstrap.skus.map((row) => ({
    id: row.id,
    skuNumber: row.primaryIdentifier,
    aliases: (identifiers.get(row.id) ?? []).filter(
      (identifier) => identifier.identifierValue !== row.primaryIdentifier,
    ).map((identifier) => identifier.identifierValue),
    identifiers: (identifiers.get(row.id) ?? []).map((identifier) => ({
      id: identifier.id,
      skuId: identifier.skuId,
      value: identifier.identifierValue,
      kind: identifier.identifierKind,
      createdAt: identifier.createdAt,
    })),
    name: row.name,
    referencePrice: integerFromDecimal(row.priceRupiah, 'priceRupiah'),
    stock: balances.has(row.id)
      ? integerFromDecimal(balances.get(row.id)!.quantityPcs, 'quantityPcs')
      : 0,
    tracked: balances.has(row.id),
    note: row.sourceNote ?? '',
    imageUrl: '',
    ...(row.imageHash ? { imageHash: row.imageHash } : {}),
    sourceImageUrl: row.sourceImageUrl ?? null,
    ...(row.sourceCreatedAt
      ? { sourceCreatedAt: row.sourceCreatedAt }
      : {}),
    createdAt: row.createdAt,
    archived: row.archivedAt !== null,
    ...(balances.get(row.id)?.lastCheckedAt
      ? { lastStockCheckedAt: balances.get(row.id)!.lastCheckedAt! }
      : {}),
  }));
  const previousPrices = new Map<string, number>();
  state.priceChanges = [...bootstrap.priceHistory]
    .sort((left, right) => left.effectiveAt.localeCompare(right.effectiveAt))
    .map((row) => {
      const after = integerFromDecimal(row.priceRupiah, 'priceRupiah');
      const before = row.beforePriceRupiah
        ? integerFromDecimal(row.beforePriceRupiah, 'beforePriceRupiah')
        : previousPrices.get(row.skuId) ?? after;
      previousPrices.set(row.skuId, after);
      return {
        id: row.id,
        skuId: row.skuId,
        before,
        after,
        createdAt: row.effectiveAt,
        source: row.source === 'catalogue_import'
          ? 'catalogue_import' as const
          : row.source === 'manual'
            ? 'manual' as const
            : 'other' as const,
      };
    });
  const runningBalances = new Map(
    [...balances].map(([skuId, balance]) => [
      skuId,
      integerFromDecimal(balance.quantityPcs, 'quantityPcs'),
    ]),
  );
  state.adjustments = [...bootstrap.stockMovements]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((row) => {
      const quantity = integerFromDecimal(row.deltaPcs, 'deltaPcs');
      const after = row.afterQuantityPcs
        ? integerFromDecimal(row.afterQuantityPcs, 'afterQuantityPcs')
        : runningBalances.get(row.skuId) ?? quantity;
      const before = row.beforeQuantityPcs
        ? integerFromDecimal(row.beforeQuantityPcs, 'beforeQuantityPcs')
        : after - quantity;
      runningBalances.set(row.skuId, before);
      return {
        id: row.id,
        skuId: row.skuId,
        quantity,
        before,
        after,
        createdAt: row.createdAt,
        source: row.reason.includes('reversal')
          ? ('reversal' as const)
          : row.reason.includes('nota')
            ? ('nota' as const)
            : row.reason === 'manual_adjustment'
              ? ('manual' as const)
              : row.reason === 'stock_check'
                ? ('stock-check' as const)
              : ('other' as const),
      };
    })
    .reverse();
  state.stockChecks = bootstrap.stockChecks.map(mapCoreStockCheckRow);

  const pagesByNota = new Map<string, CoreBootstrap['notaPages']>();
  for (const page of bootstrap.notaPages) {
    const pages = pagesByNota.get(page.notaId) ?? [];
    pages.push(page);
    pagesByNota.set(page.notaId, pages);
  }
  const linesByPage = new Map<string, CoreBootstrap['notaLines']>();
  for (const line of bootstrap.notaLines) {
    if (line.deletedAt) continue;
    const lines = linesByPage.get(line.pageId) ?? [];
    lines.push(line);
    linesByPage.set(line.pageId, lines);
  }

  state.notaTransactions = bootstrap.notas.map((row) => {
    const pageRows = [...(pagesByNota.get(row.id) ?? [])].sort(
      (left, right) => left.pagePosition - right.pagePosition,
    );
    const pages: Nota[] = pageRows.map((page) => {
      const lines = Array.from({ length: 15 }, (_, position) =>
        blankCoreLine(page.id, position),
      );
      for (const line of linesByPage.get(page.id) ?? []) {
        const unitPrice = integerFromDecimal(
          line.unitPriceRupiah,
          'unitPriceRupiah',
        );
        const quantityPcs = integerFromDecimal(
          line.quantityPcs,
          'quantityPcs',
        );
        const pcsPrice = line.pcsPriceRupiah
          ? integerFromDecimal(line.pcsPriceRupiah, 'pcsPriceRupiah')
          : line.unitKind === 'pcs'
            ? unitPrice
            : Math.floor(unitPrice / 12);
        const lsnPrice = line.lsnPriceRupiah
          ? integerFromDecimal(line.lsnPriceRupiah, 'lsnPriceRupiah')
          : line.unitKind === 'lsn'
            ? unitPrice
            : safeIntegerProduct(unitPrice, 12, 'lsnPrice');
        lines[line.linePosition] = {
          id: line.id,
          ...(line.skuId ? { skuId: line.skuId } : {}),
          description: line.skuNameSnapshot,
          kind: line.kindSnapshot,
          quantity: line.unitKind === 'lsn' ? quantityPcs / 12 : quantityPcs,
          unit: line.unitKind,
          pcsPrice,
          lsnPrice,
        };
      }
      return {
        id: page.id,
        suffix: noteSuffixFromIndex(page.pagePosition),
        status: page.status,
        lines,
      };
    });
    const maxPage = pageRows.reduce(
      (maximum, page) => Math.max(maximum, page.pagePosition),
      -1,
    );
    const latestPosting = [...bootstrap.notaPostings]
      .filter((posting) =>
        posting.notaId === row.id &&
        ['complete', 'recomplete', 'restore'].includes(posting.postingKind))
      .sort((left, right) =>
        BigInt(left.lifecycleVersion) < BigInt(right.lifecycleVersion) ? 1 : -1)
      .at(0);
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
      nextNoteIndex: safeIntegerIncrement(maxPage, 'nextNoteIndex'),
      pages,
      postedLines: latestPosting?.snapshot.lines.map(mapCorePostingLine) ?? [],
      postedStockEffects: Object.fromEntries(
        Object.entries(latestPosting?.snapshot.stockEffects ?? {}).map(
          ([skuId, quantity]) => [
            skuId,
            -integerFromDecimal(quantity, 'stockEffect'),
          ],
        ),
      ),
      postedTrackedLineIds: latestPosting?.snapshot.trackedLineIds ?? {},
    };
  });
  state.notaPostings = bootstrap.notaPostings.map((row) => ({
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
  }));
  state.revenuePostings = bootstrap.revenuePostings.map((row) => ({
    id: row.id,
    notaId: row.notaId,
    notaPostingId: row.notaPostingId,
    amountRupiah: integerFromDecimal(row.amountRupiah, 'amountRupiah'),
    postingKind: row.postingKind,
    postedAt: row.postedAt,
  }));

  const activeTemplates = bootstrap.templates.filter(
    (template) => !template.archivedAt,
  );
  for (const kind of ['label', 'invoice']) {
    if (
      activeTemplates.filter((template) => template.templateKind === kind)
        .length > 1
    ) {
      throw new CoreApiSchemaError(
        `Multiple active CH Core ${kind} templates`,
      );
    }
  }
  for (const template of activeTemplates) {
    if (template.templateKind === 'label') {
      const parsed = labelTemplateSchema.safeParse(template.definition);
      if (!parsed.success) {
        throw new CoreApiSchemaError(
          'Invalid CH Core label template definition',
          parsed.error,
        );
      }
      state.labelTemplate = parsed.data;
    }
    if (template.templateKind === 'invoice') {
      const parsed = invoiceTemplateSchema.safeParse(template.definition);
      if (!parsed.success) {
        throw new CoreApiSchemaError(
          'Invalid CH Core invoice template definition',
          parsed.error,
        );
      }
      state.invoiceTemplate = parsed.data;
    }
    if (!['label', 'invoice'].includes(template.templateKind)) {
      throw new CoreApiSchemaError(
        `Unknown CH Core template kind ${template.templateKind}`,
      );
    }
  }
  return state;
}
