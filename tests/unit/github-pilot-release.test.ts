import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

const workflowPath = '.github/workflows/pilot-release.yml';
const pilotVersion = '0.2.4';
const androidSignerSha256 =
  '57e0731ce3db068e6581980c53610764af05c612184ff50e18a9f4912ca59ba5';
const require = createRequire(import.meta.url);
const { stagePilotDraft } = require('../../scripts/stage-pilot-draft.cjs') as {
  stagePilotDraft(input: {
    runGh(args: string[]): string;
    repository: string;
    commitSha: string;
    releaseTag: string;
    fileExists(path: string): boolean;
  }): void;
};

async function optionalRepositoryText(path: string): Promise<string> {
  return readFile(path, 'utf8').catch(() => '');
}

describe('GitHub pilot release workflow', () => {
  it('gates both platform builds and stages an unpublished release draft', async () => {
    const [workflow, releaseScript] = await Promise.all([
      readFile(workflowPath, 'utf8'),
      readFile('scripts/stage-pilot-draft.cjs', 'utf8'),
    ]);

    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toContain('candidate_tag:');
    expect(workflow).toContain('default: pilot-v0.2.4-r2');
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
    expect(workflow).toContain('mariadb-integration:');
    expect(workflow).toContain('image: mariadb:10.11');
    expect(workflow).toContain('MARIADB_DATABASE: chu_test');
    expect(workflow).toContain('MARIADB_USER: chu_test');
    expect(workflow).toContain('MARIADB_PASSWORD: chu_test_ci_only');
    expect(workflow).toContain(
      'CH_CORE_TEST_DATABASE_URL: mariadb://chu_test:chu_test_ci_only@127.0.0.1:3306/chu_test',
    );
    expect(workflow).toContain('npm run server:test:integration');
    expect(workflow.match(/needs: source-gates/g)).toHaveLength(3);
    expect(workflow).toContain(
      'needs: [windows-installer, android-apk, mariadb-integration]',
    );
    expect(workflow).toContain('contents: write');
    expect(workflow.match(/contents: write/g)).toHaveLength(1);
    expect(workflow).toContain(
      "github.event_name == 'workflow_dispatch' && inputs.stage_draft && github.ref == 'refs/heads/main'",
    );
    expect(releaseScript).toContain("'--draft'");
    expect(releaseScript).toContain("'--prerelease'");
    const publisher = workflow.slice(
      workflow.indexOf('stage-draft-release:'),
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
    expect(publisher).toContain('Get-AuthenticodeSignature');
    expect(publisher).toContain("'NotSigned'");
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
    expect(workflow.slice(0, workflow.indexOf('stage-draft-release:')))
      .not.toContain('CHU_COMPANION_KEYSTORE_B64');
    expect(publisher).toContain('node scripts/stage-pilot-draft.cjs');
    const releaseControl = `${workflow}\n${releaseScript}`;
    expect(releaseControl).not.toContain('release upload');
    expect(releaseControl).not.toContain('release delete');
    expect(releaseControl).not.toContain('--clobber');
    expect(releaseControl).not.toContain('release edit');
    expect(releaseScript).not.toContain("'--method'");
    expect(releaseControl).toContain(`pilot-v${pilotVersion}`);
    expect(releaseControl).toContain(`docs/releases/pilot-${pilotVersion}.md`);
  });

  it('creates r2 only after exhaustive release and exact Git-tag checks pass', () => {
    const calls: string[][] = [];
    const commitSha = '141961c4a2ef58cecd6525c88903f76d929367b5';
    stagePilotDraft({
      repository: 'KentMaoza/CH-Ultimate',
      commitSha,
      releaseTag: 'pilot-v0.2.4-r2',
      fileExists: () => true,
      runGh: (args) => {
        calls.push(args);
        if (args.includes('--slurp')) {
          return JSON.stringify([[{ tag_name: 'pilot-v0.2.4' }], []]);
        }
        if (args.some((arg) => arg.includes('matching-refs'))) return '[]';
        return '';
      },
    });

    expect(calls[0]).toEqual([
      'api', '--paginate', '--slurp',
      'repos/KentMaoza/CH-Ultimate/releases?per_page=100',
    ]);
    expect(calls[1]).toEqual([
      'api',
      'repos/KentMaoza/CH-Ultimate/git/matching-refs/tags/pilot-v0.2.4-r2',
    ]);
    expect(calls).toHaveLength(3);
    expect(calls[2]).toEqual([
      'release',
      'create',
      'pilot-v0.2.4-r2',
      'release/CH-Ultimate-0.2.4-Setup.exe',
      'release/CHU-Companion-Mobile-0.2.4-release.apk',
      'release/SHA256SUMS.txt',
      '--repo',
      'KentMaoza/CH-Ultimate',
      '--draft',
      '--prerelease',
      '--target',
      commitSha,
      '--title',
      'CH Ultimate pilot v0.2.4 r2',
      '--notes-file',
      'docs/releases/pilot-0.2.4.md',
    ]);
  });

  it('refuses an r2 release found on a later API page before mutation', () => {
    const calls: string[][] = [];
    expect(() => stagePilotDraft({
      repository: 'KentMaoza/CH-Ultimate',
      commitSha: '141961c4a2ef58cecd6525c88903f76d929367b5',
      releaseTag: 'pilot-v0.2.4-r2',
      fileExists: () => true,
      runGh: (args) => {
        calls.push(args);
        if (args.includes('--slurp')) {
          return JSON.stringify([
            [{ tag_name: 'pilot-v0.2.4' }],
            [{ tag_name: 'pilot-v0.2.4-r2' }],
          ]);
        }
        if (args.some((arg) => arg.includes('matching-refs'))) return '[]';
        return '';
      },
    })).toThrow('Release pilot-v0.2.4-r2 already exists.');
    expect(calls).toEqual([
      [
        'api', '--paginate', '--slurp',
        'repos/KentMaoza/CH-Ultimate/releases?per_page=100',
      ],
      [
        'api',
        'repos/KentMaoza/CH-Ultimate/git/matching-refs/tags/pilot-v0.2.4-r2',
      ],
    ]);
  });

  it('refuses an r2 Git tag that points at another commit before mutation', () => {
    const calls: string[][] = [];
    expect(() => stagePilotDraft({
      repository: 'KentMaoza/CH-Ultimate',
      commitSha: '141961c4a2ef58cecd6525c88903f76d929367b5',
      releaseTag: 'pilot-v0.2.4-r2',
      fileExists: () => true,
      runGh: (args) => {
        calls.push(args);
        if (args.includes('--slurp')) return JSON.stringify([[]]);
        if (args.some((arg) => arg.includes('matching-refs'))) {
          return JSON.stringify([{
            ref: 'refs/tags/pilot-v0.2.4-r2',
            object: { sha: '23dea103864a47925c2d7da06dfc69ef380ceba6' },
          }]);
        }
        return '';
      },
    })).toThrow('Tag pilot-v0.2.4-r2 already exists.');
    expect(calls).toEqual([
      [
        'api', '--paginate', '--slurp',
        'repos/KentMaoza/CH-Ultimate/releases?per_page=100',
      ],
      [
        'api',
        'repos/KentMaoza/CH-Ultimate/git/matching-refs/tags/pilot-v0.2.4-r2',
      ],
    ]);
  });

  it('fails closed when GitHub release discovery cannot complete', () => {
    const calls: string[][] = [];
    expect(() => stagePilotDraft({
      repository: 'KentMaoza/CH-Ultimate',
      commitSha: '141961c4a2ef58cecd6525c88903f76d929367b5',
      releaseTag: 'pilot-v0.2.4-r2',
      fileExists: () => true,
      runGh: (args) => {
        calls.push(args);
        throw new Error('GitHub API tidak tersedia');
      },
    })).toThrow('GitHub API tidak tersedia');
    expect(calls).toHaveLength(1);
    expect(calls.some((args) => args[0] === 'release')).toBe(false);
  });

  it('can recover from an incomplete r2 only by creating a fresh r3 candidate', () => {
    const calls: string[][] = [];
    stagePilotDraft({
      repository: 'KentMaoza/CH-Ultimate',
      commitSha: '141961c4a2ef58cecd6525c88903f76d929367b5',
      releaseTag: 'pilot-v0.2.4-r3',
      fileExists: () => true,
      runGh: (args) => {
        calls.push(args);
        if (args.includes('--slurp')) {
          return JSON.stringify([[{
            tag_name: 'pilot-v0.2.4-r2',
            draft: true,
            prerelease: true,
            target_commitish: '141961c4a2ef58cecd6525c88903f76d929367b5',
            assets: [{ name: 'CH-Ultimate-0.2.4-Setup.exe', size: 149_000_000 }],
          }]]);
        }
        if (args.some((arg) => arg.includes('matching-refs'))) return '[]';
        return '';
      },
    });

    expect(calls).toHaveLength(3);
    expect(calls[1]).toContain(
      'repos/KentMaoza/CH-Ultimate/git/matching-refs/tags/pilot-v0.2.4-r3',
    );
    expect(calls[2]?.slice(0, 3)).toEqual(['release', 'create', 'pilot-v0.2.4-r3']);
    expect(calls.flat()).not.toContain('delete');
  });

  it('refuses recovery when the immediately previous candidate is already complete', () => {
    const calls: string[][] = [];
    expect(() => stagePilotDraft({
      repository: 'KentMaoza/CH-Ultimate',
      commitSha: '141961c4a2ef58cecd6525c88903f76d929367b5',
      releaseTag: 'pilot-v0.2.4-r3',
      fileExists: () => true,
      runGh: (args) => {
        calls.push(args);
        if (args.includes('--slurp')) {
          return JSON.stringify([[{
            tag_name: 'pilot-v0.2.4-r2',
            draft: true,
            prerelease: true,
            target_commitish: '141961c4a2ef58cecd6525c88903f76d929367b5',
            assets: [
              { name: 'CH-Ultimate-0.2.4-Setup.exe', size: 149_000_000 },
              { name: 'CHU-Companion-Mobile-0.2.4-release.apk', size: 43_000_000 },
              { name: 'SHA256SUMS.txt', size: 199 },
            ],
          }]]);
        }
        if (args.some((arg) => arg.includes('matching-refs'))) return '[]';
        return '';
      },
    })).toThrow('Previous candidate pilot-v0.2.4-r2 is not an eligible incomplete draft.');
    expect(calls).toHaveLength(2);
    expect(calls.some((args) => args[0] === 'release')).toBe(false);
  });

  it.each([
    ['duplicate', [
      {
        tag_name: 'pilot-v0.2.4-r2', draft: true, prerelease: true,
        target_commitish: '141961c4a2ef58cecd6525c88903f76d929367b5', assets: [],
      },
      {
        tag_name: 'pilot-v0.2.4-r2', draft: true, prerelease: true,
        target_commitish: '141961c4a2ef58cecd6525c88903f76d929367b5', assets: [],
      },
    ]],
    ['missing or gapped', []],
    ['published', [{
      tag_name: 'pilot-v0.2.4-r2', draft: false, prerelease: true,
      target_commitish: '141961c4a2ef58cecd6525c88903f76d929367b5', assets: [],
    }]],
    ['not prerelease', [{
      tag_name: 'pilot-v0.2.4-r2', draft: true, prerelease: false,
      target_commitish: '141961c4a2ef58cecd6525c88903f76d929367b5', assets: [],
    }]],
    ['wrong target', [{
      tag_name: 'pilot-v0.2.4-r2', draft: true, prerelease: true,
      target_commitish: '23dea103864a47925c2d7da06dfc69ef380ceba6', assets: [],
    }]],
    ['malformed assets', [{
      tag_name: 'pilot-v0.2.4-r2', draft: true, prerelease: true,
      target_commitish: '141961c4a2ef58cecd6525c88903f76d929367b5',
      assets: [{ name: 'CH-Ultimate-0.2.4-Setup.exe', size: 'large' }],
    }]],
  ])('refuses %s predecessor recovery state after exactly two reads', (_label, releases) => {
    const calls: string[][] = [];
    expect(() => stagePilotDraft({
      repository: 'KentMaoza/CH-Ultimate',
      commitSha: '141961c4a2ef58cecd6525c88903f76d929367b5',
      releaseTag: 'pilot-v0.2.4-r3',
      fileExists: () => true,
      runGh: (args) => {
        calls.push(args);
        if (args.includes('--slurp')) return JSON.stringify([releases]);
        if (args.some((arg) => arg.includes('matching-refs'))) return '[]';
        return '';
      },
    })).toThrow('Previous candidate pilot-v0.2.4-r2 is not an eligible incomplete draft.');
    expect(calls).toHaveLength(2);
    expect(calls.some((args) => args[0] === 'release')).toBe(false);
  });

  it('rejects an unbounded candidate revision before any GitHub call', () => {
    const runGh = vi.fn(() => '');
    expect(() => stagePilotDraft({
      repository: 'KentMaoza/CH-Ultimate',
      commitSha: '141961c4a2ef58cecd6525c88903f76d929367b5',
      releaseTag: 'pilot-v0.2.4-r100',
      fileExists: () => true,
      runGh,
    })).toThrow('CHU_PILOT_RELEASE_TAG is invalid.');
    expect(runGh).not.toHaveBeenCalled();
  });

  it('does not introduce production credentials or TLS bypasses', async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    expect(workflow.match(/CH_CORE_TEST_DATABASE_URL/g)).toHaveLength(1);
    expect(workflow).not.toMatch(/CH_CORE_TEST_DATABASE_URL:[^\n]*(192\.168\.|\/chu(?:\s|$))/i);
    expect(workflow).not.toMatch(/^\s+MARIADB_ROOT_PASSWORD:/im);
    expect(workflow).not.toMatch(/curl\s+[^\n]*-[^\n]*k/i);
    expect(workflow).not.toMatch(/rejectUnauthorized\s*:\s*false/i);
    expect(workflow).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/i);
    expect(workflow).toContain('BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY');
  });

  it('keeps the v0.2.4 real-use release contract aligned', async () => {
    const [
      workflow,
      packageManifest,
      packageLock,
      androidBuild,
      settingsPage,
      releaseCopy,
      releaseNotes,
      runbook,
      releaseScript,
    ] = await Promise.all([
      readFile(workflowPath, 'utf8'),
      readFile('package.json', 'utf8'),
      readFile('package-lock.json', 'utf8'),
      readFile('android/app/build.gradle', 'utf8'),
      readFile('src/renderer/pages/SettingsPage.tsx', 'utf8'),
      readFile('scripts/copy-android-release.mjs', 'utf8'),
      optionalRepositoryText(`docs/releases/pilot-${pilotVersion}.md`),
      readFile('docs/ch-core-v0.2-maintenance-rollback.md', 'utf8'),
      readFile('scripts/stage-pilot-draft.cjs', 'utf8'),
    ]);
    const releaseContract = `${workflow}\n${releaseScript}`;

    expect(JSON.parse(packageManifest)).toMatchObject({ version: pilotVersion });
    expect(JSON.parse(packageLock)).toMatchObject({
      version: pilotVersion,
      packages: { '': { version: pilotVersion } },
    });
    expect(androidBuild).toContain('applicationId "com.tokoch.chucompanion"');
    expect(androidBuild).toContain(`versionName "${pilotVersion}"`);
    expect(androidBuild).toContain('versionCode 11');
    expect(settingsPage).toContain(`CH Ultimate ${pilotVersion}`);
    expect(releaseCopy).toContain(
      `CHU-Companion-Mobile-${pilotVersion}-release.apk`,
    );
    expect(releaseNotes).toContain(`pilot-v${pilotVersion}-r2`);
    expect(releaseNotes).toContain('candidate_tag');
    expect(releaseNotes).toContain(`pilot-v${pilotVersion}-r3`);
    expect(releaseNotes).toContain(`# CH Ultimate pilot v${pilotVersion} candidate`);
    expect(releaseNotes).not.toContain(`Payload GitHub prerelease \`pilot-v${pilotVersion}-r2\` adalah:`);

    for (const artifact of [
      `CH-Ultimate-${pilotVersion}-Setup.exe`,
      `CHU-Companion-Mobile-${pilotVersion}-release.apk`,
      `pilot-v${pilotVersion}`,
      `CH Ultimate pilot v${pilotVersion}`,
      `docs/releases/pilot-${pilotVersion}.md`,
      androidSignerSha256,
    ]) {
      expect(releaseContract).toContain(artifact);
    }
    expect(releaseContract).not.toContain('pilot-v0.2.1');
    expect(workflow).not.toContain('CH-Ultimate-0.2.1-Setup.exe');
    expect(workflow).not.toContain('CHU-Companion-Mobile-0.2.1-release.apk');
    expect(releaseCopy).not.toContain('CHU-Companion-Mobile-0.2.1-release.apk');

    for (const releaseFact of [
      'rekonsiliasi katalog aman',
      'mempertahankan ID SKU',
      'SKU lama yang tidak ada di workbook',
      'identifier tambahan tetap dipertahankan',
      'histori harga yang sudah ada',
      'dihapus atau dijadikan alasan',
      'catalogue_reconciliation',
      'tidak membuat movement palsu',
      'receipt impor',
      'apiSchemaVersion: 2',
      'stockChecks: []',
      'gagal tertutup',
      'backup dan scratch',
      'empat hari tidak termasuk',
      'tidak boleh dihapus',
      'authenticode',
      'draft',
    ]) {
      expect(releaseNotes.toLowerCase()).toContain(releaseFact.toLowerCase());
    }
    expect(releaseNotes).toMatch(/deploy Core.+commit rilis v0\.2\.4/is);

    const supplement = runbook.slice(
      runbook.indexOf('## Suplemen v0.2.2'),
    );
    expect(supplement).toContain('apiSchemaVersion: 2');
    expect(supplement).toContain('stockChecks');
    expect(supplement).toMatch(/tidak mencakup.+clear.+import workbook/is);
  });
});
