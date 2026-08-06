import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const scriptPath = path.join(
  process.cwd(),
  'scripts/ch-core-v023-prepare.sh',
);
const execFile = promisify(execFileCallback);

const migrationHashes = [
  'e22cfbbf1af7b72e0091c9bf8a399ac2570fc6f971723330d085d0954cf68b69',
  '39fd3afbe56aef8fa4b5c317753622998f73877925f1eed24996686721f17923',
  'cb1ab6f8382317cf9e3abfde5f9f4edf6883eea75f06cc0c6b1d4ac54dbde581',
  'e82b21d3e86680432f270b51a1d61c79cd0c69105f9e9ab8212768dcc1387139',
  'b36063e077279b11997bed0cb4577053b7ff6f3ff7ef19e2c13d5678163209b0',
  'dbe0d11d5df5c3241c985afd2db37ce37cea24231397e62e5e8711ea84403cad',
  'b03215e308d94c374cc8e2d63da47599f85cf3338f788baf3add26a47ec1ae44',
  'a75edec750744aa68b28be3e53b50ea001b7be0c8a50c8ea413a309adeef2cfc',
  'e4a35e360a8e726dc0cbfa202b9f445b684a39172ce42c8944c3a975dce892c1',
  '6aaa1aa921b939aad93bc1730dd46a3c1f3a0f4fa55484c5f55565b3317af105',
] as const;

describe('CH Core v0.2.3 NAS source preparation', () => {
  it('fails closed before touching the NAS without explicit owner approval', async () => {
    await expect(
      execFile(scriptPath, [], { env: { PATH: process.env.PATH } }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('CH_CORE_PREPARE_APPROVED=YES'),
    });
  });

  it('locks the exact release archive, target, and complete migration chain', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain(
      '8a9ffcec972a358ce94270a70f0a1de026c85b84',
    );
    expect(script).toContain(
      '49e5be9c0b3672012ece35f67850bc3ce6e840669fec6ed9574980de1e652712',
    );
    expect(script).toContain(
      'f34cf3040757612346e1780a144a0f01ba50a89cdf34b153ace48437ae424b55',
    );
    expect(script).toContain('compare-scratch.sh');
    expect(script).toContain(
      '/volume1/homes/kentmaoza/CH_Ultimate_Pilot/8a9ffce',
    );
    expect(script).toContain(
      '/volume1/docker/ch-ultimate-8a9ffcec972a358ce94270a70f0a1de026c85b84',
    );
    for (const migrationHash of migrationHashes) {
      expect(script).toContain(migrationHash);
    }
    expect(script).toContain('010_stock_checks.sql');
    expect(script).toContain("printf 'MIGRATION=%s|%s|%s\\n'");
  });

  it('prepares source and a sanitized receipt without copying secrets or changing runtime state', async () => {
    const script = (await readFile(scriptPath, 'utf8')).toLowerCase();

    expect(script).toContain('environment=not_created');
    expect(script).toContain('deployment=not_started');
    expect(script).toContain('database=not_accessed');
    expect(script).toContain('ops_supplement=compare-scratch.sh');
    expect(script).toContain('chmod 0600');
    expect(script).not.toContain('server/.env"');
    expect(script).not.toContain('cp -p');
    for (const forbidden of [
      'docker compose',
      'docker stop',
      'docker start',
      'mariadb',
      'drop database',
      'create database',
      'truncate table',
      'delete from',
      'rm -rf',
      'set -x',
      'printenv',
    ]) {
      expect(script).not.toContain(forbidden);
    }
  });

  it('resumes only an ordinary existing target and records that recovery in the receipt', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain("prepare_mode='CREATED_NEW'");
    expect(script).toContain('if [ -e "$target_root" ]; then');
    expect(script).toContain(
      '[ -d "$target_root" ] && [ ! -L "$target_root" ]',
    );
    expect(script).toContain("prepare_mode='RESUMED_EXISTING'");
    expect(script).toContain('if [ -e "$ops_supplement_target" ]; then');
    expect(script).toContain(
      '[ -f "$ops_supplement_target" ] && [ ! -L "$ops_supplement_target" ]',
    );
    expect(script).toContain("printf 'PREPARE_MODE=%s\\n' \"$prepare_mode\"");
    expect(script).not.toContain(
      'The exact target deployment directory already exists or is unsafe.',
    );
  });

  it('matches every embedded migration checksum to the reviewed SQL bytes', async () => {
    for (const [relativeScript, expectedCount] of [
      ['scripts/ch-core-v023-preflight.sh', 9],
      ['scripts/ch-core-v023-prepare.sh', 10],
    ] as const) {
      const script = await readFile(relativeScript, 'utf8');
      const manifest = script.match(/expected_migrations='\n?([\s\S]*?)\n?'/)?.[1];
      expect(manifest).toBeDefined();
      const entries = manifest!.split('\n');
      expect(entries).toHaveLength(expectedCount);
      for (const entry of entries) {
        const [, filename, expectedHash] = entry.split('|');
        const bytes = await readFile(`server/migrations/${filename}`);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(
          expectedHash,
        );
      }
    }
  });
});
