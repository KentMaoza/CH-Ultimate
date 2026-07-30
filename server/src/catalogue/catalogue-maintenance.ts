import type { MaintenanceLifecycle } from '../maintenance.js';

const DEFAULT_STAGE_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1_000;

interface MaintenanceTimer {
  unref(): void;
}

interface StagePurger {
  purgeExpiredStagedBytes(): Promise<number>;
}

interface CatalogueMaintenanceOptions {
  intervalMs?: number;
  schedule?: (
    callback: () => void,
    intervalMs: number,
  ) => MaintenanceTimer;
  clear?: (timer: MaintenanceTimer) => void;
}

export class CatalogueMaintenance implements MaintenanceLifecycle {
  private readonly intervalMs: number;
  private readonly schedule: NonNullable<
    CatalogueMaintenanceOptions['schedule']
  >;
  private readonly clear: NonNullable<CatalogueMaintenanceOptions['clear']>;
  private timer: MaintenanceTimer | undefined;

  constructor(
    private readonly imageWorker: MaintenanceLifecycle,
    private readonly stagePurger: StagePurger,
    options: CatalogueMaintenanceOptions = {},
  ) {
    this.intervalMs =
      options.intervalMs ?? DEFAULT_STAGE_PURGE_INTERVAL_MS;
    this.schedule =
      options.schedule ??
      ((callback, intervalMs) => setInterval(callback, intervalMs));
    this.clear =
      options.clear ??
      ((timer) => clearInterval(timer as NodeJS.Timeout));
  }

  start(): void {
    if (this.timer) return;
    this.imageWorker.start();
    void this.runOnce().catch(() => undefined);
    this.timer = this.schedule(() => {
      void this.runOnce().catch(() => undefined);
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    this.clear(this.timer);
    this.timer = undefined;
    this.imageWorker.stop();
  }

  runOnce(): Promise<number> {
    return this.stagePurger.purgeExpiredStagedBytes();
  }
}
