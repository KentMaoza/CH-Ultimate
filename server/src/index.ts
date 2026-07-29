import { buildApp } from './app.js';
import { loadServerConfig } from './config.js';
import { runMigrations } from './db/migrate.js';
import { createPool } from './db/pool.js';

async function main(): Promise<void> {
  const config = loadServerConfig(process.env);
  const pool = createPool(config);

  await runMigrations(pool);
  const app = buildApp({ pool });
  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await app.close();
    await pool.end();
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await app.listen({ host: config.host, port: config.port });
}

void main().catch(() => {
  console.error('CH Core failed to start');
  process.exitCode = 1;
});
