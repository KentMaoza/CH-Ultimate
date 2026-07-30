import { z } from 'zod';

import type { DemoState, NotaTransaction } from '../domain/types';
import {
  cloneCore,
  coreConflictSchema,
  coreOutboxItemSchema,
  type CoreCacheEnvelope,
  type CoreGatewayStorage,
  type CoreOutboxItem,
} from './core-cache';
import { emptyCoreState } from './core-bootstrap-mapping';
import {
  demoStateSchema,
  notaTransactionSchema,
  timestampSchema,
} from './core-domain-schemas';
import type { CoreConflict, CoreJsonValue } from './core-api-types';

export const CORE_CACHE_VERSION = 3;

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

export type CoreDeferredCommand =
  | {
      kind: 'offline-nota';
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
      operationId: string;
      idempotencyKey: string;
      createdAt: string;
      status: CoreDeferredStatus;
      firstSentAt?: string;
      lastError?: string;
      payload: OfflineStockPayload;
    };

export interface CoreOfflineConflict {
  operationId: string;
  conflict: CoreConflict;
  errorCode?: string;
}

export interface CoreLocalEnvelope {
  cacheVersion: 3;
  installationId: string;
  state: DemoState;
  serverRevision: string;
  outbox: CoreOutboxItem[];
  quarantinedOutbox: CoreOutboxItem[];
  deferredOutbox: CoreDeferredCommand[];
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
  'quarantined',
  'conflict',
]);
const commonDeferred = {
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
    state: demoStateSchema,
    serverRevision: decimalCursor,
    outbox: z.array(coreOutboxItemSchema),
    quarantinedOutbox: z.array(coreOutboxItemSchema),
    deferredOutbox: z.array(deferredCommandSchema),
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
  });

const legacyV1EnvelopeSchema = z
  .object({
    cacheVersion: z.literal(1),
    state: demoStateSchema,
    serverRevision: decimalCursor,
    outbox: z.array(coreOutboxItemSchema),
  })
  .strict();
const legacyV2EnvelopeSchema = z
  .object({
    cacheVersion: z.literal(2),
    installationId: uuid,
    state: demoStateSchema,
    serverRevision: decimalCursor,
    outbox: z.array(coreOutboxItemSchema),
    deferredOutbox: z.array(deferredCommandSchema),
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

export function parseCoreLocalEnvelope(value: unknown): CoreLocalEnvelope {
  return cloneCore(localEnvelopeSchema.parse(value));
}

export function migrateCoreCache(
  value: unknown,
  uuidFactory: () => string = () => crypto.randomUUID(),
): CoreLocalEnvelope {
  const current = localEnvelopeSchema.safeParse(value);
  if (current.success) return cloneCore(current.data);
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
    outbox: cloneCore(legacy.outbox),
    quarantinedOutbox: [],
    deferredOutbox: [],
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
    outbox: [],
    quarantinedOutbox: [],
    deferredOutbox: [],
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
    };
  }

  saveCanonical(canonical: CoreCacheEnvelope): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.ensureLoaded();
      const next: CoreLocalEnvelope = {
        ...current,
        state: cloneCore(canonical.state),
        serverRevision: canonical.serverRevision,
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
        deferredOutbox: envelope.deferredOutbox.map((command) => ({
          ...command,
          status: 'quarantined',
          lastError: 'Akses perangkat dicabut.',
        })),
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
