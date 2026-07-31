import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createPoolMock } = vi.hoisted(() => ({
  createPoolMock: vi.fn(() => ({ end: vi.fn() })),
}));

vi.mock('mariadb', () => ({
  default: {
    createPool: createPoolMock,
  },
}));

import type { ServerConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 18080,
    databaseUrl: 'mariadb://chu_app:secret@localhost/chu',
    dbPoolMax: 4,
    privateStorageRoot: '/var/lib/ch-core/private',
    initialCatalogueSha256: 'a'.repeat(64),
    ...overrides,
  };
}

describe('createPool', () => {
  beforeEach(() => {
    createPoolMock.mockClear();
  });

  it('uses the configured Unix socket instead of a TCP host and port', () => {
    createPool(
      config({
        databaseSocket: '/run/mysqld/mysqld10.sock',
      }),
    );

    expect(createPoolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        socketPath: '/run/mysqld/mysqld10.sock',
        user: 'chu_app',
        password: 'secret',
        database: 'chu',
      }),
    );
    const options = createPoolMock.mock.calls[0]?.[0];
    expect(options).not.toHaveProperty('host');
    expect(options).not.toHaveProperty('port');
  });

  it('keeps TCP host and port behavior when no socket is configured', () => {
    createPool(
      config({
        databaseUrl: 'mariadb://chu_app:secret@192.0.2.10:3307/chu',
      }),
    );

    expect(createPoolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '192.0.2.10',
        port: 3307,
      }),
    );
  });
});
