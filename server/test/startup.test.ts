import { describe, expect, it } from 'vitest';

import {
  startServer,
  type RuntimeApp,
  type RuntimePool,
  type StartupDependencies,
} from '../src/index.js';

interface StartupScenario {
  migrationError?: Error;
  listenError?: Error;
  closeError?: Error;
}

function startupScenario(scenario: StartupScenario): {
  deps: StartupDependencies;
  events: string[];
} {
  const events: string[] = [];
  const pool: RuntimePool = {
    async query<T>(): Promise<T> {
      throw new Error('query should not be called directly');
    },
    async getConnection() {
      throw new Error('connection should be supplied by the migration double');
    },
    async end() {
      events.push('pool.end');
    },
  };
  const app: RuntimeApp = {
    async listen() {
      events.push('app.listen');
      if (scenario.listenError) {
        throw scenario.listenError;
      }
    },
    async close() {
      events.push('app.close');
      if (scenario.closeError) {
        throw scenario.closeError;
      }
    },
  };

  return {
    events,
    deps: {
      loadConfig() {
        return {
          host: '0.0.0.0',
          port: 3000,
          databaseUrl: 'mariadb://user:password@db.internal/chu_test',
          dbPoolMax: 4,
        };
      },
      createPool() {
        events.push('createPool');
        return pool;
      },
      async migrate() {
        events.push('migrate');
        if (scenario.migrationError) {
          throw scenario.migrationError;
        }
      },
      buildApp() {
        events.push('buildApp');
        return app;
      },
    },
  };
}

describe('startServer', () => {
  it('starts and stops protocol maintenance with the server lifecycle', async () => {
    const { deps, events } = startupScenario({});
    deps.createMaintenance = () => ({
      start() {
        events.push('maintenance.start');
      },
      stop() {
        events.push('maintenance.stop');
      },
    });

    const running = await startServer({}, deps);
    await running.shutdown();

    expect(events).toEqual([
      'createPool',
      'migrate',
      'buildApp',
      'app.listen',
      'maintenance.start',
      'maintenance.stop',
      'app.close',
      'pool.end',
    ]);
  });

  it('passes startup security configuration into app construction', async () => {
    const { deps } = startupScenario({});
    const originalBuildApp = deps.buildApp;
    let received:
      | {
          pool: RuntimePool;
          config: {
            ownerBootstrapSecret?: string;
          };
        }
      | undefined;
    deps.loadConfig = () => ({
      host: '0.0.0.0',
      port: 3000,
      databaseUrl: 'mariadb://user:password@db.internal/chu_test',
      dbPoolMax: 4,
      ownerBootstrapSecret: 'b'.repeat(32),
    });
    deps.buildApp = (buildDependencies) => {
      received = buildDependencies;
      return originalBuildApp(buildDependencies);
    };

    const running = await startServer({}, deps);

    expect(received?.config.ownerBootstrapSecret).toBe('b'.repeat(32));
    await running.shutdown();
  });

  it('ends the pool when migration startup fails before the app exists', async () => {
    const startupError = new Error('migration failed');
    const { deps, events } = startupScenario({ migrationError: startupError });

    await expect(startServer({}, deps)).rejects.toBe(startupError);

    expect(events).toEqual(['createPool', 'migrate', 'pool.end']);
  });

  it('closes the app and pool when the listener fails', async () => {
    const startupError = new Error('listen failed');
    const { deps, events } = startupScenario({ listenError: startupError });

    await expect(startServer({}, deps)).rejects.toBe(startupError);

    expect(events).toEqual([
      'createPool',
      'migrate',
      'buildApp',
      'app.listen',
      'app.close',
      'pool.end',
    ]);
  });

  it('still ends the pool and rethrows the startup error when app cleanup fails', async () => {
    const startupError = new Error('listen failed');
    const { deps, events } = startupScenario({
      listenError: startupError,
      closeError: new Error('close failed'),
    });

    await expect(startServer({}, deps)).rejects.toBe(startupError);

    expect(events.at(-1)).toBe('pool.end');
  });
});
