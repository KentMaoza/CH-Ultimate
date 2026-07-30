import { access, mkdtemp, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const serverRoot = path.resolve(import.meta.dirname, '..');

async function text(relativePath: string): Promise<string> {
  return readFile(path.join(serverRoot, relativePath), 'utf8');
}

describe('local CH Core deployment artifacts', () => {
  it('keeps the raw API and host MariaDB on shared loopback without a published port', async () => {
    const compose = await text('compose.yaml');

    expect(compose).toContain('network_mode: host');
    expect(compose).not.toMatch(/^\s+ports:/m);
    expect(compose).toContain('CH_CORE_HOST: "127.0.0.1"');
    expect(compose).toContain('CH_CORE_PORT: "18080"');
    expect(compose).toContain('CH_CORE_DB_POOL_MAX: "4"');
    expect(compose).toContain('target: /var/lib/ch-core/private');
    expect(compose).toContain('read_only: true');
    expect(compose).toContain('mem_limit: 256m');
    expect(compose).toContain('cpus: 0.75');
    expect(compose).toContain('cap_drop:');
    expect(compose).toContain('- ALL');
    expect(compose).not.toContain('privileged: true');
  });

  it('runs Node 24 as non-root with a bounded heap and local Node healthcheck', async () => {
    const dockerfile = await text('Dockerfile');

    expect(dockerfile).toContain('FROM node:24-');
    expect(dockerfile).toContain('NODE_OPTIONS=--max-old-space-size=160');
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('127.0.0.1');
    expect(dockerfile).not.toMatch(/\bcurl\b/);
  });

  it('ships placeholder-only configuration and executable bounded operations scripts', async () => {
    const env = await text('.env.example');
    expect(env).toContain('CH_CORE_DATABASE_URL=mariadb://CH_CORE_USER:CH_CORE_PASSWORD@127.0.0.1:3306/CH_CORE_DATABASE');
    expect(env).toContain('CH_CORE_PRIVATE_STORAGE_HOST_PATH=/volume1/CH_CORE_PRIVATE_STORAGE_PATH');
    expect(env).not.toMatch(/kentmaoza|192\.168\.1\.14|64fcb734/i);

    for (const script of [
      'scripts/dump-database.sh',
      'scripts/verify-dump.sh',
      'scripts/restore-scratch.sh',
      'scripts/health-check.sh',
    ]) {
      await access(path.join(serverRoot, script), constants.X_OK);
      const source = await text(script);
      expect(source).toContain('set -eu');
      expect(source).not.toMatch(/--password(?:=|\s)/);
    }
  });

  it('rejects relative dump destinations before invoking database tools', async () => {
    await expect(
      run(path.join(serverRoot, 'scripts/dump-database.sh'), [
        'relative.sql',
      ], {
        env: {
          ...process.env,
          CH_CORE_DATABASE_URL:
            'mariadb://user:password@127.0.0.1:3306/chu',
        },
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('absolute'),
    });
  });

  it('refuses production-like restore names before invoking database tools', async () => {
    await expect(
      run(path.join(serverRoot, 'scripts/restore-scratch.sh'), [
        '/tmp/missing.sql',
        'chu',
      ], {
        env: {
          ...process.env,
          CH_CORE_DATABASE_URL:
            'mariadb://user:password@127.0.0.1:3306/chu',
        },
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('chu_restore_'),
    });
  });

  it('rejects shell metacharacters in an otherwise scratch-prefixed database name', async () => {
    await expect(
      run(path.join(serverRoot, 'scripts/restore-scratch.sh'), [
        '/tmp/missing.sql',
        'chu_restore_safe;DROP',
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('chu_restore_'),
    });
  });

  it('rejects decoded control characters before invoking the dump client', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'ch-core-dump-test-'),
    );
    await expect(
      run(path.join(serverRoot, 'scripts/dump-database.sh'), [
        path.join(directory, 'dump.sql'),
      ], {
        env: {
          ...process.env,
          CH_CORE_DATABASE_URL:
            'mariadb://user:pass%0Aword@127.0.0.1:3306/chu',
        },
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('unsafe'),
    });
  });
});
