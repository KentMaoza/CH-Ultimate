import type { DemoState } from '../domain/types';
import {
  type CoreCacheEnvelope,
  type CoreGatewayStorage,
  type CoreOutboxItem,
} from './core-cache';
import { CoreGatewayState } from './core-gateway-state';

type CanonicalCommitResult = 'committed' | 'stale';

export class CoreEnvelopeCoordinator {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: CoreGatewayStorage,
    private readonly state: CoreGatewayState,
  ) {}

  persistCurrent(): Promise<CoreCacheEnvelope> {
    return this.exclusive(async () => {
      const envelope = this.state.envelope();
      await this.storage.save(envelope);
      return envelope;
    });
  }

  commitCanonical(
    expectedRevision: string,
    nextState: DemoState,
    nextRevision: string,
  ): Promise<CanonicalCommitResult> {
    return this.exclusive(async () => {
      if (
        this.state.getServerRevision() !== expectedRevision ||
        BigInt(nextRevision) < BigInt(expectedRevision)
      ) {
        return 'stale';
      }
      let outboxVersion: number;
      do {
        outboxVersion = this.state.getOutboxVersion();
        await this.storage.save(
          this.state.envelope(nextState, nextRevision),
        );
      } while (outboxVersion !== this.state.getOutboxVersion());
      this.state.commitCanonical(nextState, nextRevision);
      return 'committed';
    });
  }

  replaceOutbox(
    update: (outbox: CoreOutboxItem[]) => CoreOutboxItem[],
  ): Promise<CoreCacheEnvelope> {
    return this.exclusive(async () => {
      let outboxVersion: number;
      let next: CoreOutboxItem[];
      let envelope: CoreCacheEnvelope;
      do {
        outboxVersion = this.state.getOutboxVersion();
        const current = this.state.getOutbox();
        next = update(current);
        if (next === current) {
          return this.state.envelope();
        }
        envelope = this.state.envelope(
          undefined,
          undefined,
          next,
        );
        await this.storage.save(envelope);
      } while (outboxVersion !== this.state.getOutboxVersion());
      this.state.replaceOutbox(next);
      return envelope;
    });
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
