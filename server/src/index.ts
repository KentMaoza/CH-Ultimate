import { pathToFileURL } from 'node:url';

import { buildApp as buildFastifyApp } from './app.js';
import { createCatalogueRuntime } from './catalogue/runtime.js';
import { CatalogueOperationsService } from './catalogue/operations-service.js';
import {
  loadServerConfig,
  type ServerConfig,
} from './config.js';
import {
  runMigrations,
  type MigrationPool,
  type MigrationConnection,
  type SchemaQueryPool,
} from './db/migrate.js';
import { createPool } from './db/pool.js';
import { createProtocolServices } from './http/create-protocol.js';
import {
  ProtocolMaintenance,
  type MaintenanceLifecycle,
} from './maintenance.js';
import type {
  ProtocolConnection,
  ProtocolPool,
} from './sync/idempotency.js';

export interface RuntimeConnection
  extends MigrationConnection, ProtocolConnection {}

export interface RuntimePool extends SchemaQueryPool, ProtocolPool {
  getConnection(): Promise<RuntimeConnection>;
  end(): Promise<void>;
}

export interface RuntimeApp {
  listen(options: { host: string; port: number }): Promise<unknown>;
  close(): Promise<void>;
}

export interface StartupDependencies {
  loadConfig(env: Record<string, string | undefined>): ServerConfig;
  createPool(config: ServerConfig): RuntimePool;
  migrate(pool: MigrationPool): Promise<unknown>;
  buildApp(deps: { pool: RuntimePool; config: ServerConfig }): RuntimeApp;
  createMaintenance?(
    pool: RuntimePool,
    config: ServerConfig,
  ): MaintenanceLifecycle;
}

export interface RunningServer {
  shutdown(): Promise<void>;
}

const defaultDependencies: StartupDependencies = {
  loadConfig: loadServerConfig,
  createPool,
  migrate: runMigrations,
  buildApp: ({ pool, config }) => {
    const catalogue = createCatalogueRuntime(pool, config);
    return buildFastifyApp({
      pool,
      protocol: createProtocolServices(
        pool,
        config.ownerBootstrapSecret,
      ),
      catalogue: catalogue.services,
      operations: new CatalogueOperationsService(pool),
    });
  },
  createMaintenance: (pool, config) => {
    const protocol = new ProtocolMaintenance(pool);
    const catalogue = createCatalogueRuntime(pool, config).maintenance;
    return {
      start() {
        protocol.start();
        catalogue.start();
      },
      stop() {
        catalogue.stop();
        protocol.stop();
      },
    };
  },
};

export async function startServer(
  env: Record<string, string | undefined>,
  dependencies: StartupDependencies = defaultDependencies,
): Promise<RunningServer> {
  const config = dependencies.loadConfig(env);
  const pool = dependencies.createPool(config);
  let app: RuntimeApp | undefined;
  let maintenance: MaintenanceLifecycle | undefined;

  try {
    await dependencies.migrate(pool);
    app = dependencies.buildApp({ pool, config });
    maintenance = dependencies.createMaintenance?.(pool, config);
    await app.listen({ host: config.host, port: config.port });
    maintenance?.start();
  } catch (startupError) {
    maintenance?.stop();
    try {
      await app?.close();
    } catch {
      // Preserve the startup error after making the remaining cleanup attempt.
    }
    try {
      await pool.end();
    } catch {
      // Preserve the startup error after the pool cleanup attempt.
    }
    throw startupError;
  }

  let shuttingDown = false;
  return {
    async shutdown() {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      maintenance?.stop();
      try {
        await app.close();
      } finally {
        await pool.end();
      }
    },
  };
}

async function main(): Promise<void> {
  const running = await startServer(process.env);
  const shutdown = (): void => {
    void running.shutdown().catch(() => {
      process.exitCode = 1;
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void main().catch(() => {
    console.error('CH Core failed to start');
    process.exitCode = 1;
  });
}
