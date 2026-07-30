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
import { CoreEnvelopeCoordinator } from './core-envelope-coordinator';
import { CoreGatewayState } from './core-gateway-state';
import { CoreSyncScheduler } from './core-sync-scheduler';
import type { CoreApiTransport } from './core-api-transport';

export class CorePollingCoordinator {
  private initialization?: Promise<void>;
  private bootstrapped = false;
  private disposed = false;
  private readonly scheduler: CoreSyncScheduler;

  constructor(
    private readonly transport: CoreApiTransport,
    private readonly storage: CoreGatewayStorage,
    private readonly clock: CoreGatewayClock,
    private readonly state: CoreGatewayState,
    private readonly envelopes: CoreEnvelopeCoordinator,
    private readonly onDeviceRole: (role: 'owner' | 'client') => void,
  ) {
    this.scheduler = new CoreSyncScheduler(
      clock,
      state.getSyncSnapshot,
      () => this.syncNow(),
    );
  }

  initialize = async (): Promise<void> => {
    if (this.disposed) return;
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  };

  private async initializeOnce(): Promise<void> {
    if (this.disposed) return;
    this.scheduler.start();
    const cached = await this.storage.load();
    if (this.disposed) return;
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
    await this.scheduler.request();
  }

  private async bootstrap(): Promise<void> {
    try {
      const expectedRevision = this.state.getServerRevision();
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
      this.onDeviceRole(bootstrap.deviceRole);
      const next = mapCoreBootstrapToDemoState(bootstrap);
      const committed = await this.envelopes.commitCanonical(
        expectedRevision,
        next,
        bootstrap.serverRevision,
      );
      if (committed === 'stale') return;
      this.state.replaceRowVersions(bootstrap);
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
    await this.scheduler.request();
  }

  async refreshNow(): Promise<void> {
    await this.scheduler.request();
  }

  async reloadCanonical(): Promise<void> {
    this.bootstrapped = false;
    await this.scheduler.request();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scheduler.dispose();
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
    let candidate = this.state.getCanonicalState();
    try {
      for (const change of fresh) {
        candidate = applyCoreChange(candidate, change);
      }
      const expectedCursor = fresh.at(-1)?.revision ?? cursor;
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
      const committed = await this.envelopes.commitCanonical(
        cursor,
        candidate,
        page.nextAfter,
      );
      if (committed === 'stale') {
        await this.bootstrap();
        return;
      }
      this.state.recordChangeVersions(fresh);
    }
    this.state.publishSync({
      phase: 'online',
      lastSyncedAt: this.clock.now().toISOString(),
      message: undefined,
    });
  }
}
