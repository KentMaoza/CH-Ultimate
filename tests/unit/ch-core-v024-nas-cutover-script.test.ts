import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const scriptPath = path.join(process.cwd(), 'scripts/ch-core-v024-nas-cutover.sh');
const passwordGeneratorPath = path.join(
  process.cwd(),
  'scripts/ch-core-v024-database-password.sh',
);
const countValidatorPath = path.join(
  process.cwd(),
  'server/scripts/ch-core-v024-count-validator.sh',
);
const execFile = promisify(execFileCallback);

describe('CH Core v0.2.4 NAS cutover helper', () => {
  it('generates distinct database passwords that satisfy the NAS policy', async () => {
    if (process.platform === 'win32') return;
    const first = (await execFile(passwordGeneratorPath)).stdout.trim();
    const second = (await execFile(passwordGeneratorPath)).stdout.trim();

    for (const password of [first, second]) {
      expect(password.length).toBeGreaterThanOrEqual(40);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[^A-Za-z0-9]/);
      expect(password).toMatch(/^[A-Za-z0-9!]+$/);
    }
    expect(first).not.toBe(second);
  });

  it('accepts every non-negative table count and rejects malformed values', async () => {
    if (process.platform === 'win32') return;
    await expect(execFile(countValidatorPath, ['0'])).resolves.toMatchObject({
      stdout: '',
    });
    await expect(execFile(countValidatorPath, ['5'])).resolves.toMatchObject({
      stdout: '',
    });
    await expect(execFile(countValidatorPath, ['10'])).resolves.toMatchObject({
      stdout: '',
    });
    await expect(execFile(countValidatorPath, ['5x'])).rejects.toMatchObject({
      stderr: expect.stringContaining('Invalid non-negative integer'),
    });
  });

  it('fails closed before touching the NAS without explicit approval', async () => {
    if (process.platform === 'win32') return;
    await expect(execFile(scriptPath, ['prepare'])).rejects.toMatchObject({
      stderr: expect.stringContaining('CH_CORE_V024_APPROVED=YES'),
    });
  });

  it('has separate prepare, backup-restore, deploy, and validation phases', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain('prepare)');
    expect(script).toContain('backup-restore)');
    expect(script).toContain('deploy)');
    expect(script).toContain('validate)');
    expect(script).toContain('CH_CORE_RELEASE_COMMIT');
    expect(script).toContain('CH_CORE_RELEASE_ARCHIVE_SHA256');
    expect(script).toContain('CH_CORE_PREVIOUS_PROJECT_ROOT');
    expect(script).toContain('CH_CORE_MARIADB_ADMIN_DEFAULTS');
    expect(script).toContain('CH_CORE_V024_BACKUP_RECEIPT');
    expect(script).toContain('MATCH=YES');
  });

  it('accepts a previous deployment rooted at the exact 40-character release commit', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain(
      'previous_project_commit=${previous_project_root#/volume1/docker/ch-ultimate-}',
    );
    expect(script).toContain('7|40) ;;');
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

  it('accepts deployment only after measured schema, CA health, and authenticated bootstrap checks', async () => {
    const script = await readFile(scriptPath, 'utf8');
    const validate = script.slice(script.indexOf('validate_release()'));

    expect(validate).toContain('CH_CORE_V024_VALIDATION_TOKEN_FILE');
    expect(validate).toContain('resources/ch-core-ca.pem');
    expect(validate).toContain('https://192.168.50.14:8443');
    expect(validate).toContain('SELECT COUNT(*) FROM schema_migrations');
    expect(validate).toContain('SELECT MAX(version) FROM schema_migrations');
    expect(validate).toContain('APPLIED_MIGRATIONS=10');
    expect(validate).toContain('LATEST_SCHEMA_VERSION=10');
    expect(validate).toContain("apiSchemaVersion !== 2");
    expect(validate).toContain('Array.isArray(body.stockChecks)');
    expect(validate).toContain('body.stockChecks.every(validStockCheck)');
    expect(validate).toContain('const stockCheckSchema = z.object({');
    expect(validate).toContain('forcedOffline: z.boolean()');
    expect(validate).toContain('deviceDisplayName: z.string().min(1).max(160)');
    expect(validate).toContain('note: z.string().trim().max(512).optional()');
    expect(validate).toContain('}).strict()');
    expect(validate).toContain('"${public_base_url}/v1/bootstrap"');
    expect(validate).not.toContain('http://127.0.0.1:18080/v1/bootstrap');
    expect(validate).toContain('PUBLIC_HEALTH_LIVE=YES');
    expect(validate).toContain('PUBLIC_HEALTH_READY=YES');
    expect(validate).toContain('AUTHENTICATED_BOOTSTRAP_V2=YES');
    expect(validate).not.toContain('curl -k');
    expect(script).not.toContain('EXPECTED_SCHEMA_VERSION=10');
  });

  it('records historical business counts without authorizing fixture deletion', async () => {
    const script = await readFile(scriptPath, 'utf8');
    const lower = script.toLowerCase();

    expect(script).toContain('BUSINESS_COUNT=notas|');
    expect(script).toContain('BUSINESS_COUNT=stock_movements|');
    expect(script).toContain('BUSINESS_COUNT=stock_checks|');
    expect(script).toContain('BUSINESS_COUNT=non_import_price_history|');
    expect(script).not.toContain('FIXTURE_CLEAR_SAFE=');
    expect(lower).not.toMatch(/drop\s+database\s+chu\b/);
    expect(lower).not.toMatch(/truncate\s+table|delete\s+from/);
  });

  it('can create a new commit-bound backup from either schema 9 or schema 10', async () => {
    const script = await readFile(scriptPath, 'utf8');
    const counts = script.slice(
      script.indexOf('capture_predeploy_counts()'),
      script.indexOf('backup_and_restore()'),
    );

    expect(counts).toContain('9|10)');
    expect(counts).toContain('PREDEPLOY_MIGRATIONS=%s');
    expect(counts).toContain('business_stock_checks=0');
    expect(counts).toContain('SELECT COUNT(*) FROM stock_checks');
    expect(counts).not.toContain('[ "$migrations" = 9 ]');
  });
});
