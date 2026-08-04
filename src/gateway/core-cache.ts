import { z } from 'zod';

import type {
  DemoState,
  InvoiceTemplate,
  LabelTemplate,
  NotaLine,
  NotaTransaction,
} from '../domain/types';
import {
  coreJsonValueSchema,
  type CoreConflict,
  type CoreJsonValue,
} from './core-api-types';
import type { CoreApiMethod } from './core-api-transport';
import {
  demoStateSchema,
  invoiceTemplateSchema,
  labelTemplateSchema,
  notaPageSchema,
  notaLineSchema,
  notaTransactionSchema,
  timestampSchema,
} from './core-domain-schemas';

export const CORE_CACHE_VERSION = 1;

export interface CoreGatewayStorage {
  load(): Promise<unknown>;
  save(envelope: CoreCacheEnvelope): Promise<void>;
  loadImage?(hash: string): Promise<Blob | undefined>;
  saveImage?(hash: string, image: Blob): Promise<void>;
  listImageHashes?(): Promise<string[]>;
  deleteImages?(hashes: string[]): Promise<void>;
}

export interface CoreGatewayClock {
  now(): Date;
  isForeground(): boolean;
  schedule(
    callback: () => void | Promise<void>,
    delayMs: number,
  ): () => void;
  subscribeResume(listener: () => void | Promise<void>): () => void;
}

export type CoreOptimisticChange =
  | {
      kind: 'nota-header';
      notaId: string;
      patch: Partial<NotaTransaction>;
    }
  | {
      kind: 'nota-line';
      notaId: string;
      pageId: string;
      lineId: string;
      patch: Partial<NotaLine>;
    }
  | {
      kind: 'nota-page-add';
      notaId: string;
      page: NotaTransaction['pages'][number];
    }
  | {
      kind: 'nota-page-status';
      notaId: string;
      pageId: string;
      status: NotaTransaction['pages'][number]['status'];
    }
  | { kind: 'label-template'; template: LabelTemplate }
  | { kind: 'invoice-template'; template: InvoiceTemplate };

export interface CoreOutboxItem {
  id: string;
  idempotencyKey: string;
  method: Exclude<CoreApiMethod, 'GET'>;
  path: string;
  body?: CoreJsonValue;
  createdAt: string;
  notaId?: string;
  coalesceKey?: string;
  resolvesConflictId?: string;
  optimistic?: CoreOptimisticChange;
  optimisticActive?: boolean;
  conflict?: CoreConflict;
}

export interface CoreNotaVersionState {
  fieldVersions: Record<string, string>;
  structureVersion: string;
  lifecycleVersion: string;
  pageVersions: Record<string, string>;
  pageLifecycleVersions: Record<string, string>;
  lineVersions: Record<string, string>;
}

export interface CoreCacheEnvelope {
  cacheVersion: 1;
  state: DemoState;
  serverRevision: string;
  outbox: CoreOutboxItem[];
  notaVersions?: Record<string, CoreNotaVersionState>;
}

export const coreConflictSchema = z
  .object({
    id: z.string().uuid(),
    entityType: z.string(),
    entityId: z.string().uuid(),
    field: z.string().optional(),
    base: coreJsonValueSchema,
    mine: coreJsonValueSchema,
    server: coreJsonValueSchema,
  })
  .strict();

export const coreOptimisticChangeSchema: z.ZodType<CoreOptimisticChange> = z.discriminatedUnion(
  'kind',
  [
    z
      .object({
        kind: z.literal('nota-header'),
        notaId: z.string(),
        patch: notaTransactionSchema.partial(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('nota-line'),
        notaId: z.string(),
        pageId: z.string(),
        lineId: z.string(),
        patch: notaLineSchema.partial(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('nota-page-add'),
        notaId: z.string(),
        page: notaPageSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal('nota-page-status'),
        notaId: z.string(),
        pageId: z.string(),
        status: z.enum(['active', 'cancelled']),
      })
      .strict(),
    z
      .object({
        kind: z.literal('label-template'),
        template: labelTemplateSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal('invoice-template'),
        template: invoiceTemplateSchema,
      })
      .strict(),
  ],
);

export const coreOutboxItemSchema: z.ZodType<CoreOutboxItem> = z
  .object({
    id: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
    method: z.enum(['POST', 'PATCH', 'DELETE']),
    path: z.string().startsWith('/v1/'),
    body: coreJsonValueSchema.optional(),
    createdAt: timestampSchema,
    notaId: z.string().optional(),
    coalesceKey: z.string().optional(),
    resolvesConflictId: z.string().uuid().optional(),
    optimistic: coreOptimisticChangeSchema.optional(),
    optimisticActive: z.boolean().optional(),
    conflict: coreConflictSchema.optional(),
  })
  .strict();

const canonicalVersion = z.string().regex(/^[1-9]\d*$/);
export const coreNotaVersionStateSchema: z.ZodType<CoreNotaVersionState> = z
  .object({
    fieldVersions: z.record(z.string(), canonicalVersion),
    structureVersion: canonicalVersion,
    lifecycleVersion: canonicalVersion,
    pageVersions: z.record(z.string().uuid(), canonicalVersion),
    pageLifecycleVersions: z.record(z.string().uuid(), canonicalVersion),
    lineVersions: z.record(z.string().uuid(), canonicalVersion),
  })
  .strict();

const cacheEnvelopeSchema: z.ZodType<CoreCacheEnvelope> = z
  .object({
    cacheVersion: z.literal(CORE_CACHE_VERSION),
    state: demoStateSchema,
    serverRevision: z.string().regex(/^(0|[1-9]\d*)$/),
    outbox: z.array(coreOutboxItemSchema),
    notaVersions: z
      .record(z.string().uuid(), coreNotaVersionStateSchema)
      .default({}),
  })
  .strict();

export function cloneCore<T>(value: T): T {
  return structuredClone(value);
}

export function parseCoreCache(value: unknown): CoreCacheEnvelope {
  return cacheEnvelopeSchema.parse(value);
}

export function hasUnsupportedCacheVersion(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'cacheVersion' in value &&
    value.cacheVersion !== CORE_CACHE_VERSION
  );
}

export function coreCacheEnvelope(
  state: DemoState,
  serverRevision: string,
  outbox: CoreOutboxItem[],
  notaVersions: Record<string, CoreNotaVersionState> = {},
): CoreCacheEnvelope {
  return {
    cacheVersion: CORE_CACHE_VERSION,
    state: cloneCore(state),
    serverRevision,
    outbox: cloneCore(outbox),
    notaVersions: cloneCore(notaVersions),
  };
}
