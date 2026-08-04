import { z } from 'zod';

import { canonicalUuid } from '../http/request-validation.js';

export const packageBarcodeBody = z
  .object({
    identifierValue: z.string().trim().min(1).max(512),
  })
  .strict();

export const reassignPackageBarcodeBody = z
  .object({ skuId: canonicalUuid })
  .strict();

export type PackageBarcodeRequest = z.infer<typeof packageBarcodeBody>;
export type ReassignPackageBarcodeRequest = z.infer<typeof reassignPackageBarcodeBody>;
