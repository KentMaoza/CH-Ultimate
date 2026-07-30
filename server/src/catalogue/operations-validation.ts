import { z } from 'zod';

const safeInteger = z.number().int().safe();
const nonnegativeInteger = safeInteger.min(0);
const canonicalVersion = z.string().regex(/^[1-9]\d*$/);
const optionalUrl = z.union([z.literal(''), z.string().url().max(2_048)]);

export const createSkuBody = z
  .object({
    skuNumber: z.string().min(1).max(16 * 1024),
    name: z.string().trim().min(1).max(512),
    referencePrice: nonnegativeInteger,
    openingStock: safeInteger,
    tracked: z.boolean(),
    note: z.string().max(16 * 1024).optional(),
    imageUrl: optionalUrl.optional(),
  })
  .strict();

const skuPatch = z
  .object({
    skuNumber: z.string().min(1).max(16 * 1024).optional(),
    name: z.string().trim().min(1).max(512).optional(),
    referencePrice: nonnegativeInteger.optional(),
    note: z.string().max(16 * 1024).optional(),
    imageUrl: optionalUrl.optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const updateSkuBody = z
  .object({
    rowVersion: canonicalVersion,
    patch: skuPatch,
  })
  .strict();

export const stockAdjustmentBody = z
  .object({
    delta: safeInteger.refine((value) => value !== 0),
  })
  .strict();

const labelDefinition = z
  .object({
    medium: z.enum(['thermal', 'a4']),
    widthMm: z.number().finite().min(20).max(1_000),
    heightMm: z.number().finite().min(15).max(1_000),
    columns: z.number().int().min(1).max(6),
    marginMm: z.number().finite().min(0).max(100),
    gapMm: z.number().finite().min(0).max(100),
    fontSize: z.number().finite().min(7).max(24),
    alignment: z.enum(['left', 'center', 'right']),
    fields: z
      .array(z.enum(['qr', 'name', 'sku', 'price', 'chu']))
      .max(5),
  })
  .strict();

const invoiceDefinition = z
  .object({
    widthMm: z.number().finite().min(20).max(1_000),
    heightMm: z.number().finite().min(20).max(1_000),
    fontSize: z.number().finite().min(7).max(24),
    logoUrl: optionalUrl,
    bankAccount: z.string().max(512),
    address: z.string().max(2_048),
    phone: z.string().max(160),
    elements: z
      .array(
        z
          .object({
            id: z.enum(['logo', 'address', 'phone', 'bank']),
            visible: z.boolean(),
          })
          .strict(),
      )
      .max(4),
  })
  .strict();

export const templateKindPath = z
  .object({ kind: z.enum(['label', 'invoice']) })
  .strict();

export function templateBody(kind: 'label' | 'invoice') {
  return z
    .object({
      rowVersion: canonicalVersion.nullable(),
      definition: kind === 'label' ? labelDefinition : invoiceDefinition,
    })
    .strict();
}

export type CreateSkuRequest = z.infer<typeof createSkuBody>;
export type UpdateSkuRequest = z.infer<typeof updateSkuBody>;
export type StockAdjustmentRequest = z.infer<typeof stockAdjustmentBody>;
export type TemplateUpdateRequest = {
  rowVersion: string | null;
  definition: z.infer<typeof labelDefinition> | z.infer<typeof invoiceDefinition>;
};
