import { z } from 'zod';

import type { DemoState, NotaTransaction } from '../domain/types';
import {
  cloneCore,
  coreConflictSchema,
  coreNotaVersionStateSchema,
  coreOptimisticChangeSchema,
  coreOutboxItemSchema,
  type CoreCacheEnvelope,
  type CoreGatewayStorage,
  type CoreNotaVersionState,
  type CoreOptimisticChange,
  type CoreOutboxItem,
} from './core-cache';
import { emptyCoreState } from './core-bootstrap-mapping';
import {
  demoStateSchema,
  notaTransactionSchema,
  timestampSchema,
} from './core-domain-schemas';
import {
  coreJsonValueSchema,
  type CoreConflict,
  type CoreJsonValue,
} from './core-api-types';

export const CORE_CACHE_VERSION = 4;

export class CoreLocalOwnershipError extends Error {}

function rejectUnownedLegacyWork(hasRecoverableWork: boolean): void {
  if (!hasRecoverableWork) return;
  throw new CoreLocalOwnershipError(
    'Legacy cache contains pending work with unverified ownership.',
  );
}

export type CoreDeferredStatus =
  | 'deferred'
  | 'sending'
  | 'error'
  | 'blocked'
  | 'quarantined'
  | 'conflict';

export interface OfflineSkuSnapshot {
  skuId: string;
  identifier: string;
  name: string;
  referencePrice: number;
}

export interface OfflineNotaPayload {
  provisionalId: string;
  snapshot: NotaTransaction;
  completed: boolean;
  destination: 'archive' | 'finished';
  skuSnapshots: OfflineSkuSnapshot[];
}

export interface OfflineStockPayload {
  skuId: string;
  skuIdentifier: string;
  skuName: string;
  referencePrice: number;
  delta: number;
  reason: string;
}

export interface OfflineStockCountPayload {
  skuId: string;
  observedQuantityPcs: number;
  countedQuantityPcs: number;
  baseBalanceVersion?: string;
  countedAt: string;
  note?: string;
}

export interface OfflineNotaMutationPayload {
  notaId: string;
  targetKey: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body: CoreJsonValue;
  dependsOn: string[];
  optimistic: CoreOptimisticChange;
}

export interface OfflineNotaConflictResolution {
  conflictId: string;
  choice: 'mine' | 'server';
  idempotencyKey: string;
  firstSentAt?: string;
}

export type CoreDeferredCommand =
  | {
      kind: 'offline-nota';
      sequence: number;
      operationId: string;
      idempotencyKey: string;
      createdAt: string;
      status: CoreDeferredStatus;
      firstSentAt?: string;
      lastError?: string;
      payload: OfflineNotaPayload;
    }
  | {
      kind: 'stock-delta';
      sequence: number;
      operationId: string;
      idempotencyKey: string;
      createdAt: string;
      status: CoreDeferredStatus;
      firstSentAt?: string;
      lastError?: string;
      payload: OfflineStockPayload;
    }
  | {
      kind: 'stock-count';
      sequence: number;
      operationId: string;
      idempotencyKey: string;
      createdAt: string;
      status: CoreDeferredStatus;
      firstSentAt?: string;
      lastError?: string;
      payload: OfflineStockCountPayload;
    }
  | {
      kind: 'nota-mutation';
      sequence: number;
      operationId: string;
      idempotencyKey: string;
      createdAt: string;
      status: CoreDeferredStatus;
      firstSentAt?: string;
      lastError?: string;
      resolution?: OfflineNotaConflictResolution;
      payload: OfflineNotaMutationPayload;
    };

export interface CoreOfflineConflict {
  operationId: string;
  conflict: CoreConflict;
  errorCode?: string;
}

export interface CoreLocalEnvelope {
  cacheVersion: 4;
  installationId: string;
  trustedV2Bootstrap?: true;
  state: DemoState;
  serverRevision: string;
  balanceVersions: Record<string, string>;
  notaVersions: Record<string, CoreNotaVersionState>;
  outbox: CoreOutboxItem[];
  quarantinedOutbox: CoreOutboxItem[];
  deferredOutbox: CoreDeferredCommand[];
  nextDeferredSequence: number;
  provisionalNotas: NotaTransaction[];
  offlineConflicts: CoreOfflineConflict[];
  quarantine: {
    active: boolean;
    quarantinedAt?: string;
    installationId?: string;
  };
}

const decimalCursor = z.string().regex(/^(0|[1-9]\d*)$/);
const uuid = z.string().uuid();
const deferredStatus = z.enum([
  'deferred',
  'sending',
  'error',
  'blocked',
  'quarantined',
  'conflict',
]);
const commonDeferred = {
  sequence: z.number().int().safe().min(1),
  operationId: uuid,
  idempotencyKey: uuid,
  createdAt: timestampSchema,
  status: deferredStatus,
  firstSentAt: timestampSchema.optional(),
  lastError: z.string().max(512).optional(),
};
const legacyCommonDeferred = {
  operationId: uuid,
  idempotencyKey: uuid,
  createdAt: timestampSchema,
  status: deferredStatus,
  firstSentAt: timestampSchema.optional(),
  lastError: z.string().max(512).optional(),
};
const deferredCommandSchema: z.ZodType<CoreDeferredCommand> =
  z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('offline-nota'),
        ...commonDeferred,
        payload: z
          .object({
            provisionalId: uuid,
            snapshot: notaTransactionSchema,
            completed: z.boolean(),
            destination: z.enum(['archive', 'finished']),
            skuSnapshots: z
              .array(
                z
                  .object({
                    skuId: uuid,
                    identifier: z.string().trim().min(1).max(512),
                    name: z.string().trim().min(1).max(512),
                    referencePrice: z.number().int().safe().min(0),
                  })
                  .strict(),
              )
              .max(390),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('stock-delta'),
        ...commonDeferred,
        payload: z
          .object({
            skuId: uuid,
            skuIdentifier: z.string().trim().min(1).max(512),
            skuName: z.string().trim().min(1).max(512),
            referencePrice: z.number().int().safe().min(0),
            delta: z.number().int().safe().refine((value) => value !== 0),
            reason: z.string().trim().min(1).max(512),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('stock-count'),
        ...commonDeferred,
        payload: z
          .object({
            skuId: uuid,
            observedQuantityPcs: z.number().int().safe(),
            countedQuantityPcs: z.number().int().safe(),
            baseBalanceVersion: z.string().regex(/^[1-9]\d*$/).optional(),
            countedAt: timestampSchema,
            note: z.string().trim().max(512).optional(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('nota-mutation'),
        ...commonDeferred,
        payload: z
          .object({
            notaId: uuid,
            targetKey: z.string().min(1).max(512),
            method: z.enum(['POST', 'PATCH', 'DELETE']),
            path: z.string().startsWith('/v1/'),
            body: coreJsonValueSchema,
            dependsOn: z.array(uuid),
            optimistic: coreOptimisticChangeSchema,
          })
          .strict(),
        resolution: z
          .object({
            conflictId: uuid,
            choice: z.enum(['mine', 'server']),
            idempotencyKey: uuid,
            firstSentAt: timestampSchema.optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  ]);
const legacyDeferredCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('offline-nota'),
      ...legacyCommonDeferred,
      payload: z
        .object({
          provisionalId: uuid,
          snapshot: notaTransactionSchema,
          completed: z.boolean(),
          destination: z.enum(['archive', 'finished']),
          skuSnapshots: z
            .array(
              z
                .object({
                  skuId: uuid,
                  identifier: z.string().trim().min(1).max(512),
                  name: z.string().trim().min(1).max(512),
                  referencePrice: z.number().int().safe().min(0),
                })
                .strict(),
            )
            .max(390),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('stock-delta'),
      ...legacyCommonDeferred,
      payload: z
        .object({
          skuId: uuid,
          skuIdentifier: z.string().trim().min(1).max(512),
          skuName: z.string().trim().min(1).max(512),
          referencePrice: z.number().int().safe().min(0),
          delta: z.number().int().safe().refine((value) => value !== 0),
          reason: z.string().trim().min(1).max(512),
        })
        .strict(),
    })
    .strict(),
]);
const offlineConflictSchema: z.ZodType<CoreOfflineConflict> = z
  .object({
    operationId: uuid,
    conflict: coreConflictSchema,
    errorCode: z.string().max(128).optional(),
  })
  .strict();
const quarantineSchema = z
  .object({
    active: z.boolean(),
    quarantinedAt: timestampSchema.optional(),
    installationId: uuid.optional(),
  })
  .strict()
  .superRefine((quarantine, context) => {
    if (quarantine.active && !quarantine.installationId) {
      context.addIssue({
        code: 'custom',
        message: 'Active quarantine requires an installation ID.',
      });
    }
  });
const localEnvelopeSchema: z.ZodType<CoreLocalEnvelope> = z
  .object({
    cacheVersion: z.literal(CORE_CACHE_VERSION),
    installationId: uuid,
    trustedV2Bootstrap: z.literal(true).optional(),
    state: demoStateSchema,
    serverRevision: decimalCursor,
    balanceVersions: z.record(uuid, z.string().regex(/^[1-9]\d*$/)),
    notaVersions: z.record(uuid, coreNotaVersionStateSchema).default({}),
    outbox: z.array(coreOutboxItemSchema),
    quarantinedOutbox: z.array(coreOutboxItemSchema),
    deferredOutbox: z.array(deferredCommandSchema),
    nextDeferredSequence: z.number().int().safe().min(1),
    provisionalNotas: z.array(notaTransactionSchema),
    offlineConflicts: z.array(offlineConflictSchema),
    quarantine: quarantineSchema,
  })
  .strict()
  .superRefine((envelope, context) => {
    if (
      envelope.quarantine.active &&
      (envelope.outbox.length > 0 ||
        envelope.quarantine.installationId !== envelope.installationId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Active quarantine must own all normal pending work.',
      });
    }
    if (
      !envelope.quarantine.active &&
      envelope.quarantinedOutbox.length > 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Inactive quarantine cannot retain pending work.',
      });
    }
    let previousSequence = 0;
    for (const [index, command] of envelope.deferredOutbox.entries()) {
      if (command.sequence <= previousSequence) {
        context.addIssue({
          code: 'custom',
          path: ['deferredOutbox', index, 'sequence'],
          message: 'Deferred command sequence must be strictly increasing.',
        });
      }
      previousSequence = command.sequence;
    }
    if (envelope.nextDeferredSequence <= previousSequence) {
      context.addIssue({
        code: 'custom',
        path: ['nextDeferredSequence'],
        message: 'Next deferred sequence must exceed every stored command.',
      });
    }
  });

function upgradeLegacyDemoState(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const state = value as Record<string, unknown>;
  const skus = Array.isArray(state.skus)
    ? state.skus.map((sku) =>
        typeof sku === 'object' && sku !== null && !Array.isArray(sku)
          ? {
              ...(sku as Record<string, unknown>),
              identifiers: Array.isArray(
                Reflect.get(sku, 'identifiers'),
              )
                ? Reflect.get(sku, 'identifiers')
                : [],
            }
          : sku,
      )
    : state.skus;
  return {
    ...state,
    skus,
    stockChecks: Array.isArray(state.stockChecks) ? state.stockChecks : [],
  };
}

const legacyDemoStateSchema = z.preprocess(
  upgradeLegacyDemoState,
  demoStateSchema,
);

const legacyV1EnvelopeSchema = z
  .object({
    cacheVersion: z.literal(1),
    state: legacyDemoStateSchema,
    serverRevision: decimalCursor,
    outbox: z.array(coreOutboxItemSchema),
  })
  .strict();
const legacyV2EnvelopeSchema = z
  .object({
    cacheVersion: z.literal(2),
    installationId: uuid,
    state: legacyDemoStateSchema,
    serverRevision: decimalCursor,
    outbox: z.array(coreOutboxItemSchema),
    deferredOutbox: z.array(legacyDeferredCommandSchema),
    provisionalNotas: z.array(notaTransactionSchema),
    offlineConflicts: z.array(offlineConflictSchema),
    quarantine: z
      .object({
        active: z.boolean(),
        quarantinedAt: timestampSchema.optional(),
      })
      .strict(),
  })
  .strict();
const legacyV3EnvelopeSchema = z
  .object({
    cacheVersion: z.literal(3),
    installationId: uuid,
    state: legacyDemoStateSchema,
    serverRevision: decimalCursor,
    outbox: z.array(coreOutboxItemSchema),
    quarantinedOutbox: z.array(coreOutboxItemSchema),
    deferredOutbox: z.array(legacyDeferredCommandSchema),
    provisionalNotas: z.array(notaTransactionSchema),
    offlineConflicts: z.array(offlineConflictSchema),
    quarantine: quarantineSchema,
  })
  .strict();

export function parseCoreLocalEnvelope(value: unknown): CoreLocalEnvelope {
  return cloneCore(localEnvelopeSchema.parse(value));
}

export function migrateCoreCache(
  value: unknown,
  uuidFactory: () => string = () => crypto.randomUUID(),
): CoreLocalEnvelope {
  const current = localEnvelopeSchema.safeParse(value);
  if (current.success) return cloneCore(current.data);
  const v3 = legacyV3EnvelopeSchema.safeParse(value);
  if (v3.success) {
    return {
      ...cloneCore(v3.data),
      cacheVersion: CORE_CACHE_VERSION,
      deferredOutbox: v3.data.deferredOutbox.map((command, index) => ({
        ...cloneCore(command),
        sequence: index + 1,
      })),
      balanceVersions: {},
      notaVersions: {},
      nextDeferredSequence: v3.data.deferredOutbox.length + 1,
    };
  }
  const installationId = uuid.parse(uuidFactory());
  const v2 = legacyV2EnvelopeSchema.safeParse(value);
  if (v2.success) {
    rejectUnownedLegacyWork(
      v2.data.outbox.length > 0 ||
        v2.data.deferredOutbox.length > 0 ||
        v2.data.provisionalNotas.length > 0 ||
        v2.data.offlineConflicts.length > 0 ||
        v2.data.quarantine.active,
    );
    return {
      ...cloneCore(v2.data),
      cacheVersion: CORE_CACHE_VERSION,
      installationId,
      outbox: [],
      quarantinedOutbox: [],
      deferredOutbox: [],
      balanceVersions: {},
      notaVersions: {},
      nextDeferredSequence: 1,
      quarantine: { active: false },
    };
  }
  const legacy = legacyV1EnvelopeSchema.parse(value);
  rejectUnownedLegacyWork(legacy.outbox.length > 0);
  return {
    cacheVersion: CORE_CACHE_VERSION,
    installationId,
    state: cloneCore(legacy.state),
    serverRevision: legacy.serverRevision,
    balanceVersions: {},
    notaVersions: {},
    outbox: cloneCore(legacy.outbox),
    quarantinedOutbox: [],
    deferredOutbox: [],
    nextDeferredSequence: 1,
    provisionalNotas: [],
    offlineConflicts: [],
    quarantine: { active: false },
  };
}

export function emptyCoreLocalEnvelope(
  state: DemoState,
  installationId: string,
): CoreLocalEnvelope {
  return {
    cacheVersion: CORE_CACHE_VERSION,
    installationId: uuid.parse(installationId),
    state: cloneCore(state),
    serverRevision: '0',
    balanceVersions: {},
    notaVersions: {},
    outbox: [],
    quarantinedOutbox: [],
    deferredOutbox: [],
    nextDeferredSequence: 1,
    provisionalNotas: [],
    offlineConflicts: [],
    quarantine: { active: false },
  };
}

export function asOfflineJson(value: unknown): CoreJsonValue {
  return value as CoreJsonValue;
}

export class CoreLocalStore {
  private envelope?: CoreLocalEnvelope;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: CoreGatewayStorage,
    private readonly uuidFactory: () => string = () => crypto.randomUUID(),
  ) {}

  prime(raw: unknown, nativeInstallationId?: string): CoreLocalEnvelope {
    if (this.envelope) return cloneCore(this.envelope);
    const installationId = uuid.parse(
      nativeInstallationId ?? this.uuidFactory(),
    );
    const envelope =
      raw === undefined || raw === null
        ? emptyCoreLocalEnvelope(emptyCoreState(), installationId)
        : migrateCoreCache(raw, () => installationId);
    if (envelope.installationId !== installationId) {
      throw new CoreLocalOwnershipError(
        'Cache belongs to a different installation.',
      );
    }
    this.envelope = envelope;
    return cloneCore(envelope);
  }

  load(): Promise<CoreLocalEnvelope> {
    return this.exclusive(async () => cloneCore(await this.ensureLoaded()));
  }

  async loadCanonical(): Promise<CoreCacheEnvelope> {
    const envelope = await this.load();
    return {
      cacheVersion: 1,
      state: cloneCore(envelope.state),
      serverRevision: envelope.serverRevision,
      outbox: cloneCore(envelope.outbox),
      notaVersions: cloneCore(envelope.notaVersions),
    };
  }

  saveCanonical(canonical: CoreCacheEnvelope): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.ensureLoaded();
      const next: CoreLocalEnvelope = {
        ...current,
        state: cloneCore(canonical.state),
        serverRevision: canonical.serverRevision,
        notaVersions: cloneCore(canonical.notaVersions ?? current.notaVersions),
        outbox: current.quarantine.active
          ? []
          : cloneCore(canonical.outbox),
      };
      await this.saveRaw(next);
      this.envelope = next;
    });
  }

  update(
    updater: (envelope: CoreLocalEnvelope) => CoreLocalEnvelope,
  ): Promise<CoreLocalEnvelope> {
    return this.exclusive(async () => {
      const current = await this.ensureLoaded();
      const next = parseCoreLocalEnvelope(updater(cloneCore(current)));
      await this.saveRaw(next);
      this.envelope = next;
      return cloneCore(next);
    });
  }

  quarantineCurrentWork(quarantinedAt: string): Promise<CoreLocalEnvelope> {
    return this.update((envelope) => {
      const combined = new Map(
        [...envelope.quarantinedOutbox, ...envelope.outbox].map(
          (item) => [item.id, item],
        ),
      );
      return {
        ...envelope,
        outbox: [],
        quarantinedOutbox: [...combined.values()],
        deferredOutbox: envelope.deferredOutbox.map((command) =>
          command.status === 'conflict' || command.status === 'blocked'
            ? command
            : {
                ...command,
                status: 'quarantined',
                lastError: 'Akses perangkat dicabut.',
              },
        ),
        quarantine: {
          active: true,
          quarantinedAt,
          installationId: envelope.installationId,
        },
      };
    });
  }

  async resumeQuarantinedWork(
    nativeInstallationId: string,
  ): Promise<boolean> {
    const expected = uuid.parse(nativeInstallationId);
    const current = await this.load();
    if (!current.quarantine.active) return true;
    if (
      current.installationId !== expected ||
      current.quarantine.installationId !== expected
    ) {
      return false;
    }
    await this.update((envelope) => ({
      ...envelope,
      outbox: cloneCore(envelope.quarantinedOutbox),
      quarantinedOutbox: [],
      quarantine: { active: false },
      deferredOutbox: envelope.deferredOutbox.map((command) =>
        command.status === 'quarantined'
          ? { ...command, status: 'error', lastError: undefined }
          : command,
      ),
    }));
    return true;
  }

  canonicalStorage(): CoreGatewayStorage {
    return {
      load: () => this.loadCanonical(),
      save: (envelope) => this.saveCanonical(envelope),
    };
  }

  private async ensureLoaded(): Promise<CoreLocalEnvelope> {
    if (this.envelope) return this.envelope;
    const raw = await this.storage.load();
    return this.prime(raw);
  }

  private saveRaw(envelope: CoreLocalEnvelope): Promise<void> {
    return (
      this.storage.save as unknown as (
        value: CoreLocalEnvelope,
      ) => Promise<void>
    )(cloneCore(envelope));
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => undefined).then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
