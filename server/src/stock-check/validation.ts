import { z } from 'zod';

const safeQuantity = z.number().int().safe();
const canonicalVersion = z.string().regex(/^[1-9]\d*$/);
const countedAt = z.string().datetime({ offset: true });
const note = z.string().trim().max(512).optional();

const fields = {
  observedQuantityPcs: safeQuantity,
  countedQuantityPcs: safeQuantity,
  countedAt,
  note,
};

export const onlineStockCheckBody = z
  .object({
    ...fields,
    baseBalanceVersion: canonicalVersion,
  })
  .strict();

export const offlineStockCheckBody = z
  .object({
    skuId: z.string().uuid(),
    ...fields,
    baseBalanceVersion: canonicalVersion.optional(),
  })
  .strict();

export type OnlineStockCheckRequest = z.infer<typeof onlineStockCheckBody>;
export type StockCheckRequest = z.infer<typeof offlineStockCheckBody>;
