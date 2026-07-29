import { z } from 'zod';

import {
  CORE_API_SCHEMA_VERSION,
  coreBootstrapSchema,
  coreChangeSchema,
  coreChangePageSchema,
  coreJsonValueSchema,
  mutationAcknowledgementSchema,
  uuidSchemaForErrors,
  type CoreJsonValue,
} from './core-api-schemas';

export {
  CORE_API_SCHEMA_VERSION,
  canonicalDecimalSchema,
  coreBalanceRowSchema,
  coreBootstrapSchema,
  coreChangePageSchema,
  coreChangeSchema,
  coreJsonValueSchema,
  coreNotaLineRowSchema,
  coreNotaPageRowSchema,
  coreNotaRowSchema,
  coreSkuIdentifierRowSchema,
  coreSkuRowSchema,
  coreTemplateRowSchema,
} from './core-api-schemas';
export type { CoreJsonValue } from './core-api-schemas';

export type CoreBootstrap = z.infer<typeof coreBootstrapSchema>;
export type CoreChange = z.infer<typeof coreChangeSchema>;
export type CoreChangePage = z.infer<typeof coreChangePageSchema>;

export interface CoreConflict {
  id: string;
  entityType: string;
  entityId: string;
  field?: string;
  base: CoreJsonValue;
  mine: CoreJsonValue;
  server: CoreJsonValue;
}

const coreConflictSchema: z.ZodType<CoreConflict> = z
  .object({
    id: uuidSchemaForErrors,
    entityType: z.string().min(1),
    entityId: uuidSchemaForErrors,
    field: z.string().min(1).optional(),
    base: coreJsonValueSchema,
    mine: coreJsonValueSchema,
    server: coreJsonValueSchema,
  })
  .strict();

const conflictErrorSchema = z
  .object({
    code: z.literal('CONFLICT'),
    conflict: coreConflictSchema,
  })
  .strict();

const genericErrorSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    bootstrapRequired: z.boolean().optional(),
  })
  .strict();

export type CoreApiError =
  | { status: number; code: 'CONFLICT'; conflict: CoreConflict }
  | { status: number; code: string; bootstrapRequired?: boolean };

export class CoreApiSchemaError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CoreApiSchemaError';
  }
}

export class CoreApiUpgradeRequiredError extends CoreApiSchemaError {
  constructor(message = 'CH Core API memerlukan versi aplikasi yang lebih baru.') {
    super(message);
    this.name = 'CoreApiUpgradeRequiredError';
  }
}

function parseEnvelope<T>(
  schema: z.ZodType<T>,
  body: unknown,
  label: string,
): T {
  if (typeof body === 'object' && body !== null) {
    const version = Reflect.get(body, 'apiSchemaVersion');
    if (version !== undefined && version !== CORE_API_SCHEMA_VERSION) {
      throw new CoreApiUpgradeRequiredError();
    }
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new CoreApiSchemaError(`Invalid CH Core ${label} envelope`, parsed.error);
  }
  return parsed.data;
}

export function parseCoreBootstrap(body: unknown): CoreBootstrap {
  return parseEnvelope(coreBootstrapSchema, body, 'bootstrap');
}

export function parseCoreChangePage(body: unknown): CoreChangePage {
  return parseEnvelope(coreChangePageSchema, body, 'change page');
}

export function parseCoreApiError(
  status: number,
  body: unknown,
): CoreApiError {
  const conflict = conflictErrorSchema.safeParse(body);
  if (conflict.success) return { status, ...conflict.data };
  const generic = genericErrorSchema.safeParse(body);
  if (!generic.success) {
    throw new CoreApiSchemaError('Invalid CH Core error envelope', generic.error);
  }
  return { status, ...generic.data };
}

export interface CoreMutationAcknowledgement {
  apiSchemaVersion?: 1;
  serverRevision?: string;
  entity?: CoreJsonValue;
}

export function parseCoreMutationAcknowledgement(
  body: unknown,
): CoreMutationAcknowledgement {
  if (body === undefined || body === null) return {};
  return parseEnvelope(
    mutationAcknowledgementSchema,
    body,
    'mutation acknowledgement',
  );
}

const encodeId = (id: string) => encodeURIComponent(id);

export const CORE_API_PATHS = {
  bootstrap: '/v1/bootstrap',
  changes: (after: string) => `/v1/changes?after=${after}&limit=500`,
  skus: '/v1/skus',
  sku: (id: string) => `/v1/skus/${encodeId(id)}`,
  stockAdjustments: (id: string) =>
    `/v1/skus/${encodeId(id)}/stock-adjustments`,
  initialCatalogue: '/v1/imports/initial-catalogue',
  template: (kind: 'label' | 'invoice') => `/v1/templates/${kind}`,
  notas: '/v1/notas',
  nota: (id: string) => `/v1/notas/${encodeId(id)}`,
  notaHeader: (id: string) => `/v1/notas/${encodeId(id)}/header`,
  notaPages: (id: string) => `/v1/notas/${encodeId(id)}/pages`,
  notaPage: (notaId: string, pageId: string) =>
    `/v1/notas/${encodeId(notaId)}/pages/${encodeId(pageId)}`,
  notaLine: (notaId: string, pageId: string, lineId: string) =>
    `/v1/notas/${encodeId(notaId)}/pages/${encodeId(pageId)}/lines/${encodeId(lineId)}`,
  notaComplete: (id: string) => `/v1/notas/${encodeId(id)}/complete`,
  notaReopen: (id: string) => `/v1/notas/${encodeId(id)}/reopen`,
  notaCancel: (id: string) => `/v1/notas/${encodeId(id)}/cancel`,
  notaRestore: (id: string) => `/v1/notas/${encodeId(id)}/restore`,
  notaTransfer: (id: string) => `/v1/notas/${encodeId(id)}/transfer`,
  resolveConflict: (id: string) =>
    `/v1/conflicts/${encodeId(id)}/resolve`,
} as const;
