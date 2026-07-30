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
    expect(readme).toMatch(/not deployed|belum di-deploy/i);
  });
});
