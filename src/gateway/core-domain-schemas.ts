import { z } from 'zod';

export const timestampSchema = z.string().datetime({ offset: true });
const safeIntegerSchema = z.number().int().safe();

export const skuIdentifierKindSchema = z.enum([
  'primary',
  'product_code',
  'alias',
  'package_barcode',
  'other',
]);

export const skuIdentifierSchema = z.object({
  id: z.string(),
  skuId: z.string(),
  value: z.string(),
  kind: skuIdentifierKindSchema,
  createdAt: timestampSchema,
}).strict();

export const stockCheckSchema = z.object({
  id: z.string(),
  skuId: z.string(),
  observedQuantityPcs: safeIntegerSchema,
  countedQuantityPcs: safeIntegerSchema,
  serverQuantityBeforePcs: safeIntegerSchema,
  appliedDeltaPcs: safeIntegerSchema,
  baseBalanceVersion: z.string().regex(/^[1-9]\d*$/).optional(),
  forcedOffline: z.boolean(),
  countedAt: timestampSchema,
  appliedAt: timestampSchema,
  deviceId: z.string(),
  deviceDisplayName: z.string(),
  note: z.string().trim().max(512).optional(),
}).strict();

export const skuSchema = z
  .object({
    id: z.string(),
    skuNumber: z.string(),
    aliases: z.array(z.string()),
    identifiers: z.array(skuIdentifierSchema),
    name: z.string(),
    referencePrice: z.number().int(),
    stock: z.number().int(),
    tracked: z.boolean(),
    note: z.string(),
    imageUrl: z.string(),
    imageHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    sourceImageUrl: z.string().url().nullable().optional(),
    sourceCreatedAt: z.string().optional(),
    createdAt: timestampSchema,
    archived: z.boolean(),
    lastStockCheckedAt: timestampSchema.optional(),
  })
  .strict();

export const notaLineSchema = z
  .object({
    id: z.string(),
    skuId: z.string().optional(),
    description: z.string(),
    kind: z.string(),
    quantity: z.number().int(),
    unit: z.enum(['pcs', 'lsn']),
    pcsPrice: z.number().int(),
    lsnPrice: z.number().int(),
  })
  .strict();

export const notaPageSchema = z
  .object({
    id: z.string(),
    suffix: z.string(),
    status: z.enum(['active', 'cancelled']),
    lines: z.array(notaLineSchema),
  })
  .strict();

export const notaTransactionSchema = z
  .object({
    id: z.string(),
    baseNumber: z.string(),
    customerName: z.string(),
    customerPlace: z.string(),
    transactionDate: z.string(),
    payment: z.enum(['unclassified', 'cash', 'transfer', 'credit']),
    status: z.enum(['draft', 'completed', 'reopened', 'cancelled']),
    completionDestination: z.enum(['archive', 'finished']).optional(),
    completedAt: timestampSchema.optional(),
    nextNoteIndex: z.number().int().min(0),
    pages: z.array(notaPageSchema),
    postedLines: z.array(notaLineSchema),
    postedStockEffects: z.record(z.string(), z.number().int()),
    postedTrackedLineIds: z.record(z.string(), z.string()),
    cancelledFromStatus: z
      .enum(['draft', 'completed', 'reopened'])
      .optional(),
  })
  .strict();

export const notaPostingSchema = z
  .object({
    id: z.string().uuid(),
    notaId: z.string().uuid(),
    postingKind: z.string(),
    amountRupiah: z.number().int(),
    lines: z.array(notaLineSchema),
    stockEffects: z.record(z.string().uuid(), z.number().int()),
    trackedLineIds: z.record(z.string().uuid(), z.string().uuid()),
    lifecycleVersion: z.string().regex(/^(0|[1-9]\d*)$/),
    reversesPostingId: z.string().uuid().optional(),
    postedAt: timestampSchema,
  })
  .strict();

export const revenuePostingSchema = z
  .object({
    id: z.string().uuid(),
    notaId: z.string().uuid(),
    notaPostingId: z.string().uuid(),
    amountRupiah: z.number().int(),
    postingKind: z.string(),
    postedAt: timestampSchema,
  })
  .strict();

export const labelTemplateSchema = z
  .object({
    medium: z.enum(['thermal', 'a4']),
    widthMm: z.number(),
    heightMm: z.number(),
    columns: z.number().int(),
    marginMm: z.number(),
    gapMm: z.number(),
    fontSize: z.number(),
    alignment: z.enum(['left', 'center', 'right']),
    fields: z.array(z.enum(['qr', 'name', 'sku', 'price', 'chu'])),
  })
  .strict();

export const invoiceTemplateSchema = z
  .object({
    widthMm: z.number(),
    heightMm: z.number(),
    fontSize: z.number(),
    logoUrl: z.string(),
    bankAccount: z.string(),
    address: z.string(),
    phone: z.string(),
    elements: z.array(
      z
        .object({
          id: z.enum(['logo', 'address', 'phone', 'bank']),
          visible: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

export const demoStateSchema = z
  .object({
    skus: z.array(skuSchema),
    adjustments: z.array(
      z
        .object({
          id: z.string(),
          skuId: z.string(),
          quantity: z.number().int(),
          before: z.number().int(),
          after: z.number().int(),
          createdAt: timestampSchema,
          source: z.enum(['manual', 'nota', 'reversal', 'stock-check', 'other']).default('other'),
        })
        .strict(),
    ),
    stockChecks: z.array(stockCheckSchema),
    priceChanges: z.array(
      z
        .object({
          id: z.string(),
          skuId: z.string(),
          before: z.number().int(),
          after: z.number().int(),
          createdAt: timestampSchema,
          source: z.enum(['manual', 'catalogue_import', 'other']).default('other'),
        })
        .strict(),
    ),
    notaTransactions: z.array(notaTransactionSchema),
    notaPostings: z.array(notaPostingSchema).optional(),
    revenuePostings: z.array(revenuePostingSchema).optional(),
    labelTemplate: labelTemplateSchema,
    invoiceTemplate: invoiceTemplateSchema,
    sourceLabel: z.string(),
    importSummary: z
      .object({
        loaded: z.number().int(),
        skipped: z.number().int(),
        warnings: z.array(z.string()),
      })
      .strict()
      .optional(),
  })
  .strict();
