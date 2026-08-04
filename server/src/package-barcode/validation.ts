import { z } from 'zod';

export const packageBarcodeBody = z
  .object({
    identifierValue: z.string().trim().min(1).max(512),
  })
  .strict();

export const reassignPackageBarcodeBody = z
  .object({ skuId: z.string().uuid() })
  .strict();

export type PackageBarcodeRequest = z.infer<typeof packageBarcodeBody>;
export type ReassignPackageBarcodeRequest = z.infer<typeof reassignPackageBarcodeBody>;
