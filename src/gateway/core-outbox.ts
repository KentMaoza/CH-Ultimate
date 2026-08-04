import type { CoreApiResponse, CoreApiTransport } from './core-api-transport';
import { CORE_API_PATHS } from './core-api-types';
import { coreConflictSchema } from './core-cache';
import type {
  CoreDeferredCommand,
  CoreLocalEnvelope,
  OfflineSkuSnapshot,
  OfflineStockCountPayload,
  OfflineStockPayload,
} from './core-local-store';
import { asOfflineJson, CoreLocalStore } from './core-local-store';
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
    operationId: string,
    choice: 'mine' | 'server',
  ): Promise<boolean> {
    const current = await this.store.load();
    if (
      !current.deferredOutbox.some(
        (candidate) =>
          candidate.operationId === operationId &&
          candidate.status === 'conflict',
      )
    ) {
      return false;
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

  private async runPump(): Promise<void> {
    while (true) {
      const envelope = await this.store.load();
      if (envelope.quarantine.active) return;
      const blockedEntities = new Set(
        envelope.deferredOutbox
          .filter(
            (command) =>
              command.status === 'conflict' ||
              command.status === 'quarantined',
          )
          .map(deferredEntityKey),
      );
      const candidate = envelope.deferredOutbox.find(
        (command) =>
          command.status !== 'conflict' &&
          command.status !== 'quarantined' &&
          !blockedEntities.has(deferredEntityKey(command)),
      );
      if (!candidate) return;
      const firstSentAt =
        candidate.firstSentAt ?? this.dependencies.now().toISOString();
      const sending = await this.store.update((current) => ({
        ...current,
        deferredOutbox: current.deferredOutbox.map((command) =>
          command.operationId === candidate.operationId
            ? {
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
          method: 'POST',
          path:
            command.kind === 'offline-nota'
              ? CORE_API_PATHS.offlineNotas
              : command.kind === 'stock-delta'
                ? CORE_API_PATHS.offlineStockAdjustments
                : CORE_API_PATHS.offlineStockChecks,
          body: command.payload,
          idempotencyKey: command.idempotencyKey,
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
        await this.markError(
          command.operationId,
          responseError(response),
          permanent,
          response.body,
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
          deferredOutbox: acknowledged.deferredOutbox.filter(
            (item) => item.operationId !== command.operationId,
          ),
        };
      });
    }
  }

  private async markError(
    operationId: string,
    error: unknown,
    conflict = false,
    responseBody?: unknown,
  ): Promise<void> {
    await this.store.update((envelope) => {
      const command = envelope.deferredOutbox.find(
        (candidate) => candidate.operationId === operationId,
      );
      const errorCode =
        error instanceof Error
          ? error.message.slice(0, 128)
          : 'CH Core tidak tersedia.';
      const serverConflict =
        responseBody &&
        typeof responseBody === 'object' &&
        !Array.isArray(responseBody)
          ? Reflect.get(responseBody, 'conflict')
          : undefined;
      const parsedConflict = coreConflictSchema.safeParse(serverConflict);
      const retainedConflict =
        conflict && command
          ? {
              operationId,
              errorCode,
              conflict:
                parsedConflict.success
                  ? parsedConflict.data
                  : {
                      id: operationId,
                      entityType:
                        command.kind === 'offline-nota'
                          ? 'nota'
                          : 'stock_balance',
                      entityId:
                        command.kind === 'offline-nota'
                          ? command.payload.provisionalId
                          : command.payload.skuId,
                      base: null,
                      mine: asOfflineJson(command.payload),
                      server: errorCode,
                    },
            }
          : undefined;
      return {
        ...envelope,
        deferredOutbox: envelope.deferredOutbox.map((candidate) =>
          candidate.operationId === operationId
            ? {
                ...candidate,
                status: conflict ? 'conflict' : 'error',
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
  return command.kind === 'offline-nota'
    ? `nota:${command.payload.provisionalId}`
    : `stock:${command.payload.skuId}`;
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
