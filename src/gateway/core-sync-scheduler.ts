import type { SyncSnapshot } from './operations-gateway-contract';
import type { CoreGatewayClock } from './core-cache';

const POLL_INTERVAL_MS = 2_000;
const MAX_RETRY_MS = 30_000;

export class CoreSyncScheduler {
  private active?: Promise<void>;
  private cancelTimer?: () => void;
  private unsubscribeResume?: () => void;
  private rerunRequested = false;
  private offlineFailures = 0;
  private disposed = false;

  constructor(
    private readonly clock: CoreGatewayClock,
    private readonly getSyncSnapshot: () => SyncSnapshot,
    private readonly runSync: () => Promise<void>,
  ) {}

  start(): void {
    this.unsubscribeResume ??= this.clock.subscribeResume(() => {
      if (this.clock.isForeground()) return this.request();
    });
  }

  request(): Promise<void> {
    if (this.disposed || !this.clock.isForeground()) {
      return Promise.resolve();
    }
    this.cancelScheduled();
    if (this.active) {
      this.rerunRequested = true;
      return this.active;
    }
    const active = this.runLoop();
    this.active = active;
    return active.finally(() => {
      if (this.active === active) this.active = undefined;
      this.scheduleAfterAttempt();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rerunRequested = false;
    this.cancelScheduled();
    this.unsubscribeResume?.();
    this.unsubscribeResume = undefined;
  }

  private async runLoop(): Promise<void> {
    do {
      this.rerunRequested = false;
      await this.runSync();
    } while (this.rerunRequested && !this.disposed);
  }

  private scheduleAfterAttempt(): void {
    this.cancelScheduled();
    if (this.disposed || !this.clock.isForeground()) return;
    const phase = this.getSyncSnapshot().phase;
    if (phase === 'revoked' || phase === 'upgrade-required') return;
    const delay =
      phase === 'offline'
        ? Math.min(
            POLL_INTERVAL_MS * 2 ** this.offlineFailures++,
            MAX_RETRY_MS,
          )
        : POLL_INTERVAL_MS;
    if (phase !== 'offline') this.offlineFailures = 0;
    this.cancelTimer = this.clock.schedule(() => {
      this.cancelTimer = undefined;
      return this.request();
    }, delay);
  }

  private cancelScheduled(): void {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
  }
}
