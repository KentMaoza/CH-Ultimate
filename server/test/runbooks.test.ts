import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

async function repositoryText(relativePath: string): Promise<string> {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

describe('CH Core guarded deployment documentation', () => {
  it('records the authenticated NAS preflight and every blocking gate', async () => {
    const deployment = await repositoryText(
      'docs/ch-core-nas-deployment.md',
    );

    for (const fact of [
      'DS223j',
      'DSM 7.4.1-90080',
      'RTD1619B',
      '192.168.1.14/24',
      '90:09:D0:9F:7C:1F',
      'RAID1',
      'Btrfs',
      'ST2000VN003',
      '38',
      '40',
      'Container Manager 24.0.2-1606',
      '532.4 MB',
    ]) {
      expect(deployment).toContain(fact);
    }
    for (const gate of [
      'router reservation',
      'SMART',
      'independent encrypted backup',
      'UPS',
      'MariaDB 10',
      'private CA',
      'IP SAN',
      'firewall',
      'reverse proxy',
      'seven-client',
    ]) {
      expect(deployment.toLowerCase()).toContain(gate.toLowerCase());
    }
  });

  it('keeps CH Core LAN-only and the CA signing key off the NAS', async () => {
    const deployment = await repositoryText(
      'docs/ch-core-nas-deployment.md',
    );

    expect(deployment).toContain('8443');
    expect(deployment).toContain('127.0.0.1:18080');
    expect(deployment).toContain('5001');
    expect(deployment).toContain('445');
    expect(deployment).toMatch(/signing key.+off.+NAS/is);
    expect(deployment).toMatch(/QuickConnect.+administr/is);
    expect(deployment).toMatch(/Tailscale.+administr/is);
    expect(deployment).toMatch(/Serve\/Funnel/);
    expect(deployment).toMatch(/UPnP/);
    expect(deployment).toMatch(/no SSH|tanpa SSH/i);
  });

  it('documents one restricted non-root DSM identity and concrete mount preflight', async () => {
    const deployment = await repositoryText(
      'docs/ch-core-nas-deployment.md',
    );

    expect(deployment).toContain('CH_CORE_RUNTIME_UID');
    expect(deployment).toContain('CH_CORE_RUNTIME_GID');
    expect(deployment).toMatch(/nonzero numeric|numeric nonzero/i);
    expect(deployment).toMatch(/dedicated.+service user/is);
    expect(deployment).toMatch(/Task Scheduler.+id -u/is);
    expect(deployment).toMatch(/Task Scheduler.+id -g/is);
    expect(deployment).toMatch(/create.+write.+delete/is);
    expect(deployment).toMatch(/private.+directory.+backup target/is);
    expect(deployment).toMatch(/same.+UID.+GID/is);
    expect(deployment).toContain('docker compose run --rm ch-core');
    expect(deployment).toContain(
      'docker compose --profile ops run --rm ch-core-ops',
    );
  });

  it('requires an independent clean restore drill with business invariants', async () => {
    const restore = await repositoryText(
      'docs/ch-core-backup-restore.md',
    );

    expect(restore).toMatch(/independent.+RAID1/is);
    expect(restore).toContain('logical dump');
    expect(restore).toContain('private CA signing key');
    expect(restore).toContain('chu_restore_');
    for (const invariant of [
      'SKU count',
      'stock ledger',
      'completed Nota',
      'omzet',
      'audit',
      'change cursor',
      'image references',
    ]) {
      expect(restore).toContain(invariant);
    }
    expect(restore).toMatch(/production.+blocked.+drill/is);
  });

  it('runs dump and restore only through the opt-in ops container', async () => {
    const restore = await repositoryText(
      'docs/ch-core-backup-restore.md',
    );

    expect(restore).toContain(
      'docker compose --profile ops run --rm ch-core-ops',
    );
    expect(restore).toContain('/opt/ch-core-ops/dump-database.sh');
    expect(restore).toContain('/opt/ch-core-ops/verify-dump.sh');
    expect(restore).toContain('/opt/ch-core-ops/restore-scratch.sh');
    expect(restore).toContain('/backup/');
    expect(restore).not.toMatch(/^server\/scripts\//m);
    expect(restore).toMatch(/does not run by default|tidak berjalan.*default/i);
  });

  it('documents completed bundles and separated least-privilege credentials', async () => {
    const restore = await repositoryText(
      'docs/ch-core-backup-restore.md',
    );

    expect(restore).toContain('CH_CORE_BACKUP_DATABASE_URL');
    expect(restore).toContain('CH_CORE_RESTORE_DATABASE_URL');
    expect(restore).toContain('chu_restore_[a-z0-9_]+');
    expect(restore).toMatch(/read-only.+\/chu/is);
    expect(restore).toMatch(/scratch-only.+exact schema/is);
    expect(restore).toMatch(/already exist.+empty/is);
    expect(restore).toMatch(/global.+other-schema/is);
    expect(restore).toMatch(/COMPLETE.+last/is);
    expect(restore).toMatch(/incomplete.+reject/is);
    expect(restore).toMatch(/partial.+NEW scratch/is);
    expect(restore).toMatch(/never.+CREATE DATABASE|does not.+CREATE DATABASE/is);
    expect(restore).toMatch(/never.+DROP DATABASE|does not.+DROP DATABASE/is);
  });

  it('states the current Core architecture, test-only demo boundary, workbook, and unfinished gates', async () => {
    const readme = await repositoryText('README.md');

    expect(readme).toContain(
      'Windows/Android → LAN HTTPS → Node API → MariaDB 10',
    );
    expect(readme).toContain('explicit test-only mock');
    expect(readme).toContain(
      'SKU_Gudang20260730092414031.xlsx',
    );
    expect(readme).toContain(
      '64fcb734d84462060f76fa7f27495ee1e2dff6201ad2d7a2d13d5c6c27923817',
    );
    expect(readme).toContain('3,144');
    expect(readme).toContain('2,786');
    expect(readme).toContain('npm run server:test');
    expect(readme).toContain('npm run android:lint');
    expect(readme).toMatch(/copied-data.+deployed.+NAS/is);
    expect(readme).toMatch(/not.+production|bukan.+production/i);
  });

  it('tracks every local, client-release, and physical acceptance gate without overstating completion', async () => {
    const readme = await repositoryText('README.md');
    const acceptance = await repositoryText(
      'docs/ch-core-acceptance-status.md',
    );

    expect(readme).toContain('CH Core acceptance status');
    for (const requiredEvidence of [
      '462',
      '303',
      '88',
      'Playwright 8/8',
      'Windows x64 ZIP',
      'Squirrel installer',
      'pilot-release.yml',
      'CH-Ultimate-0.1.1-Setup.exe',
      'CHU-Companion-Mobile-0.1.1-pilot-debug.apk',
      'Android release signing',
      'chu_test',
      'Docker/Compose',
      'router reservation',
      'SMART',
      'UPS',
      'clean restore',
      'seven-client',
    ]) {
      expect(acceptance).toContain(requiredEvidence);
    }
    expect(acceptance).toMatch(/Windows.+not tested.+physical/is);
    expect(acceptance).toMatch(/Android.+not installed.+physical/is);
    expect(acceptance).toMatch(/copied-data.+deployed.+NAS/is);
    expect(acceptance).toMatch(/not.+production|bukan.+production/i);
    expect(acceptance).toMatch(/approval.+price/is);
  });

  it('locks the business-LAN cutover, rollback, and acceptance boundaries', async () => {
    const businessLan = await repositoryText('docs/ch-core-business-lan.md');
    const deployment = await repositoryText(
      'docs/ch-core-nas-deployment.md',
    );
    const acceptance = await repositoryText(
      'docs/ch-core-acceptance-status.md',
    );

    for (const requiredTopology of [
      '192.168.1.1/24',
      'WAN DHCP',
      '192.168.50.1/24',
      '192.168.50.100-192.168.50.199',
      'https://192.168.50.14:8443',
      'IP:192.168.50.14',
      '127.0.0.1:18080',
    ]) {
      expect(businessLan).toContain(requiredTopology);
    }

    const allowRule = 'allow tcp 8443 from 192.168.50.0/24';
    const denyRule = 'deny tcp 8443 from every other source';
    expect(businessLan.toLowerCase()).toContain(allowRule);
    expect(businessLan.toLowerCase()).toContain(denyRule);
    expect(businessLan.toLowerCase().indexOf(allowRule)).toBeLessThan(
      businessLan.toLowerCase().indexOf(denyRule),
    );

    for (const requiredBoundary of [
      'MariaDB TCP stays disabled',
      'no UPnP',
      'no port forward',
      'reboot EW then NAS',
      'rollback',
      'seven-client',
    ]) {
      expect(businessLan.toLowerCase()).toContain(
        requiredBoundary.toLowerCase(),
      );
    }
    expect(businessLan).toContain(
      '| NAS Ethernet | Manual `192.168.50.14/24`, gateway/DNS `192.168.50.1`, MAC `90:09:D0:9F:7C:1F` |',
    );
    expect(businessLan).toMatch(
      /Do not create Internet exposure, QuickConnect, Tailscale,\s+public-DNS, or Tailscale Serve\/Funnel exposure for CH Core\./,
    );
    expect(businessLan).toMatch(
      /From FiberHome\/IndiHome, guest Wi-Fi, mobile data, WAN, QuickConnect, and\s+Tailscale, TCP 8443 is unreachable\./,
    );
    expect(businessLan).toMatch(
      /They must retain\s+the existing public CA and fail closed for the old IP, a wrong-IP leaf, an\s+untrusted leaf, redirects, paths, and other origins\./,
    );
    expect(businessLan).toContain(
      'Rollback applies only to this network/certificate/firewall cutover.',
    );
    expect(businessLan).toMatch(
      /Do not change the CH Core image, database schema, database data, CA signing\s+key, or client trust bundle as a network rollback shortcut\./,
    );
    expect(businessLan).toContain(
      'This runbook does not make CH Core a production endpoint.',
    );
    expect(businessLan).toMatch(/one NAS\s+MAC at \.50\.14/i);

    expect(businessLan).toMatch(/does not.+perform.+cutover/is);
    expect(deployment).toMatch(/planned business-LAN cutover/is);
    expect(acceptance).toMatch(/live cutover has not happened/is);
    expect(acceptance).toMatch(/DHCP `192\.168\.1\.14\/24`/);
    expect(acceptance).toMatch(/firewall UI.+disabled/is);
    expect(acceptance).toMatch(/one NAS MAC.+\.50\.14.+EW.+NAS reboots/is);
  });
});
