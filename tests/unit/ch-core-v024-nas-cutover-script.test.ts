import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const scriptPath = path.join(process.cwd(), 'scripts/ch-core-v024-nas-cutover.sh');
const execFile = promisify(execFileCallback);

describe('CH Core v0.2.4 NAS cutover helper', () => {
  it('fails closed before touching the NAS without explicit approval', async () => {
    if (process.platform === 'win32') return;
    await expect(execFile(scriptPath, ['prepare'])).rejects.toMatchObject({
      stderr: expect.stringContaining('CH_CORE_V024_APPROVED=YES'),
    });
  });

  it('has separate prepare, backup-restore, and deploy phases', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain('prepare)');
    expect(script).toContain('backup-restore)');
    expect(script).toContain('deploy)');
    expect(script).toContain('CH_CORE_RELEASE_COMMIT');
    expect(script).toContain('CH_CORE_RELEASE_ARCHIVE_SHA256');
    expect(script).toContain('CH_CORE_PREVIOUS_PROJECT_ROOT');
    expect(script).toContain('CH_CORE_MARIADB_ADMIN_DEFAULTS');
    expect(script).toContain('CH_CORE_V024_BACKUP_RECEIPT');
    expect(script).toContain('MATCH=YES');
  });

  it('requires both uninstalled clients to be explicitly quiesced', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain('CH_CORE_V024_QUIESCED');
    expect(script).toContain('CH_CORE_V024_WINDOWS_STATE');
    expect(script).toContain('CH_CORE_V024_WINDOWS_OUTBOX');
    expect(script).toContain('CH_CORE_V024_ANDROID_STATE');
    expect(script).toContain('CH_CORE_V024_ANDROID_OUTBOX');
    expect(script).toContain('UNAVAILABLE_AFTER_OWNER_UNINSTALL');
    expect(script).toContain('CLIENT_STATE_WINDOWS=');
    expect(script).toContain('CLIENT_STATE_ANDROID=');
    expect(script).toContain('QUIESCED=YES');
  });

  it('keeps database operations socket-only and credentials out of output', async () => {
    const script = await readFile(scriptPath, 'utf8');
    const lower = script.toLowerCase();

    expect(script).toContain('/run/mysqld/mysqld10.sock');
    expect(script).toContain('mariadb://chu_backup_v024:');
    expect(script).toContain('mariadb://chu_restore_v024:');
    expect(script).toContain('chu_restore_v024');
    expect(script).not.toContain('127.0.0.1:3306');
    expect(lower).not.toContain('set -x');
    expect(lower).not.toContain('printenv');
    expect(lower).not.toMatch(/--password(?:=|\s)/);
    expect(lower).not.toMatch(/drop\s+database\s+chu\b/);
    expect(lower).not.toMatch(/truncate\s+table|delete\s+from/);
  });

  it('requires a verified timestamped rollback before deployment', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain('chu-v024-${stamp}.bundle');
    expect(script).toContain('/opt/ch-core-ops/dump-database.sh');
    expect(script).toContain('/opt/ch-core-ops/verify-dump.sh');
    expect(script).toContain('/opt/ch-core-ops/restore-scratch.sh');
    expect(script).toContain('/opt/ch-core-ops/compare-scratch.sh');
    expect(script).toContain('BACKUP_VERIFIED=YES');
    expect(script).toContain('SCRATCH_RESTORE=PASS');
    expect(script).toContain('CANONICAL_MATCH=YES');
    expect(script).toMatch(
      /deploy_release\(\)[\s\S]+require_verified_backup_receipt/,
    );
    expect(script).toMatch(
      /deploy_release\(\)[\s\S]+build ch-core[\s\S]+stop ch-core[\s\S]+up -d --no-build ch-core/,
    );
  });

  it('records the fixture-clear predicate without deleting production data', async () => {
    const script = await readFile(scriptPath, 'utf8');
    const lower = script.toLowerCase();

    expect(script).toContain('BUSINESS_COUNT=notas|');
    expect(script).toContain('BUSINESS_COUNT=stock_movements|');
    expect(script).toContain('BUSINESS_COUNT=stock_checks|');
    expect(script).toContain('BUSINESS_COUNT=non_import_price_history|');
    expect(script).toContain('FIXTURE_CLEAR_SAFE=');
    expect(lower).not.toMatch(/drop\s+database\s+chu\b/);
    expect(lower).not.toMatch(/truncate\s+table|delete\s+from/);
  });
});
