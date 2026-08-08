import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const scriptPath = path.join(
  process.cwd(),
  'scripts/ch-core-v023-preflight.sh',
);
const execFile = promisify(execFileCallback);

const requiredTables = [
  'schema_migrations',
  'devices',
  'pairings',
  'owner_recovery',
  'skus',
  'sku_identifiers',
  'price_history',
  'templates',
  'imports',
  'image_assets',
  'image_jobs',
  'notas',
  'nota_pages',
  'nota_lines',
  'nota_postings',
  'nota_daily_sequences',
  'nota_conflicts',
  'revenue_postings',
  'stock_movements',
  'stock_balances',
  'stock_checks',
  'idempotency_receipts',
  'audit_events',
  'client_cursor_acknowledgements',
  'change_log',
  'business_write_lock',
] as const;

describe('CH Core v0.2.3 one-time preflight task', () => {
  it('fails closed until each client is either measured empty or explicitly uninstalled', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain("CH_CORE_PREFLIGHT_APPROVED:-");
    expect(script).toContain("CH_CORE_PREFLIGHT_QUIESCED:-");
    expect(script).toContain("CH_CORE_PREFLIGHT_WINDOWS_OUTBOX:-");
    expect(script).toContain("CH_CORE_PREFLIGHT_ANDROID_OUTBOX:-");
    expect(script).toContain("CH_CORE_PREFLIGHT_WINDOWS_STATE:-");
    expect(script).toContain("CH_CORE_PREFLIGHT_ANDROID_STATE:-");
    expect(script).toContain('UNAVAILABLE_AFTER_OWNER_UNINSTALL');
    expect(script).toContain('INSTALLED');
    expect(script).toContain('UNINSTALLED');

    if (process.platform === 'win32') return;

    await expect(
      execFile(scriptPath, [], { env: { PATH: process.env.PATH } }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('CH_CORE_PREFLIGHT_APPROVED=YES'),
    });

    const baseEnv = {
      PATH: process.env.PATH,
      CH_CORE_PREFLIGHT_APPROVED: 'YES',
      CH_CORE_PREFLIGHT_QUIESCED: 'YES',
      CH_CORE_PREFLIGHT_ANDROID_STATE: 'UNINSTALLED',
      CH_CORE_PREFLIGHT_ANDROID_OUTBOX: 'UNAVAILABLE_AFTER_OWNER_UNINSTALL',
    };
    await expect(
      execFile(scriptPath, [], {
        env: {
          ...baseEnv,
          CH_CORE_PREFLIGHT_WINDOWS_STATE: 'UNINSTALLED',
          CH_CORE_PREFLIGHT_WINDOWS_OUTBOX: '0',
        },
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'UNINSTALLED with outbox UNAVAILABLE_AFTER_OWNER_UNINSTALL',
      ),
    });

    await expect(
      execFile(scriptPath, [], {
        env: {
          ...baseEnv,
          CH_CORE_PREFLIGHT_WINDOWS_STATE: 'UNINSTALLED',
          CH_CORE_PREFLIGHT_WINDOWS_OUTBOX:
            'UNAVAILABLE_AFTER_OWNER_UNINSTALL',
        },
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'Exact live project directory is unavailable or unsafe',
      ),
    });
  });

  it('uses only the exact live project and the reviewed read-only table allowlist', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain(
      "project_dir='/volume1/docker/ch-ultimate-4482af7/server'",
    );
    for (const table of requiredTables) {
      expect(script).toMatch(new RegExp(`(^|\\s)${table}(\\s|$)`, 'm'));
    }

    const tableBlock = script.match(
      /required_tables='\r?\n([\s\S]*?)\r?\n'/,
    )?.[1];
    expect(tableBlock?.trim().split(/\s+/)).toEqual(requiredTables);
  });

  it('creates a unique NAS bundle, verifies it, and publishes only a sanitized receipt', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain('chu-v023-${stamp}.bundle');
    expect(script).toContain('/opt/ch-core-ops/dump-database.sh');
    expect(script).toContain('/opt/ch-core-ops/verify-dump.sh');
    expect(script).toContain('dump.sql.sha256');
    expect(script).toContain('TABLE_COUNT');
    expect(script).toContain('TABLE_ABSENT');
    expect(script).toContain('SCHEMA_MIGRATION');
    expect(script).toContain('OUTBOX_WINDOWS=%s');
    expect(script).toContain('OUTBOX_ANDROID=%s');
    expect(script).toContain('CLIENT_STATE_WINDOWS=%s');
    expect(script).toContain('CLIENT_STATE_ANDROID=%s');
    expect(script).toContain('EXPECTED_PRE_V2_STOCK_CHECKS=ABSENT');
    expect(script).toContain(
      '9|009_offline_operations.sql|e4a35e360a8e726dc0cbfa202b9f445b684a39172ce42c8944c3a975dce892c1',
    );
  });

  it('cannot deploy, stop services, mutate schemas, clear data, or print environments', async () => {
    const script = (await readFile(scriptPath, 'utf8')).toLowerCase();

    for (const forbidden of [
      'docker compose down',
      'docker compose stop',
      'docker compose restart',
      'docker compose up',
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
    expect(script).not.toMatch(/(^|\s)env(\s|$)/m);
  });
});
