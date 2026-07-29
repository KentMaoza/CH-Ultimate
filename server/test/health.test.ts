import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { SchemaQueryPool } from '../src/db/migrate.js';

function poolReturning(rows: unknown[]): SchemaQueryPool {
  return {
    async query<T>() {
      return rows as T;
    },
  };
}

describe('health routes', () => {
  it('reports process liveness without touching the database', async () => {
    let databaseWasQueried = false;
    const app = buildApp({
      pool: {
        async query() {
          databaseWasQueried = true;
          throw new Error('should not be queried');
        },
      },
    });

    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(databaseWasQueried).toBe(false);
    await app.close();
  });

  it('reports readiness when the database schema matches the binary', async () => {
    const app = buildApp({
      pool: poolReturning([{ version: 3 }]),
    });

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready' });
    await app.close();
  });

  it('returns a generic response when the database is unavailable', async () => {
    const secret = 'mariadb://user:secret@db.internal/chu_test';
    const app = buildApp({
      pool: {
        async query() {
          throw new Error(`connect ECONNREFUSED ${secret}`);
        },
      },
    });

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready' });
    expect(response.body).not.toContain('secret');
    expect(response.body).not.toContain('db.internal');
    expect(response.body).not.toContain('chu_test');
    await app.close();
  });

  it('is not ready when the database schema is newer than the binary', async () => {
    const app = buildApp({
      pool: poolReturning([{ version: 4 }]),
    });

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready' });
    await app.close();
  });
});
