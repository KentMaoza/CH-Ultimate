import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/pilot-release.yml';

describe('GitHub pilot release workflow', () => {
  it('gates both platform builds and manual prerelease publication', async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).toContain("node-version: '24'");
    expect(workflow).toContain("java-version: '21'");
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
      "github.event_name == 'workflow_dispatch' && inputs.publish",
    );
    expect(workflow).toContain('--prerelease');
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
