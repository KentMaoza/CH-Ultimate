import { noteSuffixFromIndex } from '../domain/nota';
import type { DemoState, Nota, NotaLine } from '../domain/types';
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
    priceChanges: [],
    notaTransactions: [],
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

export function mapCoreBootstrapToDemoState(
  bootstrap: CoreBootstrap,
): DemoState {
  /*
   * HEAD mapping:
   * - SKU + identifier + balance rows become SKU fields, aliases, and stock.
   * - Nota header/page/line rows become transactions and 15 renderer slots;
   *   blank slots are presentation controls, not seeded business records.
   * - The current API has no stock/price history or posting collections, so
   *   adjustments, priceChanges, and posting snapshots remain empty.
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
  const identifiers = new Map<string, string[]>();
  for (const identifier of bootstrap.skuIdentifiers) {
    const values = identifiers.get(identifier.skuId) ?? [];
    values.push(identifier.identifierValue);
    identifiers.set(identifier.skuId, values);
  }
  const balances = new Map(
    bootstrap.balances.map((balance) => [
      balance.skuId,
      integerFromDecimal(balance.quantityPcs, 'quantityPcs'),
    ]),
  );
  state.skus = bootstrap.skus.map((row) => ({
    id: row.id,
    skuNumber: row.primaryIdentifier,
    aliases: (identifiers.get(row.id) ?? []).filter(
      (value) => value !== row.primaryIdentifier,
    ),
    name: row.name,
    referencePrice: integerFromDecimal(row.priceRupiah, 'priceRupiah'),
    stock: balances.get(row.id) ?? 0,
    tracked: balances.has(row.id),
    note: '',
    imageUrl: '',
    createdAt: row.createdAt,
    archived: row.archivedAt !== null,
  }));

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
        lines[line.linePosition] = {
          id: line.id,
          ...(line.skuId ? { skuId: line.skuId } : {}),
          description: line.skuNameSnapshot,
          kind: '',
          quantity: integerFromDecimal(line.quantityPcs, 'quantityPcs'),
          unit: 'pcs',
          pcsPrice: unitPrice,
          lsnPrice: safeIntegerProduct(unitPrice, 12, 'lsnPrice'),
        };
      }
      return {
        id: page.id,
        suffix: noteSuffixFromIndex(page.pagePosition),
        status: 'active',
        lines,
      };
    });
    const maxPage = pageRows.reduce(
      (maximum, page) => Math.max(maximum, page.pagePosition),
      -1,
    );
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
      nextNoteIndex: safeIntegerIncrement(maxPage, 'nextNoteIndex'),
      pages,
      postedLines: [],
      postedStockEffects: {},
      postedTrackedLineIds: {},
    };
  });

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
