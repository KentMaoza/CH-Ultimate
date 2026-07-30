import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  readFile,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const serverRoot = path.resolve(import.meta.dirname, '..');
const scriptsRoot = path.join(serverRoot, 'scripts');

async function text(relativePath: string): Promise<string> {
  return readFile(path.join(serverRoot, relativePath), 'utf8');
}

function backupEnvironment(
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CH_CORE_BACKUP_DATABASE_URL:
      'mariadb://backup_user:encoded%23password@127.0.0.1:3306/chu',
    ...overrides,
  };
}

async function createExecutable(
  directory: string,
  name: string,
  source: string,
): Promise<string> {
  const target = path.join(directory, name);
  await writeFile(target, source, { mode: 0o700 });
  await chmod(target, 0o700);
  return target;
}

async function createCompleteBundle(
  directory: string,
  name = 'chu-test.bundle',
  contents = 'SELECT 1;\n',
): Promise<string> {
  const bundle = path.join(directory, name);
  await mkdir(bundle, { mode: 0o700 });
  await writeFile(path.join(bundle, 'dump.sql'), contents, { mode: 0o600 });
  const hash = createHash('sha256').update(contents).digest('hex');
  await writeFile(
    path.join(bundle, 'dump.sql.sha256'),
    `${hash}  dump.sql\n`,
    { mode: 0o600 },
  );
  await writeFile(
    path.join(bundle, 'COMPLETE'),
    'CH_CORE_BACKUP_COMPLETE_V1\n',
    { mode: 0o600 },
  );
  return bundle;
}

async function createScriptHarness(
  directory: string,
  backupRoot: string,
): Promise<string> {
  const harnessRoot = path.join(directory, 'scripts');
  await mkdir(harnessRoot);
  for (const script of [
    'database-common.sh',
    'dump-database.sh',
    'verify-dump.sh',
    'restore-scratch.sh',
  ]) {
    const source = await text(`scripts/${script}`);
    const harnessSource = source.replaceAll(
      'require_backup_bundle_path "$bundle" /backup',
      `require_backup_bundle_path "$bundle" ${backupRoot}`,
    );
    await createExecutable(harnessRoot, script, harnessSource);
  }
  return harnessRoot;
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

  it('requires one explicit non-root numeric DSM identity for runtime and ops', async () => {
    const compose = await text('compose.yaml');
    const env = await text('.env.example');
    const entrypoint = await text('scripts/container-entrypoint.sh');

    expect(compose.match(/user: "\$\{CH_CORE_RUNTIME_UID/g)).toHaveLength(2);
    expect(compose).toContain('${CH_CORE_RUNTIME_GID');
    expect(env).toContain('CH_CORE_RUNTIME_UID=REPLACE_WITH_NONZERO_NUMERIC_UID');
    expect(env).toContain('CH_CORE_RUNTIME_GID=REPLACE_WITH_NONZERO_NUMERIC_GID');
    expect(entrypoint).toContain('CH_CORE_RUNTIME_UID');
    expect(entrypoint).toContain('CH_CORE_RUNTIME_GID');
    expect(entrypoint).toMatch(/id -u/);
    expect(entrypoint).toMatch(/id -g/);
    expect(entrypoint).toMatch(/nonzero|non-zero/i);
  });

  it('rejects zero identity before executing the requested container command', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'ch-core-identity-'),
    );
    const sentinel = path.join(directory, 'command-ran');

    await expect(
      run(path.join(scriptsRoot, 'container-entrypoint.sh'), [
        'sh',
        '-c',
        ': > "$CH_CORE_TEST_SENTINEL"',
      ], {
        env: {
          ...process.env,
          CH_CORE_RUNTIME_UID: '0',
          CH_CORE_RUNTIME_GID: '1',
          CH_CORE_TEST_SENTINEL: sentinel,
        },
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/nonzero|non-zero/i),
    });
    await expect(access(sentinel)).rejects.toBeDefined();
  });

  it('builds a separate opt-in ops image with verified MariaDB clients', async () => {
    const dockerfile = await text('Dockerfile');
    const compose = await text('compose.yaml');

    expect(dockerfile).toContain('AS ops');
    expect(dockerfile).toContain('mariadb-client');
    expect(dockerfile).toMatch(/command -v mariadb/);
    expect(dockerfile).toMatch(/command -v mariadb-dump/);
    expect(compose).toContain('ch-core-ops:');
    expect(compose).toContain('target: ops');
    expect(compose).toContain('profiles:');
    expect(compose).toContain('- ops');
    expect(compose).toContain('target: /backup');
    expect(compose).not.toMatch(/ch-core-ops:[\s\S]*?ports:/);
    expect(compose.match(/type: bind/g)).toHaveLength(2);
  });

  it('keeps both services bounded and runs Node 24 as non-root', async () => {
    const dockerfile = await text('Dockerfile');
    const compose = await text('compose.yaml');

    expect(dockerfile).toContain('FROM node:24-');
    expect(dockerfile).toContain('NODE_OPTIONS=--max-old-space-size=160');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).not.toMatch(/\bcurl\b/);
    expect(compose.match(/read_only: true/g)).toHaveLength(2);
    expect(compose.match(/no-new-privileges:true/g)).toHaveLength(2);
    expect(compose.match(/mem_limit:/g)).toHaveLength(2);
    expect(compose.match(/cpus:/g)).toHaveLength(2);
  });

  it('ships placeholder-only separate backup and scratch credentials', async () => {
    const env = await text('.env.example');

    expect(env).toContain('CH_CORE_BACKUP_DATABASE_URL=');
    expect(env).toContain('CH_CORE_RESTORE_DATABASE_URL=');
    expect(env).toContain('CH_CORE_BACKUP_HOST_PATH=');
    expect(env).not.toMatch(/kentmaoza|192\.168\.1\.14|64fcb734/i);
  });

  it('allowlists runtime and ops credentials without sharing one env file', async () => {
    const compose = await text('compose.yaml');
    const runtimeBlock = compose.slice(
      compose.indexOf('  ch-core:'),
      compose.indexOf('  ch-core-ops:'),
    );
    const opsBlock = compose.slice(compose.indexOf('  ch-core-ops:'));

    expect(compose).not.toContain('env_file:');
    expect(runtimeBlock).toContain('CH_CORE_DATABASE_URL:');
    expect(runtimeBlock).toContain('CH_CORE_OWNER_BOOTSTRAP_SECRET:');
    expect(runtimeBlock).not.toContain('CH_CORE_BACKUP_DATABASE_URL');
    expect(runtimeBlock).not.toContain('CH_CORE_RESTORE_DATABASE_URL');
    expect(opsBlock).toContain('CH_CORE_BACKUP_DATABASE_URL:');
    expect(opsBlock).toContain('CH_CORE_RESTORE_DATABASE_URL:');
    expect(opsBlock).not.toMatch(/^\s+CH_CORE_DATABASE_URL:/m);
    expect(opsBlock).not.toContain('CH_CORE_OWNER_BOOTSTRAP_SECRET');
  });

  it('ships executable scripts without secrets in command arguments', async () => {
    for (const script of [
      'container-entrypoint.sh',
      'database-common.sh',
      'dump-database.sh',
      'verify-dump.sh',
      'restore-scratch.sh',
      'health-check.sh',
    ]) {
      await access(path.join(scriptsRoot, script), constants.X_OK);
      const source = await text(`scripts/${script}`);
      expect(source).toContain('set -eu');
      expect(source).not.toMatch(/--password(?:=|\s)/);
    }
  });

  it('accepts only one safe direct bundle child under a canonical backup root', async () => {
    const directory = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'ch-core-path-policy-')),
    );
    const root = path.join(directory, 'backup');
    await mkdir(root);
    const linkedRoot = path.join(directory, 'linked-backup');
    await symlink(root, linkedRoot);
    const linkedTarget = path.join(root, 'linked.bundle');
    await symlink(path.join(directory, 'outside.bundle'), linkedTarget);
    const validate = (candidate: string, backupRoot = root) =>
      run('sh', [
        '-c',
        '. "$1"; require_backup_bundle_path "$2" "$3"',
        'validate-backup-path',
        path.join(scriptsRoot, 'database-common.sh'),
        candidate,
        backupRoot,
      ]);

    await expect(validate(path.join(root, 'safe-name.bundle'))).resolves.toBeDefined();
    for (const candidate of [
      root,
      path.join(directory, 'outside.bundle'),
      path.join(root, '..', 'outside.bundle'),
      path.join(root, 'nested', 'unsafe.bundle'),
      path.join(root, 'unsafe name.bundle'),
      linkedTarget,
    ]) {
      await expect(validate(candidate)).rejects.toBeDefined();
    }
    await expect(
      validate(path.join(linkedRoot, 'safe.bundle'), linkedRoot),
    ).rejects.toBeDefined();

    const dump = await text('scripts/dump-database.sh');
    const verify = await text('scripts/verify-dump.sh');
    const restore = await text('scripts/restore-scratch.sh');
    for (const source of [dump, verify, restore]) {
      expect(source).toContain('require_backup_bundle_path "$bundle" /backup');
    }
  });

  it('atomically reserves a new dump bundle and publishes completion last', async () => {
    const directory = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'ch-core-dump-')),
    );
    const harnessRoot = await createScriptHarness(directory, directory);
    const fakeDump = await createExecutable(
      directory,
      'mariadb-dump',
      '#!/bin/sh\nprintf "CREATE TABLE safe_table (id INT);\\n"\n',
    );
    const bundle = path.join(directory, 'new.bundle');

    await run(path.join(harnessRoot, 'dump-database.sh'), [bundle], {
      env: backupEnvironment({ CH_CORE_MARIADB_DUMP_BIN: fakeDump }),
    });

    expect(await readFile(path.join(bundle, 'COMPLETE'), 'utf8')).toBe(
      'CH_CORE_BACKUP_COMPLETE_V1\n',
    );
    expect((await lstat(path.join(bundle, 'dump.sql'))).isFile()).toBe(true);
    expect((await lstat(path.join(bundle, 'dump.sql.sha256'))).isFile()).toBe(
      true,
    );
    await run(path.join(harnessRoot, 'verify-dump.sh'), [bundle]);
  });

  it('never overwrites a pre-existing bundle directory', async () => {
    const directory = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'ch-core-race-')),
    );
    const harnessRoot = await createScriptHarness(directory, directory);
    const bundle = path.join(directory, 'reserved.bundle');
    await mkdir(bundle);
    const sentinel = path.join(bundle, 'owner-data');
    await writeFile(sentinel, 'untouched');

    await expect(
      run(path.join(harnessRoot, 'dump-database.sh'), [bundle], {
        env: backupEnvironment(),
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/already exists|reserve/i),
    });
    expect(await readFile(sentinel, 'utf8')).toBe('untouched');
  });

  it('rejects incomplete bundles, unsafe symlinks, and checksum mismatch', async () => {
    const directory = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'ch-core-verify-')),
    );
    const harnessRoot = await createScriptHarness(directory, directory);
    const incomplete = path.join(directory, 'incomplete.bundle');
    await mkdir(incomplete);
    await writeFile(path.join(incomplete, 'dump.sql'), 'SELECT 1;\n');
    await expect(
      run(path.join(harnessRoot, 'verify-dump.sh'), [incomplete]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/incomplete|marker/i),
    });

    const linked = await createCompleteBundle(directory, 'linked.bundle');
    await writeFile(path.join(directory, 'outside.sql'), 'SELECT 2;\n');
    await unlink(path.join(linked, 'dump.sql'));
    await symlink(
      path.join(directory, 'outside.sql'),
      path.join(linked, 'dump.sql'),
    );
    await expect(
      run(path.join(harnessRoot, 'verify-dump.sh'), [linked]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/symlink|regular/i),
    });

    const mismatched = await createCompleteBundle(
      directory,
      'mismatched.bundle',
      'SELECT 3;\n',
    );
    await writeFile(path.join(mismatched, 'dump.sql'), 'tampered\n');
    await expect(
      run(path.join(harnessRoot, 'verify-dump.sh'), [mismatched]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('checksum'),
    });

    const extra = await createCompleteBundle(directory, 'extra.bundle');
    await writeFile(path.join(extra, 'unexpected.txt'), 'not part of bundle');
    await expect(
      run(path.join(harnessRoot, 'verify-dump.sh'), [extra]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/unexpected|exactly/i),
    });
  });

  it('makes production restore structurally impossible and never creates or drops schemas', async () => {
    const restore = await text('scripts/restore-scratch.sh');
    const common = await text('scripts/database-common.sh');
    const directory = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'ch-core-restore-')),
    );
    const harnessRoot = await createScriptHarness(directory, directory);
    const bundle = await createCompleteBundle(directory);

    expect(restore).toContain('CH_CORE_RESTORE_DATABASE_URL');
    expect(common).toMatch(/chu_restore_\[a-z0-9_\]/);
    expect(restore).not.toMatch(/CREATE\s+DATABASE|DROP\s+DATABASE/i);
    expect(common).not.toMatch(/CREATE\s+DATABASE|DROP\s+DATABASE/i);
    await expect(
      run(path.join(harnessRoot, 'restore-scratch.sh'), [bundle], {
        env: {
          ...process.env,
          CH_CORE_RESTORE_DATABASE_URL:
            'mariadb://restore_user:password@127.0.0.1:3306/chu',
        },
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/chu_restore_/),
    });
  });

  it('rejects broad restore grants and gives explicit partial-import recovery', async () => {
    const directory = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'ch-core-restore-policy-')),
    );
    const harnessRoot = await createScriptHarness(directory, directory);
    const bundle = await createCompleteBundle(directory);
    const importSentinel = path.join(directory, 'import-started');
    const fakeMaria = await createExecutable(
      directory,
      'mariadb',
      `#!/bin/sh
for argument in "$@"; do
  case "$argument" in
    *INFORMATION_SCHEMA.SCHEMATA*) printf '%s\\n' "\${FAKE_SCHEMA_COUNT:-1}"; exit 0 ;;
    *INFORMATION_SCHEMA.TABLES*) printf '%s\\n' "\${FAKE_OBJECT_COUNT:-0}"; exit 0 ;;
    *SHOW\\ GRANTS*) printf '%s\\n' "$FAKE_GRANTS"; exit 0 ;;
  esac
done
: > "$FAKE_IMPORT_SENTINEL"
cat >/dev/null
[ "\${FAKE_IMPORT_FAIL:-0}" = 0 ]
`,
    );
    const baseEnvironment = {
      ...process.env,
      CH_CORE_RESTORE_DATABASE_URL:
        'mariadb://restore_user:password@127.0.0.1:3306/chu_restore_test',
      CH_CORE_MARIADB_BIN: fakeMaria,
      FAKE_IMPORT_SENTINEL: importSentinel,
    };

    await expect(
      run(path.join(harnessRoot, 'restore-scratch.sh'), [bundle], {
        env: {
          ...baseEnvironment,
          FAKE_GRANTS:
            "GRANT ALL PRIVILEGES ON *.* TO `restore_user`@`localhost`",
        },
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/global|other-schema/i),
    });
    await expect(access(importSentinel)).rejects.toBeDefined();

    await expect(
      run(path.join(harnessRoot, 'restore-scratch.sh'), [bundle], {
        env: {
          ...baseEnvironment,
          FAKE_GRANTS:
            "GRANT USAGE ON *.* TO `restore_user`@`localhost`\nGRANT ALL PRIVILEGES ON `chu_restore_test`.* TO `restore_user`@`localhost`",
          FAKE_IMPORT_FAIL: '1',
        },
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/partial.+NEW scratch/is),
    });
    await access(importSentinel);
  });

  it('contains no replacement move or broad recursive cleanup in bundle scripts', async () => {
    const dump = await text('scripts/dump-database.sh');
    const verify = await text('scripts/verify-dump.sh');

    expect(dump).toMatch(/mkdir .*\$bundle/);
    expect(dump).not.toMatch(/\bmv\b/);
    expect(dump).not.toMatch(/rm\s+-rf/);
    expect(verify).toContain('COMPLETE');
  });
});
