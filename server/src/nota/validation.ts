import { z } from 'zod';

const version = z.string().regex(/^[1-9]\d*$/);
const nullableVersion = version.nullable();
const safeInteger = z.number().int().safe();
const nonnegativeInteger = safeInteger.min(0);
const boundedHeaderText = z.string().max(512);
const payment = z.enum(['unclassified', 'cash', 'transfer', 'credit']);
const transactionDate = z.string().date();

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

export const addPageBody = z
  .object({
    lifecycleVersion: version,
    structureVersion: version,
    clientPageId: z.string().uuid().optional(),
    clientLineIds: z.array(z.string().uuid()).length(15).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.clientPageId === undefined) !== (input.clientLineIds === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'clientPageId and clientLineIds must be supplied together',
      });
    }
    if (input.clientLineIds && new Set(input.clientLineIds).size !== 15) {
      context.addIssue({
        code: 'custom',
        path: ['clientLineIds'],
        message: 'clientLineIds must be unique',
      });
    }
    if (
      input.clientPageId &&
      input.clientLineIds?.includes(input.clientPageId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['clientLineIds'],
        message: 'client page and line IDs must be unique',
      });
    }
  });
export const pageLifecycleBody = z
  .object({
    lifecycleVersion: version,
    structureVersion: version,
    pageVersion: version,
  })
  .strict();

const fieldEdit = <T extends z.ZodType>(value: T) =>
  z.object({ version, base: value, mine: value }).strict();
export const updateHeaderBody = z
  .object({
    lifecycleVersion: version,
    fields: z.object({
      customerName: fieldEdit(boundedHeaderText).optional(),
      customerPlace: fieldEdit(boundedHeaderText).optional(),
      transactionDate: fieldEdit(transactionDate).optional(),
      payment: fieldEdit(payment).optional(),
    }).strict().refine((fields) => Object.keys(fields).length > 0),
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
  .strict()
  .superRefine((line, context) => {
    const quantityPcs =
      line.unit === 'lsn' ? BigInt(line.quantity) * 12n : BigInt(line.quantity);
    const unitPrice =
      line.unit === 'lsn' ? BigInt(line.lsnPrice) : BigInt(line.pcsPrice);
    const total = BigInt(line.quantity) * unitPrice;
    if (quantityPcs > BigInt(Number.MAX_SAFE_INTEGER)) {
      context.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'quantity PCS exceeds safe integer range',
      });
    }
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
      context.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'line total exceeds safe integer range',
      });
    }
  });
const notaLineBaseValue = notaLineValue.safeExtend({
  description: z.string().max(512),
  quantity: safeInteger.min(0),
});

export const updateLineBody = z
  .object({
    lifecycleVersion: version,
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
    lifecycleVersion: version,
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
