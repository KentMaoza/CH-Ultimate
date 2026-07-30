import { describe, expect, it } from 'vitest';

import { loadServerConfig } from '../src/config.js';

describe('loadServerConfig', () => {
  it('uses the fixed API and pool defaults for a valid MariaDB URL', () => {
    const config = loadServerConfig({
      CH_CORE_DATABASE_URL:
        'mariadb://chu_app:secret@192.0.2.10:3306/chu_test',
    });

    expect(config).toEqual({
      host: '0.0.0.0',
      port: 3000,
      databaseUrl:
        'mariadb://chu_app:secret@192.0.2.10:3306/chu_test',
      dbPoolMax: 4,
      privateStorageRoot: '/var/lib/ch-core/private',
    });
  });

  it.each([
    {},
    { CH_CORE_DATABASE_URL: 'https://example.test/chu_test' },
    { CH_CORE_DATABASE_URL: 'mariadb://db.internal/chu_test' },
    {
      CH_CORE_DATABASE_URL:
        'mariadb://chu_app:secret@192.0.2.10:3306/chu_test',
      CH_CORE_DB_POOL_MAX: '8',
    },
  ])('rejects an unsafe or incomplete environment', (env) => {
    expect(() => loadServerConfig(env)).toThrow(
      'Invalid CH Core server configuration',
    );
  });

  it('does not include database credentials in validation errors', () => {
    const secret = 'do-not-leak-this-password';

    expect(() =>
      loadServerConfig({
        CH_CORE_DATABASE_URL: `https://chu_app:${secret}@db.internal/chu`,
      }),
    ).toThrowError(
      expect.not.objectContaining({
        message: expect.stringContaining(secret),
      }),
    );
  });

  it('accepts an optional minimum-32-byte owner bootstrap secret', () => {
    const config = loadServerConfig({
      CH_CORE_DATABASE_URL:
        'mariadb://chu_app:secret@192.0.2.10:3306/chu_test',
      CH_CORE_OWNER_BOOTSTRAP_SECRET: 'b'.repeat(32),
    });

    expect(config.ownerBootstrapSecret).toBe('b'.repeat(32));
  });

  it('treats an empty optional bootstrap secret as disabled', () => {
    const config = loadServerConfig({
      CH_CORE_DATABASE_URL:
        'mariadb://chu_app:secret@192.0.2.10:3306/chu_test',
      CH_CORE_OWNER_BOOTSTRAP_SECRET: '',
    });

    expect(config).not.toHaveProperty('ownerBootstrapSecret');
  });

  it('rejects a configured owner bootstrap secret shorter than 32 bytes', () => {
    expect(() =>
      loadServerConfig({
        CH_CORE_DATABASE_URL:
          'mariadb://chu_app:secret@192.0.2.10:3306/chu_test',
        CH_CORE_OWNER_BOOTSTRAP_SECRET: 'short-secret',
      }),
    ).toThrow('Invalid CH Core server configuration');
  });

  it('accepts only an absolute private storage root and optional catalogue hash', () => {
    const hash = 'a'.repeat(64);
    const config = loadServerConfig({
      CH_CORE_DATABASE_URL:
        'mariadb://chu_app:secret@192.0.2.10:3306/chu_test',
      CH_CORE_PRIVATE_STORAGE_ROOT: '/volume1/ch-core/private',
      CH_CORE_INITIAL_CATALOGUE_SHA256: hash,
    });

    expect(config.privateStorageRoot).toBe('/volume1/ch-core/private');
    expect(config.initialCatalogueSha256).toBe(hash);
    for (const root of ['relative/path', '/', '/tmp/private\nunsafe']) {
      expect(() =>
        loadServerConfig({
          CH_CORE_DATABASE_URL:
            'mariadb://chu_app:secret@192.0.2.10:3306/chu_test',
          CH_CORE_PRIVATE_STORAGE_ROOT: root,
        }),
      ).toThrow('Invalid CH Core server configuration');
    }
    expect(() =>
      loadServerConfig({
        CH_CORE_DATABASE_URL:
          'mariadb://chu_app:secret@192.0.2.10:3306/chu_test',
        CH_CORE_INITIAL_CATALOGUE_SHA256: 'not-a-hash',
      }),
    ).toThrow('Invalid CH Core server configuration');
  });
});
