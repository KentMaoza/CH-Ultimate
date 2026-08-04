import type { CoreApiResponse, CoreApiTransport } from './core-api-transport';
import { CORE_API_PATHS } from './core-api-types';
import { coreConflictSchema } from './core-cache';
import type {
  CoreDeferredCommand,
  CoreLocalEnvelope,
  OfflineNotaMutationPayload,
  OfflineSkuSnapshot,
  OfflineStockCountPayload,
  OfflineStockPayload,
} from './core-local-store';
import { CoreLocalStore } from './core-local-store';
import type { NotaTransaction } from '../domain/types';

interface DeferredOutboxDependencies {
  now(): Date;
  uuid(): string;
  acknowledge?(
    envelope: CoreLocalEnvelope,
    command: CoreDeferredCommand,
    response: CoreApiResponse,
  ): CoreLocalEnvelope;
  onRevoked?(): void | Promise<void>;
}

const defaults: DeferredOutboxDependencies = {
  now: () => new Date(),
  uuid: () => crypto.randomUUID(),
};

export class CoreDeferredOutbox {
  private readonly dependencies: DeferredOutboxDependencies;
  private pumping?: Promise<void>;

  constructor(
    private readonly store: CoreLocalStore,
    private readonly transport: CoreApiTransport,
    dependencies: Partial<DeferredOutboxDependencies> = {},
  ) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  async deferNota(
    snapshot: NotaTransaction,
    destination: 'archive' | 'finished' = 'archive',
    skuSnapshots?: OfflineSkuSnapshot[],
  ): Promise<void> {
    await this.store.update((envelope) => {
      const existing = envelope.deferredOutbox.find(
        (command) =>
          command.kind === 'offline-nota' &&
          command.payload.provisionalId === snapshot.id,
      );
      const existingNota =
        existing?.kind === 'offline-nota' ? existing : undefined;
      if (existingNota?.firstSentAt) {
        throw new Error('Sedang sinkronisasi. Tunggu konfirmasi CH Core.');
      }
      const completed = snapshot.status === 'completed';
      const nextCommand: CoreDeferredCommand = existingNota
        ? {
            ...existingNota,
            status: 'deferred',
            lastError: undefined,
            payload: {
              provisionalId: snapshot.id,
              snapshot,
              completed,
              destination,
              skuSnapshots:
                skuSnapshots ?? existingNota.payload.skuSnapshots,
            },
          }
        : {
            kind: 'offline-nota',
            sequence: envelope.nextDeferredSequence,
            operationId: this.dependencies.uuid(),
            idempotencyKey: '',
            createdAt: this.dependencies.now().toISOString(),
            status: 'deferred',
            payload: {
              provisionalId: snapshot.id,
              snapshot,
              completed,
              destination,
              skuSnapshots: skuSnapshots ?? [],
            },
          };
      if (!nextCommand.idempotencyKey) {
        nextCommand.idempotencyKey = nextCommand.operationId;
      }
      return {
        ...envelope,
        provisionalNotas: [
          ...envelope.provisionalNotas.filter(
            (nota) => nota.id !== snapshot.id,
          ),
          snapshot,
        ],
        deferredOutbox: existingNota
          ? envelope.deferredOutbox.map((command) =>
              command.operationId === existingNota.operationId
                ? nextCommand
                : command,
            )
          : [...envelope.deferredOutbox, nextCommand],
        nextDeferredSequence: existingNota
          ? envelope.nextDeferredSequence
          : envelope.nextDeferredSequence + 1,
      };
    });
  }

  async deferStock(payload: OfflineStockPayload): Promise<void> {
    const operationId = this.dependencies.uuid();
    await this.store.update((envelope) => ({
      ...envelope,
      deferredOutbox: [
        ...envelope.deferredOutbox,
        {
          kind: 'stock-delta',
          sequence: envelope.nextDeferredSequence,
          operationId,
          idempotencyKey: operationId,
          createdAt: this.dependencies.now().toISOString(),
          status: 'deferred',
          payload,
        },
      ],
      nextDeferredSequence: envelope.nextDeferredSequence + 1,
    }));
  }

  async deferStockCount(payload: OfflineStockCountPayload): Promise<void> {
    const operationId = this.dependencies.uuid();
    await this.store.update((envelope) => ({
      ...envelope,
      deferredOutbox: [
        ...envelope.deferredOutbox,
        {
          kind: 'stock-count',
          sequence: envelope.nextDeferredSequence,
          operationId,
          idempotencyKey: operationId,
          createdAt: this.dependencies.now().toISOString(),
          status: 'deferred',
          payload,
        },
      ],
      nextDeferredSequence: envelope.nextDeferredSequence + 1,
    }));
  }

  async deferNotaMutation(payload: OfflineNotaMutationPayload): Promise<string> {
    const operationId = this.dependencies.uuid();
    let durableOperationId = operationId;
    await this.store.update((envelope) => {
      const existing = envelope.deferredOutbox.find(
        (command) =>
          command.kind === 'nota-mutation' &&
          command.payload.targetKey === payload.targetKey &&
          !command.firstSentAt &&
          command.status !== 'conflict' &&
          command.status !== 'quarantined',
      );
      if (existing?.kind === 'nota-mutation') {
        durableOperationId = existing.operationId;
        return {
          ...envelope,
          deferredOutbox: envelope.deferredOutbox.map((command) =>
            command.operationId === existing.operationId
              ? {
                  ...existing,
                  status: 'deferred',
                  lastError: undefined,
                  payload,
                }
              : command,
          ),
        };
      }
      return applyDeferredNotaVersionEffect({
        ...envelope,
        deferredOutbox: [
          ...envelope.deferredOutbox,
          {
            kind: 'nota-mutation',
            sequence: envelope.nextDeferredSequence,
            operationId,
            idempotencyKey: operationId,
            createdAt: this.dependencies.now().toISOString(),
            status: 'deferred',
            payload,
          },
        ],
        nextDeferredSequence: envelope.nextDeferredSequence + 1,
      }, payload);
    });
    return durableOperationId;
  }

  pump(onlineConfirmed: boolean): Promise<void> {
    if (!onlineConfirmed) return Promise.resolve();
    this.pumping ??= this.runPump().finally(() => {
      this.pumping = undefined;
    });
    return this.pumping;
  }

  resumeAfterReapproval(
    nativeInstallationId: string,
  ): Promise<boolean> {
    return this.store.resumeQuarantinedWork(nativeInstallationId);
  }

  async resolveConflict(
    conflictId: string,
    choice: 'mine' | 'server',
  ): Promise<boolean> {
    const current = await this.store.load();
    const conflict = current.offlineConflicts.find(
      (candidate) =>
        candidate.conflict.id === conflictId ||
        candidate.operationId === conflictId,
    );
    if (!conflict) return false;
    const operationId = conflict.operationId;
    const selected = current.deferredOutbox.find(
      (candidate) =>
        candidate.operationId === operationId &&
        candidate.status === 'conflict',
    );
    if (!selected) return false;
    if (selected.kind === 'nota-mutation') {
      const resolutionKey = this.dependencies.uuid();
      await this.store.update((envelope) => ({
        ...envelope,
        deferredOutbox: envelope.deferredOutbox.map((candidate) =>
          candidate.operationId === operationId &&
          candidate.kind === 'nota-mutation'
            ? {
                ...candidate,
                status: 'deferred',
                lastError: undefined,
                resolution: {
                  conflictId: conflict.conflict.id,
                  choice,
                  idempotencyKey: resolutionKey,
                },
              }
            : candidate,
        ),
      }));
      return true;
    }
    let found = false;
    await this.store.update((envelope) => {
      const command = envelope.deferredOutbox.find(
        (candidate) =>
          candidate.operationId === operationId &&
          candidate.status === 'conflict',
      );
      if (!command) return envelope;
      found = true;
      return {
        ...envelope,
        deferredOutbox:
          choice === 'mine'
            ? envelope.deferredOutbox.map((candidate) =>
                candidate.operationId === operationId
                  ? { ...candidate, status: 'error', lastError: undefined }
                  : candidate,
              )
            : envelope.deferredOutbox.filter(
                (candidate) => candidate.operationId !== operationId,
              ),
        provisionalNotas:
          choice === 'server' && command.kind === 'offline-nota'
            ? envelope.provisionalNotas.filter(
                (nota) => nota.id !== command.payload.provisionalId,
              )
            : envelope.provisionalNotas,
        offlineConflicts: envelope.offlineConflicts.filter(
          (candidate) => candidate.operationId !== operationId,
        ),
      };
    });
    return found;
  }

  async retryBlocked(operationId: string): Promise<boolean> {
    let found = false;
    await this.store.update((envelope) => ({
      ...envelope,
      deferredOutbox: envelope.deferredOutbox.map((command) => {
        if (
          command.operationId !== operationId ||
          command.status !== 'blocked'
        ) {
          return command;
        }
        found = true;
        return { ...command, status: 'deferred', lastError: undefined };
      }),
    }));
    return found;
  }

  async discardBlocked(operationId: string): Promise<boolean> {
    let found = false;
    await this.store.update((envelope) => {
      const command = envelope.deferredOutbox.find(
        (candidate) =>
          candidate.operationId === operationId &&
          candidate.status === 'blocked',
      );
      if (!command) return envelope;
      found = true;
      const discarded = new Set([operationId]);
      if (
        command.kind === 'nota-mutation' &&
        command.payload.optimistic.kind === 'nota-page-add'
      ) {
        for (const candidate of envelope.deferredOutbox) {
          if (
            candidate.kind === 'nota-mutation' &&
            candidate.payload.dependsOn.includes(operationId)
          ) {
            discarded.add(candidate.operationId);
          }
        }
      }
      return {
        ...envelope,
        deferredOutbox: envelope.deferredOutbox.filter(
          (candidate) => !discarded.has(candidate.operationId),
        ),
        provisionalNotas:
          command.kind === 'offline-nota'
            ? envelope.provisionalNotas.filter(
                (nota) => nota.id !== command.payload.provisionalId,
              )
            : envelope.provisionalNotas,
        offlineConflicts: envelope.offlineConflicts.filter(
          (candidate) => !discarded.has(candidate.operationId),
        ),
      };
    });
    return found;
  }

  private async runPump(): Promise<void> {
    while (true) {
      const envelope = await this.store.load();
      if (envelope.quarantine.active) return;
      const blockedEntities = new Set<string>();
      let candidate: CoreDeferredCommand | undefined;
      for (const command of envelope.deferredOutbox) {
        const entityKey = deferredEntityKey(command);
        if (
          command.status === 'conflict' ||
          command.status === 'blocked' ||
          command.status === 'quarantined'
        ) {
          blockedEntities.add(entityKey);
          continue;
        }
        if (!blockedEntities.has(entityKey)) {
          candidate = command;
          break;
        }
      }
      if (!candidate) return;
      const firstSentAt =
        candidate.kind === 'nota-mutation' && candidate.resolution
          ? candidate.resolution.firstSentAt ??
            this.dependencies.now().toISOString()
          : candidate.firstSentAt ?? this.dependencies.now().toISOString();
      const sending = await this.store.update((current) => ({
        ...current,
        deferredOutbox: current.deferredOutbox.map((command) =>
          command.operationId === candidate.operationId
            ? command.kind === 'nota-mutation' && command.resolution
              ? {
                  ...command,
                  status: 'sending',
                  lastError: undefined,
                  resolution: {
                    ...command.resolution,
                    firstSentAt,
                  },
                }
              : {
                  ...command,
                  status: 'sending',
                  firstSentAt,
                  lastError: undefined,
                }
            : command,
        ),
      }));
      const command = sending.deferredOutbox.find(
        (item) => item.operationId === candidate.operationId,
      );
      if (!command) continue;
      let response: CoreApiResponse;
      try {
        response = await this.transport.request({
          method:
            command.kind === 'nota-mutation' && command.resolution
              ? 'POST'
              : command.kind === 'nota-mutation'
              ? command.payload.method
              : 'POST',
          path:
            command.kind === 'nota-mutation' && command.resolution
              ? CORE_API_PATHS.resolveConflict(
                  command.resolution.conflictId,
                )
              : command.kind === 'offline-nota'
              ? CORE_API_PATHS.offlineNotas
              : command.kind === 'stock-delta'
                ? CORE_API_PATHS.offlineStockAdjustments
                : command.kind === 'stock-count'
                  ? CORE_API_PATHS.offlineStockChecks
                  : command.payload.path,
          body:
            command.kind === 'nota-mutation' && command.resolution
              ? { choice: command.resolution.choice }
              : command.kind === 'nota-mutation'
                ? command.payload.body
                : command.payload,
          idempotencyKey:
            command.kind === 'nota-mutation' && command.resolution
              ? command.resolution.idempotencyKey
              : command.idempotencyKey,
        });
      } catch (error) {
        await this.markError(command.operationId, error);
        return;
      }
      if (response.status === 401) {
        await this.quarantineRevoked();
        return;
      }
      if (response.status < 200 || response.status >= 300) {
        const permanent = response.status >= 400 && response.status < 500;
        const parsedConflict = permanent
          ? parseServerConflict(response.body)
          : undefined;
        await this.markError(
          command.operationId,
          responseError(response),
          parsedConflict ? 'conflict' : permanent ? 'blocked' : 'error',
          parsedConflict,
        );
        if (permanent) continue;
        return;
      }
      await this.store.update((current) => {
        const acknowledged =
          this.dependencies.acknowledge?.(
            current,
            command,
            response,
          ) ?? current;
        return {
          ...acknowledged,
          deferredOutbox: acknowledged.deferredOutbox.filter((item) => {
            if (item.operationId === command.operationId) return false;
            return !(
              command.kind === 'nota-mutation' &&
              command.resolution?.choice === 'server' &&
              command.payload.optimistic.kind === 'nota-page-add' &&
              item.kind === 'nota-mutation' &&
              item.payload.dependsOn.includes(command.operationId)
            );
          }),
          offlineConflicts:
            command.kind === 'nota-mutation' && command.resolution
            ? acknowledged.offlineConflicts.filter(
                (item) => item.operationId !== command.operationId,
              )
            : acknowledged.offlineConflicts,
        };
      });
    }
  }

  private async markError(
    operationId: string,
    error: unknown,
    status: 'error' | 'blocked' | 'conflict' = 'error',
    parsedConflict?: ReturnType<typeof parseServerConflict>,
  ): Promise<void> {
    await this.store.update((envelope) => {
      const command = envelope.deferredOutbox.find(
        (candidate) => candidate.operationId === operationId,
      );
      const errorCode =
        error instanceof Error
          ? error.message.slice(0, 128)
          : 'CH Core tidak tersedia.';
      const retainedConflict =
        status === 'conflict' && parsedConflict && command
          ? {
              operationId,
              errorCode,
              conflict: parsedConflict,
            }
          : undefined;
      return {
        ...envelope,
        deferredOutbox: envelope.deferredOutbox.map((candidate) =>
          candidate.operationId === operationId
            ? {
                ...candidate,
                status,
                lastError:
                  error instanceof Error
                    ? error.message.slice(0, 512)
                    : 'CH Core tidak tersedia.',
              }
            : candidate,
        ),
        offlineConflicts: retainedConflict
          ? [
              ...envelope.offlineConflicts.filter(
                (candidate) => candidate.operationId !== operationId,
              ),
              retainedConflict,
            ]
          : envelope.offlineConflicts,
      };
    });
  }

  async quarantineRevoked(): Promise<void> {
    const now = this.dependencies.now().toISOString();
    await this.store.quarantineCurrentWork(now);
    await this.dependencies.onRevoked?.();
  }
}

function deferredEntityKey(command: CoreDeferredCommand): string {
  if (command.kind === 'offline-nota') {
    return `nota:${command.payload.provisionalId}`;
  }
  if (command.kind === 'nota-mutation') {
    return `nota:${command.payload.notaId}`;
  }
  return `stock:${command.payload.skuId}`;
}

function responseError(response: CoreApiResponse): Error {
  const candidate =
    response.body &&
    typeof response.body === 'object' &&
    !Array.isArray(response.body)
      ? Reflect.get(response.body, 'code')
      : undefined;
  const code =
    typeof candidate === 'string'
      ? candidate
      : `HTTP_${response.status}`;
  return new Error(code);
}

function parseServerConflict(responseBody: unknown) {
  if (
    !responseBody ||
    typeof responseBody !== 'object' ||
    Array.isArray(responseBody)
  ) {
    return undefined;
  }
  const parsed = coreConflictSchema.safeParse(
    Reflect.get(responseBody, 'conflict'),
  );
  return parsed.success ? parsed.data : undefined;
}

function applyDeferredNotaVersionEffect(
  envelope: CoreLocalEnvelope,
  payload: OfflineNotaMutationPayload,
): CoreLocalEnvelope {
  const version = envelope.notaVersions[payload.notaId];
  if (!version) return envelope;
  if (payload.optimistic.kind === 'nota-page-add') {
    const page = payload.optimistic.page;
    return {
      ...envelope,
      notaVersions: {
        ...envelope.notaVersions,
        [payload.notaId]: {
          ...version,
          structureVersion: incrementVersion(version.structureVersion),
          pageVersions: { ...version.pageVersions, [page.id]: '1' },
          pageLifecycleVersions: {
            ...version.pageLifecycleVersions,
            [page.id]: '1',
          },
          lineVersions: {
            ...version.lineVersions,
            ...Object.fromEntries(page.lines.map((line) => [line.id, '1'])),
          },
        },
      },
    };
  }
  if (payload.optimistic.kind === 'nota-page-status') {
    const pageId = payload.optimistic.pageId;
    const pageVersion = version.pageVersions[pageId];
    const pageLifecycleVersion = version.pageLifecycleVersions[pageId];
    if (!pageVersion || !pageLifecycleVersion) return envelope;
    return {
      ...envelope,
      notaVersions: {
        ...envelope.notaVersions,
        [payload.notaId]: {
          ...version,
          structureVersion: incrementVersion(version.structureVersion),
          pageVersions: {
            ...version.pageVersions,
            [pageId]: incrementVersion(pageVersion),
          },
          pageLifecycleVersions: {
            ...version.pageLifecycleVersions,
            [pageId]: incrementVersion(pageLifecycleVersion),
          },
        },
      },
    };
  }
  return envelope;
}

function incrementVersion(version: string): string {
  return (BigInt(version) + 1n).toString();
}
