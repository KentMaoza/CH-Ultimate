import { z } from 'zod';

const safeInteger = z.number().int().safe();
const nonnegativeInteger = safeInteger.min(0);
const canonicalVersion = z.string().regex(/^[1-9]\d*$/);
const optionalUrl = z.union([z.literal(''), z.string().url().max(2_048)]);
const identifier = z
  .string()
  .min(1)
  .max(16 * 1024)
  .refine((value) => value.trim().length > 0);

export const createSkuBody = z
  .object({
    skuNumber: identifier,
    name: z.string().trim().min(1).max(512),
    referencePrice: nonnegativeInteger,
    openingStock: safeInteger,
    tracked: z.boolean(),
    note: z.string().max(16 * 1024).optional(),
    imageUrl: optionalUrl.optional(),
  })
  .strict();

const skuFields = {
  skuNumber: identifier.optional(),
  name: z.string().trim().min(1).max(512).optional(),
  referencePrice: nonnegativeInteger.optional(),
  note: z.string().max(16 * 1024).optional(),
  imageUrl: optionalUrl.optional(),
  imageHash: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
  sourceImageUrl: optionalUrl.nullable().optional(),
  archived: z.boolean().optional(),
};

const skuPatch = z
  .object(skuFields)
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const updateSkuBody = z
  .object({
    rowVersion: canonicalVersion,
    base: z.object(skuFields).strict(),
    patch: skuPatch,
  })
  .strict()
  .superRefine((value, context) => {
    const baseKeys = Object.keys(value.base).sort();
    const patchKeys = Object.keys(value.patch).sort();
    if (
      baseKeys.length !== patchKeys.length ||
      baseKeys.some((key, index) => key !== patchKeys[index])
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'base must contain exactly the patched fields',
      });
    }
  });

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
      .max(5)
      .refine((fields) => new Set(fields).size === fields.length),
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
      .max(4)
      .refine(
        (elements) =>
          new Set(elements.map((element) => element.id)).size ===
          elements.length,
      ),
  })
  .strict();

export const templateKindPath = z
  .object({ kind: z.enum(['label', 'invoice']) })
  .strict();

export function templateBody(kind: 'label' | 'invoice') {
  const definition = kind === 'label' ? labelDefinition : invoiceDefinition;
  return z
    .object({
      rowVersion: canonicalVersion.nullable(),
      base: definition.nullable(),
      definition,
    })
    .strict()
    .superRefine((value, context) => {
      if ((value.rowVersion === null) !== (value.base === null)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'base must match row version knowledge',
        });
      }
    });
}

export type CreateSkuRequest = z.infer<typeof createSkuBody>;
export type UpdateSkuRequest = z.infer<typeof updateSkuBody>;
export type StockAdjustmentRequest = z.infer<typeof stockAdjustmentBody>;
export type TemplateUpdateRequest = {
  rowVersion: string | null;
  base:
    | z.infer<typeof labelDefinition>
    | z.infer<typeof invoiceDefinition>
    | null;
  definition: z.infer<typeof labelDefinition> | z.infer<typeof invoiceDefinition>;
};
