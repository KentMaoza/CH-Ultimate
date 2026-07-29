import type { DemoState } from '../domain/types';
import type { SyncSnapshot } from './operations-gateway-contract';
import { emptyCoreState } from './core-bootstrap-mapping';
import {
  cloneCore,
  coreCacheEnvelope,
  type CoreCacheEnvelope,
  type CoreOutboxItem,
} from './core-cache';
import { previewOptimisticOutbox } from './core-optimistic-state';

export class CoreGatewayState {
  private state = emptyCoreState();
  private canonicalState = cloneCore(this.state);
  private outbox: CoreOutboxItem[] = [];
  private outboxVersion = 0;
  private serverRevision = '0';
  private syncSnapshot: SyncSnapshot = {
    phase: 'connecting',
    serverRevision: '0',
    pendingCount: 0,
    conflictCount: 0,
  };
  private listeners = new Set<() => void>();
  private syncListeners = new Set<() => void>();

  getSnapshot = (): DemoState => cloneCore(this.state);

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSyncSnapshot = (): SyncSnapshot => ({ ...this.syncSnapshot });

  subscribeSync = (listener: () => void): (() => void) => {
    this.syncListeners.add(listener);
    return () => this.syncListeners.delete(listener);
  };

  getCanonicalState(): DemoState {
    return cloneCore(this.canonicalState);
  }

  getServerRevision(): string {
    return this.serverRevision;
  }

  getOutbox(): CoreOutboxItem[] {
    return cloneCore(this.outbox);
  }

  getOutboxVersion(): number {
    return this.outboxVersion;
  }

  restore(envelope: CoreCacheEnvelope): void {
    this.canonicalState = cloneCore(envelope.state);
    this.outbox = cloneCore(envelope.outbox);
    this.outboxVersion += 1;
    this.serverRevision = envelope.serverRevision;
    this.publishProjectedState();
  }

  preview(next: DemoState): void {
    this.publishState(next);
  }

  commitCanonical(next: DemoState, revision: string): void {
    this.canonicalState = cloneCore(next);
    this.serverRevision = revision;
    this.publishProjectedState();
  }

  replaceOutbox(outbox: CoreOutboxItem[]): void {
    this.outbox = cloneCore(outbox);
    this.outboxVersion += 1;
    this.publishProjectedState();
    this.publishSync({});
  }

  envelope(
    state = this.canonicalState,
    revision = this.serverRevision,
    outbox = this.outbox,
  ): CoreCacheEnvelope {
    return coreCacheEnvelope(state, revision, outbox);
  }

  publishSync(patch: Partial<SyncSnapshot>): void {
    this.syncSnapshot = {
      ...this.syncSnapshot,
      ...patch,
      serverRevision: this.serverRevision,
      pendingCount: this.outbox.length,
      conflictCount: this.outbox.filter((item) => item.conflict).length,
    };
    this.syncListeners.forEach((listener) => listener());
  }

  private publishState(next: DemoState): void {
    this.state = cloneCore(next);
    this.listeners.forEach((listener) => listener());
  }

  private publishProjectedState(): void {
    this.publishState(
      previewOptimisticOutbox(this.canonicalState, this.outbox),
    );
  }
}
