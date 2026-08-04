import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/pilot-release.yml';
const pilotVersion = '0.1.5';
const androidSignerSha256 =
  '57e0731ce3db068e6581980c53610764af05c612184ff50e18a9f4912ca59ba5';

describe('GitHub pilot release workflow', () => {
  it('gates both platform builds and manual prerelease publication', async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).toContain("node-version: '24'");
    expect(workflow).toContain("java-version: '21'");
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
});
