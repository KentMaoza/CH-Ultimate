import { z } from 'zod';

export const CORE_API_SCHEMA_VERSION = 1;

export const canonicalDecimalSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, 'Expected a canonical unsigned decimal string');
const isoTimestampSchema = z.string().datetime({ offset: true });
const uuidSchema = z.string().uuid();

export type CoreJsonValue =
  | null
  | string
  | number
  | boolean
  | CoreJsonValue[]
  | { [key: string]: CoreJsonValue };

export const coreJsonValueSchema: z.ZodType<CoreJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.array(coreJsonValueSchema),
    z.record(z.string(), coreJsonValueSchema),
  ]),
);

const apiSchemaMarker = {
  apiSchemaVersion: z.literal(CORE_API_SCHEMA_VERSION).optional(),
};

export const coreSkuIdentifierRowSchema = z
  .object({
    id: uuidSchema,
    skuId: uuidSchema,
    identifierValue: z.string(),
    identifierKind: z.string(),
    createdAt: isoTimestampSchema,
  })
  .strict();

export const coreSkuRowSchema = z
  .object({
    id: uuidSchema,
    primaryIdentifier: z.string(),
    name: z.string(),
    priceRupiah: canonicalDecimalSchema,
    imageHash: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
    sourceImageUrl: z.string().url().nullable().optional(),
    sourceNote: z.string().optional(),
    sourceCreatedAt: z.string().optional(),
    rowVersion: canonicalDecimalSchema,
    archivedAt: isoTimestampSchema.nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const coreBalanceRowSchema = z
  .object({
    skuId: uuidSchema,
    quantityPcs: z
      .string()
      .regex(/^(0|-?[1-9]\d*)$/, 'Expected a canonical signed decimal string'),
    rowVersion: canonicalDecimalSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const corePriceHistoryRowSchema = z
  .object({
    id: uuidSchema,
    skuId: uuidSchema,
    priceRupiah: canonicalDecimalSchema,
    source: z.string(),
    changedByDeviceId: uuidSchema.nullable(),
    effectiveAt: isoTimestampSchema,
    beforePriceRupiah: canonicalDecimalSchema.optional(),
  })
  .strict();

export const coreStockMovementRowSchema = z
  .object({
    id: uuidSchema,
    skuId: uuidSchema,
    deltaPcs: z
      .string()
      .regex(/^-?[1-9]\d*$/, 'Expected a nonzero signed decimal string'),
    reason: z.string(),
    deviceId: uuidSchema,
    operationId: uuidSchema.nullable(),
    createdAt: isoTimestampSchema,
    beforeQuantityPcs: z
      .string()
      .regex(/^(0|-?[1-9]\d*)$/)
      .optional(),
    afterQuantityPcs: z
      .string()
      .regex(/^(0|-?[1-9]\d*)$/)
      .optional(),
  })
  .strict();

const notaHeaderSchema = z
  .object({
    customerName: z.string().optional(),
    customerPlace: z.string().optional(),
    transactionDate: z.string().date().optional(),
    payment: z
      .enum(['unclassified', 'cash', 'transfer', 'credit'])
      .optional(),
    completionDestination: z.enum(['archive', 'finished']).optional(),
  })
  .catchall(coreJsonValueSchema);

export const coreNotaRowSchema = z
  .object({
    id: uuidSchema,
    notaNumber: z.string(),
    businessDate: z.string().date(),
    status: z.enum(['draft', 'completed', 'reopened', 'cancelled']),
    header: notaHeaderSchema,
    fieldVersions: z.record(z.string(), canonicalDecimalSchema),
    structureVersion: canonicalDecimalSchema,
    lifecycleVersion: canonicalDecimalSchema,
    subtotalRupiah: canonicalDecimalSchema,
    totalRupiah: canonicalDecimalSchema,
    createdByDeviceId: uuidSchema,
    completedAt: isoTimestampSchema.nullable(),
    cancelledAt: isoTimestampSchema.nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const coreNotaPageRowSchema = z
  .object({
    id: uuidSchema,
    notaId: uuidSchema,
    pagePosition: z.number().int().min(0),
    status: z.enum(['active', 'cancelled']).default('active'),
    rowVersion: canonicalDecimalSchema,
    lifecycleVersion: canonicalDecimalSchema.default('1'),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const coreNotaLineRowSchema = z
  .object({
    id: uuidSchema,
    notaId: uuidSchema,
    pageId: uuidSchema,
    skuId: uuidSchema.nullable(),
    linePosition: z.number().int().min(0).max(14),
    skuIdentifierSnapshot: z.string(),
    skuNameSnapshot: z.string(),
    kindSnapshot: z.string().default(''),
    quantityPcs: canonicalDecimalSchema,
    unitKind: z.enum(['pcs', 'lsn']).default('pcs'),
    unitPriceRupiah: canonicalDecimalSchema,
    pcsPriceRupiah: canonicalDecimalSchema.optional(),
    lsnPriceRupiah: canonicalDecimalSchema.optional(),
    lineTotalRupiah: canonicalDecimalSchema,
    rowVersion: canonicalDecimalSchema,
    deletedAt: isoTimestampSchema.nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const coreTemplateRowSchema = z
  .object({
    id: uuidSchema,
    templateKind: z.string(),
    name: z.string(),
    definition: coreJsonValueSchema,
    rowVersion: canonicalDecimalSchema,
    archivedAt: isoTimestampSchema.nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const coreBootstrapSchema = z
  .object({
    ...apiSchemaMarker,
    serverRevision: canonicalDecimalSchema,
    deviceRole: z.enum(['owner', 'client']),
    skuIdentifiers: z.array(coreSkuIdentifierRowSchema),
    skus: z.array(coreSkuRowSchema),
    balances: z.array(coreBalanceRowSchema),
    priceHistory: z.array(corePriceHistoryRowSchema).default([]),
    stockMovements: z.array(coreStockMovementRowSchema).default([]),
    notas: z.array(coreNotaRowSchema),
    notaPages: z.array(coreNotaPageRowSchema),
    notaLines: z.array(coreNotaLineRowSchema),
    templates: z.array(coreTemplateRowSchema),
  })
  .strict();

export const coreChangeSchema = z
  .object({
    revision: canonicalDecimalSchema,
    entityType: z.string().min(1),
    entityId: uuidSchema,
    operation: z.string().min(1),
    payload: coreJsonValueSchema,
    createdAt: isoTimestampSchema,
  })
  .strict();

export const coreChangePageSchema = z
  .object({
    ...apiSchemaMarker,
    serverRevision: canonicalDecimalSchema,
    nextAfter: canonicalDecimalSchema,
    changes: z.array(coreChangeSchema),
  })
  .strict()
  .superRefine((page, context) => {
    let prior = -1n;
    for (const [index, change] of page.changes.entries()) {
      const revision = BigInt(change.revision);
      if (revision <= prior) {
        context.addIssue({
          code: 'custom',
          path: ['changes', index, 'revision'],
          message: 'Change revisions must be strictly ascending',
        });
      }
      prior = revision;
    }
    if (BigInt(page.nextAfter) > BigInt(page.serverRevision)) {
      context.addIssue({
        code: 'custom',
        path: ['nextAfter'],
        message: 'nextAfter cannot exceed serverRevision',
      });
    }
  });

export const mutationAcknowledgementSchema = z
  .object({
    ...apiSchemaMarker,
    serverRevision: canonicalDecimalSchema.optional(),
    entity: coreJsonValueSchema.optional(),
    entityVersion: canonicalDecimalSchema.optional(),
    entityId: uuidSchema.optional(),
  })
  .strict();

export const uuidSchemaForErrors = uuidSchema;
