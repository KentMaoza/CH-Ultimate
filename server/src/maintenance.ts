import type {
  ProtocolConnection,
  ProtocolPool,
} from './sync/idempotency.js';
import {
  pruneChangeLog,
  pruneExpiredReceipts,
} from './sync/retention.js';

export const MAINTENANCE_LOCK_NAME = 'ch-core-protocol-maintenance';
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1_000;

interface MaintenanceConnection extends ProtocolConnection {
  destroy?: () => void;
}

interface MaintenanceTimer {
  unref(): void;
}

interface MaintenanceOptions {
  intervalMs?: number;
  schedule?: (
    callback: () => void,
    intervalMs: number,
  ) => MaintenanceTimer;
  clear?: (timer: MaintenanceTimer) => void;
}

export interface MaintenanceLifecycle {
  start(): void;
  stop(): void;
}

export class ProtocolMaintenance implements MaintenanceLifecycle {
  private readonly intervalMs: number;
  private readonly schedule: NonNullable<MaintenanceOptions['schedule']>;
  private readonly clear: NonNullable<MaintenanceOptions['clear']>;
  private timer: MaintenanceTimer | undefined;

  constructor(
    private readonly pool: ProtocolPool,
    options: MaintenanceOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.schedule =
      options.schedule ??
      ((callback, intervalMs) => setInterval(callback, intervalMs));
    this.clear =
      options.clear ??
      ((timer) => clearInterval(timer as NodeJS.Timeout));
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = this.schedule(() => {
      void this.runOnce().catch(() => undefined);
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    this.clear(this.timer);
    this.timer = undefined;
  }

  async runOnce(): Promise<{
    changes: number;
    receipts: number;
  } | null> {
    const connection =
      (await this.pool.getConnection()) as MaintenanceConnection;
    let lockAcquired = false;
    let safeToRelease = true;
    try {
      const rows = await connection.query<Array<{ acquired: unknown }>>(
        'SELECT GET_LOCK(?, 0) AS acquired',
        [MAINTENANCE_LOCK_NAME],
      );
      if (Number(rows[0]?.acquired) !== 1) {
        return null;
      }
      lockAcquired = true;
      const changes = await pruneChangeLog(connection);
      const receipts = await pruneExpiredReceipts(connection);
      return { changes, receipts };
    } finally {
      if (lockAcquired) {
        try {
          const rows = await connection.query<
            Array<{ released: unknown }>
          >('SELECT RELEASE_LOCK(?) AS released', [
            MAINTENANCE_LOCK_NAME,
          ]);
          safeToRelease = Number(rows[0]?.released) === 1;
        } catch {
          safeToRelease = false;
        }
      }
      if (safeToRelease) {
        await connection.release();
      } else if (connection.destroy) {
        connection.destroy();
      } else {
        await connection.release();
      }
    }
  }
}
