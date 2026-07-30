import { describe, expect, it, vi } from 'vitest';

import { CatalogueMaintenance } from '../src/catalogue/catalogue-maintenance.js';

describe('catalogue maintenance', () => {
  it('runs staged-byte cleanup immediately and on a bounded interval alongside image work', async () => {
    const imageWorker = {
      start: vi.fn(),
      stop: vi.fn(),
    };
    const purger = {
      purgeExpiredStagedBytes: vi.fn(async () => 2),
    };
    let callback: (() => void) | undefined;
    const timer = { unref: vi.fn() };
    const clear = vi.fn();
    const maintenance = new CatalogueMaintenance(imageWorker, purger, {
      schedule: vi.fn((scheduled) => {
        callback = scheduled;
        return timer;
      }),
      clear,
    });

    maintenance.start();
    maintenance.start();
    await vi.waitFor(() =>
      expect(purger.purgeExpiredStagedBytes).toHaveBeenCalledOnce(),
    );
    callback?.();
    await vi.waitFor(() =>
      expect(purger.purgeExpiredStagedBytes).toHaveBeenCalledTimes(2),
    );
    maintenance.stop();

    expect(imageWorker.start).toHaveBeenCalledOnce();
    expect(imageWorker.stop).toHaveBeenCalledOnce();
    expect(timer.unref).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledWith(timer);
  });
});
