import { z } from 'zod';

import {
  CORE_API_PATHS,
  CoreApiSchemaError,
  CoreApiUpgradeRequiredError,
  parseCoreApiError,
  parseCoreBootstrap,
  parseCoreChangePage,
} from './core-api-types';
import { mapCoreBootstrapToDemoState } from './core-bootstrap-mapping';
import {
  CORE_CACHE_VERSION,
  hasUnsupportedCacheVersion,
  parseCoreCache,
  type CoreGatewayClock,
  type CoreGatewayStorage,
} from './core-cache';
import {
  applyCoreChange,
  CoreChangeRequiresBootstrapError,
} from './core-change-application';
import { CoreGatewayState } from './core-gateway-state';
import type { CoreApiTransport } from './core-api-transport';

const POLL_INTERVAL_MS = 2_000;
const MAX_RETRY_MS = 30_000;

export class CorePollingCoordinator {
  private initialization?: Promise<void>;
  private cancelTimer?: () => void;
  private resumeSubscribed = false;
  private bootstrapped = false;
  private offlineFailures = 0;

  constructor(
    private readonly transport: CoreApiTransport,
    private readonly storage: CoreGatewayStorage,
    private readonly clock: CoreGatewayClock,
    private readonly state: CoreGatewayState,
  ) {}

  initialize = async (): Promise<void> => {
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  };

  private async initializeOnce(): Promise<void> {
    if (!this.resumeSubscribed) {
      this.resumeSubscribed = true;
      this.clock.subscribeResume(() => this.resume());
    }
    const cached = await this.storage.load();
    if (hasUnsupportedCacheVersion(cached)) {
      this.state.publishSync({
        phase: 'upgrade-required',
        message: `Cache versi ${CORE_CACHE_VERSION} diperlukan.`,
      });
      return;
    }
    if (cached !== undefined && cached !== null) {
      try {
        this.state.restore(parseCoreCache(cached));
      } catch {
        this.state.publishSync({
          phase: 'upgrade-required',
          message: 'Cache aplikasi tidak kompatibel.',
        });
        return;
      }
    }
    this.state.publishSync({ phase: 'connecting', message: undefined });
    if (!this.clock.isForeground()) return;
    await this.bootstrap();
    this.scheduleAfterAttempt();
  }

  private async bootstrap(): Promise<void> {
    try {
      const response = await this.transport.request({
        method: 'GET',
        path: CORE_API_PATHS.bootstrap,
      });
      if (response.status < 200 || response.status >= 300) {
        const error = parseCoreApiError(response.status, response.body);
        if (error.status === 401) {
          this.state.publishSync({
            phase: 'revoked',
            message: 'Akses perangkat dicabut.',
          });
          return;
        }
        if (error.code === 'UPGRADE_REQUIRED') {
          this.state.publishSync({
            phase: 'upgrade-required',
            message: 'Aplikasi perlu diperbarui.',
          });
          return;
        }
        throw new Error(error.code);
      }
      const bootstrap = parseCoreBootstrap(response.body);
      const next = mapCoreBootstrapToDemoState(bootstrap);
      await this.storage.save(
        this.state.envelope(next, bootstrap.serverRevision),
      );
      this.state.commitCanonical(next, bootstrap.serverRevision);
      this.bootstrapped = true;
      this.state.publishSync({
        phase: 'online',
        lastSyncedAt: this.clock.now().toISOString(),
        message: undefined,
      });
    } catch (error) {
      if (
        error instanceof CoreApiUpgradeRequiredError ||
        error instanceof CoreApiSchemaError
      ) {
        this.state.publishSync({
          phase: 'upgrade-required',
          message: error.message,
        });
        return;
      }
      this.state.publishSync({
        phase: 'offline',
        message:
          error instanceof Error ? error.message : 'CH Core tidak tersedia.',
      });
    }
  }

  async retryPending(): Promise<void> {
    this.cancelScheduled();
    await this.syncNow();
    this.scheduleAfterAttempt();
  }

  async refreshNow(): Promise<void> {
    this.cancelScheduled();
    await this.syncNow();
    this.scheduleAfterAttempt();
  }

  private async resume(): Promise<void> {
    if (!this.clock.isForeground()) return;
    this.cancelScheduled();
    await this.syncNow();
    this.scheduleAfterAttempt();
  }

  private cancelScheduled(): void {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
  }

  private scheduleAfterAttempt(): void {
    this.cancelScheduled();
    if (!this.clock.isForeground()) return;
    const phase = this.state.getSyncSnapshot().phase;
    if (phase === 'revoked' || phase === 'upgrade-required') return;
    const delay =
      phase === 'offline'
        ? Math.min(
            POLL_INTERVAL_MS * 2 ** this.offlineFailures++,
            MAX_RETRY_MS,
          )
        : POLL_INTERVAL_MS;
    if (phase !== 'offline') this.offlineFailures = 0;
    this.cancelTimer = this.clock.schedule(async () => {
      this.cancelTimer = undefined;
      if (!this.clock.isForeground()) return;
      await this.syncNow();
      this.scheduleAfterAttempt();
    }, delay);
  }

  private async syncNow(): Promise<void> {
    if (!this.bootstrapped) {
      await this.bootstrap();
      return;
    }
    try {
      await this.poll();
    } catch (error) {
      if (error instanceof CoreApiUpgradeRequiredError) {
        this.state.publishSync({
          phase: 'upgrade-required',
          message: error.message,
        });
        return;
      }
      this.state.publishSync({
        phase: 'offline',
        message:
          error instanceof Error ? error.message : 'CH Core tidak tersedia.',
      });
    }
  }

  private async poll(): Promise<void> {
    const cursor = this.state.getServerRevision();
    this.state.publishSync({ phase: 'syncing', message: undefined });
    const response = await this.transport.request({
      method: 'GET',
      path: CORE_API_PATHS.changes(cursor),
    });
    if (response.status < 200 || response.status >= 300) {
      const error = parseCoreApiError(response.status, response.body);
      if (error.status === 401) {
        this.state.publishSync({
          phase: 'revoked',
          message: 'Akses perangkat dicabut.',
        });
        return;
      }
      if (error.code === 'UPGRADE_REQUIRED') {
        this.state.publishSync({
          phase: 'upgrade-required',
          message: 'Aplikasi perlu diperbarui.',
        });
        return;
      }
      if (
        error.status === 410 ||
        (error.status === 409 &&
          'bootstrapRequired' in error &&
          error.bootstrapRequired)
      ) {
        await this.bootstrap();
        return;
      }
      throw new Error(error.code);
    }

    let page;
    try {
      page = parseCoreChangePage(response.body);
    } catch (error) {
      if (error instanceof CoreApiUpgradeRequiredError) throw error;
      if (error instanceof CoreApiSchemaError) {
        await this.bootstrap();
        return;
      }
      throw error;
    }

    const cursorValue = BigInt(cursor);
    const fresh = page.changes.filter(
      (change) => BigInt(change.revision) > cursorValue,
    );
    let expected = cursorValue + 1n;
    let candidate = this.state.getCanonicalState();
    try {
      for (const change of fresh) {
        if (BigInt(change.revision) !== expected) {
          throw new CoreChangeRequiresBootstrapError(
            'Forward change sequence gap',
          );
        }
        candidate = applyCoreChange(candidate, change);
        expected += 1n;
      }
      const expectedCursor =
        fresh.at(-1)?.revision ?? cursor;
      if (page.nextAfter !== expectedCursor) {
        throw new CoreChangeRequiresBootstrapError(
          'Change page cursor does not match its complete page',
        );
      }
    } catch (error) {
      if (
        error instanceof CoreChangeRequiresBootstrapError ||
        error instanceof CoreApiSchemaError ||
        error instanceof z.ZodError
      ) {
        await this.bootstrap();
        return;
      }
      throw error;
    }

    if (fresh.length > 0) {
      await this.storage.save(this.state.envelope(candidate, page.nextAfter));
      this.state.commitCanonical(candidate, page.nextAfter);
    }
    this.state.publishSync({
      phase: 'online',
      lastSyncedAt: this.clock.now().toISOString(),
      message: undefined,
    });
  }
}
