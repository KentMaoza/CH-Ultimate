import { z } from 'zod';

const uuid = z.string().uuid();
const safeInteger = z.number().int().safe();
const boundedText = z.string().trim().min(1).max(512);
const emptyRecord = z
  .record(z.string(), z.never())
  .refine((value) => Object.keys(value).length === 0);

const line = z
  .object({
    id: uuid,
    skuId: uuid.optional(),
    description: z.string().max(512),
    kind: z.string().max(160),
    quantity: safeInteger.min(0),
    unit: z.enum(['pcs', 'lsn']),
    pcsPrice: safeInteger.min(0),
    lsnPrice: safeInteger.min(0),
  })
  .strict()
  .superRefine((value, context) => {
    const populated =
      Boolean(value.skuId) ||
      Boolean(value.description.trim()) ||
      Boolean(value.kind.trim()) ||
      value.quantity !== 0 ||
      value.pcsPrice !== 0 ||
      value.lsnPrice !== 0;
    if (!populated) return;
    if (!value.description.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['description'],
        message: 'description is required for a populated line',
      });
    }
    if (value.quantity <= 0) {
      context.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'quantity must be positive for a populated line',
      });
    }
    const quantityPcs =
      BigInt(value.quantity) * (value.unit === 'lsn' ? 12n : 1n);
    const total =
      BigInt(value.quantity) *
      BigInt(value.unit === 'lsn' ? value.lsnPrice : value.pcsPrice);
    if (
      quantityPcs > BigInt(Number.MAX_SAFE_INTEGER) ||
      total > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'line arithmetic exceeds safe integer range',
      });
    }
  });

const page = z
  .object({
    id: uuid,
    suffix: z.string().min(1).max(3),
    status: z.enum(['active', 'cancelled']),
    lines: z.array(line).min(1).max(15),
  })
  .strict();

const localNota = z
  .object({
    id: uuid,
    baseNumber: z.string().startsWith('OFFLINE-').max(64),
    customerName: z.string().max(512),
    customerPlace: z.string().max(512),
    transactionDate: z.string().date(),
    payment: z.enum(['unclassified', 'cash', 'transfer', 'credit']),
    status: z.enum(['draft', 'completed']),
    completionDestination: z.enum(['archive', 'finished']).optional(),
    completedAt: z.string().datetime({ offset: true }).optional(),
    nextNoteIndex: safeInteger.min(1).max(26),
    pages: z.array(page).min(1).max(26),
    postedLines: z.array(z.never()).max(0),
    postedStockEffects: emptyRecord,
    postedTrackedLineIds: emptyRecord,
  })
  .strict();

const skuSnapshot = z
  .object({
    skuId: uuid,
    identifier: boundedText,
    name: boundedText,
    referencePrice: safeInteger.min(0),
  })
  .strict();

export const offlineNotaBody = z
  .object({
    provisionalId: uuid,
    snapshot: localNota,
    completed: z.boolean(),
    destination: z.enum(['archive', 'finished']),
    skuSnapshots: z.array(skuSnapshot).max(390),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.provisionalId !== value.snapshot.id) {
      context.addIssue({
        code: 'custom',
        path: ['provisionalId'],
        message: 'provisional id must match snapshot id',
      });
    }
    if (value.completed !== (value.snapshot.status === 'completed')) {
      context.addIssue({
        code: 'custom',
        path: ['completed'],
        message: 'completed flag must match snapshot status',
      });
    }
    if (
      value.completed &&
      value.snapshot.completionDestination !== value.destination
    ) {
      context.addIssue({
        code: 'custom',
        path: ['destination'],
        message: 'destination must match completed snapshot',
      });
    }
    const snapshots = new Set(value.skuSnapshots.map((item) => item.skuId));
    if (snapshots.size !== value.skuSnapshots.length) {
      context.addIssue({
        code: 'custom',
        path: ['skuSnapshots'],
        message: 'SKU snapshots must be unique',
      });
    }
    for (const skuId of value.snapshot.pages.flatMap((item) =>
      item.lines.flatMap((candidate) =>
        candidate.skuId ? [candidate.skuId] : [],
      ),
    )) {
      if (!snapshots.has(skuId)) {
        context.addIssue({
          code: 'custom',
          path: ['skuSnapshots'],
          message: `missing captured snapshot for ${skuId}`,
        });
      }
    }
  });

export const offlineStockBody = z
  .object({
    skuId: uuid,
    skuIdentifier: boundedText,
    skuName: boundedText,
    referencePrice: safeInteger.min(0),
    delta: safeInteger.refine((value) => value !== 0),
    reason: boundedText,
  })
  .strict();

export type OfflineNotaRequest = z.infer<typeof offlineNotaBody>;
export type OfflineStockRequest = z.infer<typeof offlineStockBody>;
