import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/pilot-release.yml';
const pilotVersion = '0.2.2';
const androidSignerSha256 =
  '57e0731ce3db068e6581980c53610764af05c612184ff50e18a9f4912ca59ba5';

async function optionalRepositoryText(path: string): Promise<string> {
  return readFile(path, 'utf8').catch(() => '');
}

describe('GitHub pilot release workflow', () => {
  it('gates both platform builds and manual prerelease publication', async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).toContain("node-version: '24'");
    expect(workflow).toContain("java-version: '21'");
    expect(workflow).toContain('npm audit --omit=dev --audit-level=high');
    expect(workflow).not.toContain('actions/checkout@v4');
    expect(workflow).not.toContain('actions/setup-node@v4');
    expect(workflow).not.toContain('actions/setup-java@v4');
    expect(workflow).not.toContain('android-actions/setup-android@v3');
    expect(workflow).toContain('actions/checkout@v7');
    expect(workflow).toContain('actions/setup-node@v7');
    expect(workflow).toContain('actions/setup-java@v5');
    expect(workflow).toContain('android-actions/setup-android@v4');
    expect(workflow).toContain('windows-installer:');
    expect(workflow).toContain('runs-on: windows-latest');
    expect(workflow).toContain('npm run make:windows');
    expect(workflow).toContain('android-apk:');
    expect(workflow).toContain('npm run android:test');
    expect(workflow).toContain('npm run android:lint');
    expect(workflow).toContain('./gradlew assembleDebug');
    expect(workflow.indexOf('npm run package')).toBeGreaterThan(-1);
    expect(workflow.indexOf('npm run package')).toBeLessThan(
      workflow.indexOf('npm run test:e2e'),
    );
    expect(workflow).toContain('npx playwright install --with-deps chromium');
    expect(
      workflow.indexOf('npx playwright install --with-deps chromium'),
    ).toBeLessThan(workflow.indexOf('npm run test:e2e'));
    expect(workflow.match(/needs: source-gates/g)).toHaveLength(2);
    expect(workflow).toContain('needs: [windows-installer, android-apk]');
    expect(workflow).toContain('contents: write');
    expect(workflow.match(/contents: write/g)).toHaveLength(1);
    expect(workflow).toContain(
      "github.event_name == 'workflow_dispatch' && inputs.publish && github.ref == 'refs/heads/main'",
    );
    expect(workflow).toContain('--prerelease');
    const publisher = workflow.slice(
      workflow.indexOf('publish-prerelease:'),
    );
    expect(publisher).toContain('runs-on: windows-latest');
    expect(publisher).toContain('npm run make:windows');
    expect(publisher).toContain('npm run android:sync');
    expect(publisher).toContain('.\\gradlew.bat assembleRelease');
    expect(publisher).toContain('CHU_COMPANION_KEYSTORE_B64');
    expect(publisher).toContain('CHU_COMPANION_STORE_PASSWORD');
    expect(publisher).toContain('CHU_COMPANION_KEY_ALIAS');
    expect(publisher).toContain('CHU_COMPANION_KEY_PASSWORD');
    expect(publisher).toContain(androidSignerSha256);
    expect(publisher).toContain('apksigner.bat');
    expect(publisher).toContain('$digestMatch = [regex]::Match(');
    expect(publisher).toContain(
      "'certificate SHA-256 digest:\\s*([0-9A-Fa-f]{64})\\s*$'",
    );
    expect(publisher).toContain(
      '$actual = $digestMatch.Groups[1].Value.ToLowerInvariant()',
    );
    expect(publisher).not.toContain("($actualLine -split ':', 2)");
    expect(publisher).toContain('if: always()');
    expect(publisher).toContain('$portableManifest = ($lines -join "`n") + "`n"');
    expect(publisher).toContain('[System.IO.File]::WriteAllText');
    expect(publisher).not.toContain('[System.IO.File]::WriteAllLines');
    expect(workflow).toContain(`CH-Ultimate-${pilotVersion}-Setup.exe`);
    expect(workflow).toContain(
      `CHU-Companion-Mobile-${pilotVersion}-release.apk`,
    );
    expect(publisher).not.toContain('assembleDebug');
    expect(publisher).not.toContain('pilot-debug.apk');
    expect(workflow.slice(0, workflow.indexOf('publish-prerelease:')))
      .not.toContain('CHU_COMPANION_KEYSTORE_B64');
    expect(workflow).toContain(`pilot-v${pilotVersion}`);
    expect(workflow).toContain(`docs/releases/pilot-${pilotVersion}.md`);
  });

  it('does not introduce production credentials or TLS bypasses', async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    expect(workflow).not.toMatch(/CH_CORE_TEST_DATABASE_URL/i);
    expect(workflow).not.toMatch(/mariadb.*password/i);
    expect(workflow).not.toMatch(/curl\s+[^\n]*-[^\n]*k/i);
    expect(workflow).not.toMatch(/rejectUnauthorized\s*:\s*false/i);
    expect(workflow).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/i);
    expect(workflow).toContain('BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY');
  });

  it('keeps the v0.2.2 Core v2 cutover release contract aligned', async () => {
    const [
      workflow,
      packageManifest,
      packageLock,
      androidBuild,
      settingsPage,
      releaseCopy,
      releaseNotes,
      evidence,
      runbook,
    ] = await Promise.all([
      readFile(workflowPath, 'utf8'),
      readFile('package.json', 'utf8'),
      readFile('package-lock.json', 'utf8'),
      readFile('android/app/build.gradle', 'utf8'),
      readFile('src/renderer/pages/SettingsPage.tsx', 'utf8'),
      readFile('scripts/copy-android-release.mjs', 'utf8'),
      optionalRepositoryText(`docs/releases/pilot-${pilotVersion}.md`),
      optionalRepositoryText(`docs/releases/pilot-${pilotVersion}-evidence.md`),
      readFile('docs/ch-core-v0.2-maintenance-rollback.md', 'utf8'),
    ]);

    expect(JSON.parse(packageManifest)).toMatchObject({ version: pilotVersion });
    expect(JSON.parse(packageLock)).toMatchObject({
      version: pilotVersion,
      packages: { '': { version: pilotVersion } },
    });
    expect(androidBuild).toContain('applicationId "com.tokoch.chucompanion"');
    expect(androidBuild).toContain(`versionName "${pilotVersion}"`);
    expect(androidBuild).toContain('versionCode 9');
    expect(settingsPage).toContain(`CH Ultimate ${pilotVersion}`);
    expect(releaseCopy).toContain(
      `CHU-Companion-Mobile-${pilotVersion}-release.apk`,
    );

    for (const artifact of [
      `CH-Ultimate-${pilotVersion}-Setup.exe`,
      `CHU-Companion-Mobile-${pilotVersion}-release.apk`,
      `pilot-v${pilotVersion}`,
      `CH Ultimate pilot v${pilotVersion}`,
      `docs/releases/pilot-${pilotVersion}.md`,
      androidSignerSha256,
    ]) {
      expect(workflow).toContain(artifact);
    }
    expect(workflow).not.toContain('pilot-v0.2.1');
    expect(workflow).not.toContain('CH-Ultimate-0.2.1-Setup.exe');
    expect(workflow).not.toContain('CHU-Companion-Mobile-0.2.1-release.apk');
    expect(releaseCopy).not.toContain('CHU-Companion-Mobile-0.2.1-release.apk');

    for (const releaseFact of [
      'status sinkronisasi',
      'pesan kompatibilitas',
      'diagnostik teknis',
      'Nama Barang',
      'Tombol Kembali Android',
      'logo sidebar Windows',
      'apiSchemaVersion: 2',
      'stockChecks: []',
      'v0.1.5',
      'gagal tertutup',
      'jsPDF 4.2.1',
      'tanpa critical/high',
    ]) {
      expect(releaseNotes.toLowerCase()).toContain(releaseFact.toLowerCase());
    }
    expect(releaseNotes).toMatch(/terbitkan.+0\.2\.2.+sebelum.+CH Core v2/is);
    expect(releaseNotes).toMatch(/v0\.1\.5.+hanya.+sebelum.+Core v2/is);

    expect(evidence).toMatch(/Kontrak dependensi.+PASS/is);
    for (const preparedReceipt of [
      'CH-Ultimate-0.2.2-Setup.exe',
      'CHU-Companion-Mobile-0.2.2-release.apk',
      androidSignerSha256,
      'com.tokoch.chucompanion',
      'versionCode `9`',
      'UNAVAILABLE_AFTER_OWNER_UNINSTALL',
      '0 critical',
      '0 high',
    ]) {
      expect(evidence).toContain(preparedReceipt);
    }
    expect(evidence).not.toMatch(
      /\|\s*[^|]+\s*\|\s*PASS\s*\|\s*`BELUM DIISI[^`]*`\s*\|/i,
    );
    for (const unverifiedGate of [
      'Windows terpasang',
      'Android fisik',
      'deploy CH Core',
      'cetak',
    ]) {
      expect(evidence).toMatch(new RegExp(`${unverifiedGate}.+BELUM DIVERIFIKASI`, 'i'));
    }
    expect(evidence).toMatch(/pilot empat hari.+dihapus/is);

    const supplement = runbook.slice(
      runbook.indexOf('## Suplemen v0.2.2'),
    );
    expect(supplement).toContain('apiSchemaVersion: 2');
    expect(supplement).toContain('stockChecks');
    expect(supplement).toMatch(/tidak mencakup.+clear.+import workbook/is);
  });
});
