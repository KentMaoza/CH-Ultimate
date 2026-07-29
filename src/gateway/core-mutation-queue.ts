import {
  CORE_API_PATHS,
  parseCoreApiError,
  parseCoreMutationAcknowledgement,
  type CoreMutationAcknowledgement,
} from './core-api-types';
import {
  cloneCore,
  type CoreGatewayStorage,
  type CoreOptimisticChange,
  type CoreOutboxItem,
} from './core-cache';
import { CoreGatewayState } from './core-gateway-state';
import type {
  CoreApiMethod,
  CoreApiTransport,
} from './core-api-transport';
import {
  asCoreJson,
  mergeQueuedMutation,
  previewOptimisticOutbox,
} from './core-optimistic-state';

interface Deferred {
  promise: Promise<CoreMutationAcknowledgement>;
  resolve(value: CoreMutationAcknowledgement): void;
  reject(reason: unknown): void;
}

export interface CoreMutationSpec {
  method: Exclude<CoreApiMethod, 'GET'>;
  path: string;
  body?: unknown;
  notaId?: string;
  coalesceKey?: string;
  resolvesConflictId?: string;
  optimistic?: CoreOptimisticChange;
}

function deferred(): Deferred {
  let resolve!: Deferred['resolve'];
  let reject!: Deferred['reject'];
  const promise = new Promise<CoreMutationAcknowledgement>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export class CoreMutationQueue {
  private deferredById = new Map<string, Deferred>();
  private inFlightId?: string;
  private pumpPromise?: Promise<void>;

  constructor(
    private readonly transport: CoreApiTransport,
    private readonly storage: CoreGatewayStorage,
    private readonly state: CoreGatewayState,
    private readonly refresh: () => Promise<void>,
    private readonly now: () => Date,
  ) {}

  enqueue(spec: CoreMutationSpec): Promise<CoreMutationAcknowledgement> {
    const outbox = this.state.getOutbox();
    const existing = spec.coalesceKey
      ? outbox.find(
          (item) =>
            item.coalesceKey === spec.coalesceKey &&
            item.id !== this.inFlightId &&
            !item.conflict,
        )
      : undefined;
    const item = existing
      ? mergeQueuedMutation(existing, spec.body, spec.optimistic)
      : this.createItem(spec);
    const next = existing
      ? outbox.map((candidate) => (candidate.id === item.id ? item : candidate))
      : [...outbox, item];
    const pending = this.ensureDeferred(item.id);
    this.updateOutbox(next);
    void this.persistThenPump(item.id);
    return pending.promise;
  }

  async retryPending(): Promise<void> {
    const pending = this.state
      .getOutbox()
      .filter((item) => !item.conflict)
      .map((item) => this.ensureDeferred(item.id).promise);
    if (pending.length === 0) {
      await this.refresh();
      return;
    }
    await this.persistThenPump();
    await Promise.all(pending);
  }

  async flushNota(notaId: string): Promise<void> {
    const items = this.state
      .getOutbox()
      .filter((item) => item.notaId === notaId);
    if (items.some((item) => item.conflict)) {
      throw new Error('CONFLICT');
    }
    const pending = items
      .map((item) => this.ensureDeferred(item.id).promise);
    if (pending.length === 0) return;
    await this.persistThenPump();
    await Promise.all(pending);
  }

  async resolveConflict(
    conflictId: string,
    choice: 'mine' | 'server',
  ): Promise<void> {
    if (
      !this.state
        .getOutbox()
        .some((item) => item.conflict?.id === conflictId)
    ) {
      throw new Error('Konflik tidak ditemukan.');
    }
    await this.enqueue({
      method: 'POST',
      path: CORE_API_PATHS.resolveConflict(conflictId),
      body: { choice },
      resolvesConflictId: conflictId,
    });
  }

  private createItem(spec: CoreMutationSpec): CoreOutboxItem {
    return {
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      method: spec.method,
      path: spec.path,
      ...(spec.body === undefined ? {} : { body: asCoreJson(spec.body) }),
      createdAt: this.now().toISOString(),
      ...(spec.notaId ? { notaId: spec.notaId } : {}),
      ...(spec.coalesceKey ? { coalesceKey: spec.coalesceKey } : {}),
      ...(spec.resolvesConflictId
        ? { resolvesConflictId: spec.resolvesConflictId }
        : {}),
      ...(spec.optimistic ? { optimistic: cloneCore(spec.optimistic) } : {}),
      ...(spec.optimistic ? { optimisticActive: true } : {}),
    };
  }

  private ensureDeferred(id: string): Deferred {
    const existing = this.deferredById.get(id);
    if (existing) return existing;
    const pending = deferred();
    this.deferredById.set(id, pending);
    return pending;
  }

  private updateOutbox(outbox: CoreOutboxItem[]): void {
    this.state.replaceOutbox(outbox);
    this.state.preview(
      previewOptimisticOutbox(this.state.getCanonicalState(), outbox),
    );
  }

  private async persistThenPump(changedId?: string): Promise<void> {
    try {
      await this.storage.save(this.state.envelope());
    } catch (error) {
      this.failCurrent(changedId, error);
      return;
    }
    await this.pump();
  }

  private pump(): Promise<void> {
    this.pumpPromise ??= this.runPump().finally(() => {
      this.pumpPromise = undefined;
    });
    return this.pumpPromise;
  }

  private async runPump(): Promise<void> {
    while (true) {
      const item = this.state
        .getOutbox()
        .find((candidate) => !candidate.conflict);
      if (!item) return;
      this.inFlightId = item.id;
      try {
        const response = await this.transport.request({
          method: item.method,
          path: item.path,
          ...(item.body === undefined ? {} : { body: item.body }),
          idempotencyKey: item.idempotencyKey,
        });
        if (response.status < 200 || response.status >= 300) {
          const apiError = parseCoreApiError(response.status, response.body);
          if (apiError.code === 'CONFLICT' && 'conflict' in apiError) {
            this.storeConflict(item, apiError.conflict);
            return;
          }
          this.state.publishSync({
            phase:
              apiError.status === 401
                ? 'revoked'
                : apiError.code === 'UPGRADE_REQUIRED'
                  ? 'upgrade-required'
                  : 'offline',
            message: apiError.code,
          });
          this.failCurrent(item.id, new Error(apiError.code));
          return;
        }
        const acknowledgement = parseCoreMutationAcknowledgement(response.body);
        this.updateOutbox(
          this.state
            .getOutbox()
            .filter(
              (candidate) =>
                candidate.id !== item.id &&
                candidate.conflict?.id !== item.resolvesConflictId,
            ),
        );
        await this.storage.save(this.state.envelope());
        await this.refresh();
        this.deferredById.get(item.id)?.resolve(acknowledgement);
        this.deferredById.delete(item.id);
      } catch (error) {
        this.failCurrent(item.id, error);
        return;
      } finally {
        this.inFlightId = undefined;
      }
    }
  }

  private storeConflict(item: CoreOutboxItem, conflict: CoreOutboxItem['conflict']): void {
    this.updateOutbox(
      this.state.getOutbox().map((candidate) =>
        candidate.id === item.id
          ? { ...candidate, conflict, optimisticActive: false }
          : candidate,
      ),
    );
    void this.storage.save(this.state.envelope());
    this.state.publishSync({ phase: 'conflict', message: 'CONFLICT' });
    this.failDeferred(item.id, new Error('CONFLICT'));
  }

  private failCurrent(id: string | undefined, error: unknown): void {
    const outbox = this.state.getOutbox().map((item) =>
      id === undefined || item.id === id
        ? { ...item, optimisticActive: false }
        : item,
    );
    this.updateOutbox(outbox);
    void this.storage.save(this.state.envelope());
    this.state.publishSync({
      phase: 'offline',
      message: error instanceof Error ? error.message : 'CH Core tidak tersedia.',
    });
    if (id) this.failDeferred(id, error);
  }

  private failDeferred(id: string, error: unknown): void {
    this.deferredById.get(id)?.reject(error);
    this.deferredById.delete(id);
  }
}
