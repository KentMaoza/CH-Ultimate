import {
  CORE_API_PATHS,
  parseCoreApiError,
  parseCoreMutationAcknowledgement,
  type CoreMutationAcknowledgement,
} from './core-api-types';
import {
  type CoreCacheEnvelope,
  type CoreOutboxItem,
} from './core-cache';
import { CoreEnvelopeCoordinator } from './core-envelope-coordinator';
import { CoreGatewayState } from './core-gateway-state';
import type { CoreApiTransport } from './core-api-transport';
import {
  createOutboxItem,
  mutationDeferred,
  mutationFingerprint,
  type CoreMutationSpec,
  type MutationDeferred,
} from './core-mutation-item';
import { mergeQueuedMutation } from './core-optimistic-state';

export type { CoreMutationSpec } from './core-mutation-item';

export class CoreMutationQueue {
  private deferredById = new Map<string, MutationDeferred>();
  private durableFingerprintById = new Map<string, string>();
  private neverSentInThisProcess = new Set<string>();
  private inFlightId?: string;
  private pumpPromise?: Promise<void>;

  constructor(
    private readonly transport: CoreApiTransport,
    private readonly envelopes: CoreEnvelopeCoordinator,
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
            this.neverSentInThisProcess.has(item.id) &&
            item.id !== this.inFlightId &&
            !item.conflict,
        )
      : undefined;
    const item = existing
      ? mergeQueuedMutation(existing, spec.body, spec.optimistic)
      : createOutboxItem(spec, this.now());
    const next = existing
      ? outbox.map((candidate) => (candidate.id === item.id ? item : candidate))
      : [...outbox, item];
    const pending = this.ensureDeferred(item.id);
    if (!existing) this.neverSentInThisProcess.add(item.id);
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
    while (true) {
      const items = this.state
        .getOutbox()
        .filter((item) => item.notaId === notaId);
      if (items.some((item) => item.conflict)) {
        throw new Error('CONFLICT');
      }
      if (items.length === 0) return;
      const pending = items.map(
        (item) => this.ensureDeferred(item.id).promise,
      );
      await this.persistThenPump();
      await Promise.all(pending);
    }
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

  private ensureDeferred(id: string): MutationDeferred {
    const existing = this.deferredById.get(id);
    if (existing) return existing;
    const pending = mutationDeferred();
    this.deferredById.set(id, pending);
    return pending;
  }

  private updateOutbox(outbox: CoreOutboxItem[]): void {
    this.state.replaceOutbox(outbox);
  }

  private async persistThenPump(changedId?: string): Promise<void> {
    try {
      this.recordDurable(await this.envelopes.persistCurrent());
    } catch (error) {
      await this.failCurrent(changedId, error);
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
      if (
        this.durableFingerprintById.get(item.id) !==
        mutationFingerprint(item)
      ) {
        return;
      }
      this.inFlightId = item.id;
      this.neverSentInThisProcess.delete(item.id);
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
            await this.storeConflict(item, apiError.conflict);
            return;
          }
          if ([400, 403, 404, 409, 422].includes(apiError.status)) {
            await this.rejectPermanent(
              item,
              new Error(coreMutationErrorMessage(apiError.code)),
            );
            continue;
          }
          const phase =
            apiError.status === 401
              ? 'revoked'
              : apiError.code === 'UPGRADE_REQUIRED'
                ? 'upgrade-required'
                : 'offline';
          await this.failCurrent(
            item.id,
            new Error(apiError.code),
            phase,
          );
          return;
        }
        const acknowledgement = parseCoreMutationAcknowledgement(response.body);
        await this.acknowledge(item, acknowledgement);
      } catch (error) {
        await this.failCurrent(item.id, error);
        return;
      } finally {
        this.inFlightId = undefined;
      }
    }
  }

  private async acknowledge(
    item: CoreOutboxItem,
    acknowledgement: CoreMutationAcknowledgement,
  ): Promise<void> {
    const hasAuthoritativeEntity = this.state.recordMutationAcknowledgement(
      item.path,
      acknowledgement,
      item.body,
    );
    try {
      this.recordDurable(
        await this.envelopes.replaceOutbox((outbox) =>
          outbox
            .filter(
              (candidate) =>
                candidate.id !== item.id &&
                (!item.resolvesConflictId ||
                  candidate.conflict?.id !== item.resolvesConflictId),
            )
            .map((candidate) =>
              hasAuthoritativeEntity &&
              this.neverSentInThisProcess.has(candidate.id)
                ? this.state.rebaseNeverSentItem(candidate, item.path)
                : candidate,
            ),
        ),
      );
      this.durableFingerprintById.delete(item.id);
      this.neverSentInThisProcess.delete(item.id);
    } catch (error) {
      this.state.publishSync({
        phase: 'offline',
        message:
          error instanceof Error ? error.message : 'Cache tidak tersedia.',
      });
      this.resolveDeferred(item.id, acknowledgement);
      void this.refresh();
      return;
    }
    this.resolveDeferred(item.id, acknowledgement);
    void this.refresh();
  }

  private async storeConflict(
    item: CoreOutboxItem,
    conflict: CoreOutboxItem['conflict'],
  ): Promise<void> {
    try {
      this.recordDurable(
        await this.envelopes.replaceOutbox((outbox) =>
          outbox.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, conflict, optimisticActive: false }
              : candidate,
          ),
        ),
      );
    } catch {
      // The live outbox remains replayable when conflict persistence fails.
    }
    this.state.publishSync({ phase: 'conflict', message: 'CONFLICT' });
    this.failDeferred(item.id, new Error('CONFLICT'));
  }

  private async rejectPermanent(
    item: CoreOutboxItem,
    error: Error,
  ): Promise<void> {
    try {
      this.recordDurable(
        await this.envelopes.replaceOutbox((outbox) =>
          outbox.filter((candidate) => candidate.id !== item.id),
        ),
      );
      this.durableFingerprintById.delete(item.id);
      this.neverSentInThisProcess.delete(item.id);
      this.state.publishSync({ phase: 'online', message: error.message });
      this.failDeferred(item.id, error);
    } catch (persistenceError) {
      await this.failCurrent(item.id, persistenceError);
    }
  }

  private async failCurrent(
    id: string | undefined,
    error: unknown,
    phase: 'offline' | 'revoked' | 'upgrade-required' = 'offline',
  ): Promise<void> {
    try {
      this.recordDurable(
        await this.envelopes.replaceOutbox((outbox) =>
          outbox.map((item) =>
            id === undefined || item.id === id
              ? { ...item, optimisticActive: false }
              : item,
          ),
        ),
      );
    } catch {
      // Keep the last durable candidate unchanged when cache writes fail.
    }
    this.state.publishSync({
      phase,
      message:
        error instanceof Error ? error.message : 'CH Core tidak tersedia.',
    });
    if (id) this.failDeferred(id, error);
  }

  private recordDurable(envelope: CoreCacheEnvelope): void {
    for (const item of envelope.outbox) {
      this.durableFingerprintById.set(
        item.id,
        mutationFingerprint(item),
      );
    }
  }

  private resolveDeferred(
    id: string,
    acknowledgement: CoreMutationAcknowledgement,
  ): void {
    this.deferredById.get(id)?.resolve(acknowledgement);
    this.deferredById.delete(id);
  }

  private failDeferred(id: string, error: unknown): void {
    this.deferredById.get(id)?.reject(error);
    this.deferredById.delete(id);
  }
}

function coreMutationErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    IDENTIFIER_CONFLICT: 'Nomor SKU atau alias sudah digunakan.',
    SKU_NOT_ACTIVE:
      'SKU sudah diarsipkan atau tidak tersedia. Sinkronkan ulang lalu coba lagi.',
    STOCK_NOT_TRACKED: 'Stok SKU ini tidak dilacak.',
    SKU_NOT_FOUND: 'SKU tidak ditemukan. Sinkronkan ulang lalu coba lagi.',
    INVALID_REQUEST: 'Data perubahan tidak valid. Periksa isian lalu coba lagi.',
    FORBIDDEN: 'Perangkat ini tidak diizinkan melakukan perubahan tersebut.',
  };
  return messages[code] ?? `Perubahan ditolak oleh CH Core (${code}).`;
}
