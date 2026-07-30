import { z } from 'zod';

const version = z.string().regex(/^[1-9]\d*$/);
const nullableVersion = version.nullable();
const safeInteger = z.number().int().safe();
const nonnegativeInteger = safeInteger.min(0);
const fieldName = z.enum([
  'customerName',
  'customerPlace',
  'transactionDate',
  'payment',
]);
const headerValue = z.union([
  z.string().max(512),
  z.enum(['unclassified', 'cash', 'transfer', 'credit']),
]);

export const createNotaBody = z.object({}).strict();
export const notaAndPagePath = z
  .object({ id: z.string().uuid(), pageId: z.string().uuid() })
  .strict();
export const notaLinePath = z
  .object({
    id: z.string().uuid(),
    pageId: z.string().uuid(),
    lineId: z.string().uuid(),
  })
  .strict();

export const addPageBody = z.object({ structureVersion: version }).strict();
export const pageLifecycleBody = z
  .object({ structureVersion: version, pageVersion: version })
  .strict();

const fieldEdit = z
  .object({ version, base: headerValue, mine: headerValue })
  .strict();
export const updateHeaderBody = z
  .object({
    fields: z
      .partialRecord(fieldName, fieldEdit)
      .refine((fields) => Object.keys(fields).length > 0),
  })
  .strict();

export const notaLineValue = z
  .object({
    linePosition: z.number().int().min(0).max(14),
    skuId: z.string().uuid().nullable(),
    description: z.string().trim().min(1).max(512),
    kind: z.string().max(160),
    quantity: safeInteger.min(1),
    unit: z.enum(['pcs', 'lsn']),
    pcsPrice: nonnegativeInteger,
    lsnPrice: nonnegativeInteger,
  })
  .strict();
const notaLineBaseValue = notaLineValue.extend({
  description: z.string().max(512),
  quantity: safeInteger.min(0),
});

export const updateLineBody = z
  .object({
    pageVersion: version,
    lineVersion: nullableVersion,
    base: notaLineBaseValue.nullable(),
    mine: notaLineValue,
  })
  .strict()
  .refine(
    (value) => (value.lineVersion === null) === (value.base === null),
    'base must match line version knowledge',
  );

export const deleteLineBody = z
  .object({
    pageVersion: version,
    lineVersion: version,
    base: notaLineValue,
  })
  .strict();

export const completeNotaBody = z
  .object({
    lifecycleVersion: version,
    destination: z.enum(['archive', 'finished']),
  })
  .strict();
export const notaLifecycleBody = z.object({ lifecycleVersion: version }).strict();
export const resolveConflictBody = z
  .object({ choice: z.enum(['mine', 'server']) })
  .strict();

export type CreateNotaRequest = z.infer<typeof createNotaBody>;
export type AddPageRequest = z.infer<typeof addPageBody>;
export type PageLifecycleRequest = z.infer<typeof pageLifecycleBody>;
export type UpdateHeaderRequest = z.infer<typeof updateHeaderBody>;
export type UpdateLineRequest = z.infer<typeof updateLineBody>;
export type DeleteLineRequest = z.infer<typeof deleteLineBody>;
export type CompleteNotaRequest = z.infer<typeof completeNotaBody>;
export type NotaLifecycleRequest = z.infer<typeof notaLifecycleBody>;
export type ResolveConflictRequest = z.infer<typeof resolveConflictBody>;
