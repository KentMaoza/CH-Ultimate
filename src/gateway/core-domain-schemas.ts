import { z } from 'zod';

export const timestampSchema = z.string().datetime({ offset: true });

export const skuSchema = z
  .object({
    id: z.string(),
    skuNumber: z.string(),
    aliases: z.array(z.string()),
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
          source: z.enum(['manual', 'nota', 'reversal']),
        })
        .strict(),
    ),
    priceChanges: z.array(
      z
        .object({
          id: z.string(),
          skuId: z.string(),
          before: z.number().int(),
          after: z.number().int(),
          createdAt: timestampSchema,
        })
        .strict(),
    ),
    notaTransactions: z.array(notaTransactionSchema),
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
