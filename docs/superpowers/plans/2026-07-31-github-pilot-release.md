# GitHub Pilot Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a private GitHub prerelease containing a tested Windows Squirrel installer and Android pilot debug APK that connect only to CH Core at `https://192.168.1.14:8443` with the bundled public CA.

**Architecture:** Add immutable public deployment assets and a small packaged-desktop seeding boundary, add Android endpoint/CA resources, then add one manually dispatched GitHub Actions workflow whose source gates must pass before platform builds and prerelease publication. Keep all private keys, database credentials, and device credentials outside GitHub.

**Tech Stack:** Electron Forge 7/Squirrel, Capacitor 8/Gradle, Node 24, TypeScript/Vitest, GitHub Actions, GitHub Releases.

## Global Constraints

- Repository: private `KentMaoza/CH-Ultimate`.
- Pilot endpoint: exactly `https://192.168.1.14:8443`.
- Bundle only the public CA; never commit the CA signing key, NAS leaf private key, MariaDB credentials, device tokens, recovery credentials, or user data.
- Packaged clients fail closed and never silently instantiate the mock gateway.
- Android artifact is a debug-signed copied-data pilot APK, not a production release.
- Windows artifact is a Squirrel installer without Authenticode signing; document the publisher warning.
- Publication is manual and cannot run unless source, Windows, and Android jobs pass.
- Do not run the MariaDB integration suite against the NAS or any schema other than exact isolated `/chu_test`.
- No automatic updates, Internet CH Core access, or production-readiness claim.

---

### Task 1: Seed packaged Windows deployment trust

**Files:**
- Create: `resources/ch-core-deployment.json`
- Create: `resources/ch-core-ca.pem`
- Create: `src/electron/core-packaged-deployment.ts`
- Create: `tests/unit/electron-packaged-deployment.test.ts`
- Modify: `src/main.ts:26-42`
- Modify: `forge.config.ts:6-12`

**Interfaces:**
- Consumes: `parseCoreEndpointConfig(input: unknown): CoreEndpointConfig` and the off-repository public CA at `/Users/hamlet/Library/Application Support/CH Ultimate/PKI/public/ch-ultimate-ca.cert.pem`.
- Produces: `ensurePackagedCoreDeployment(input: { resourcesPath: string; userDataPath: string }): Promise<string>`, returning the absolute user-data config path.

- [ ] **Step 1: Write the failing packaged-deployment tests**

Add tests proving that the helper copies only the public CA, writes this exact runtime configuration, returns the config path, and never overwrites existing config or CA files:

```ts
expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
  endpoint: 'https://192.168.1.14:8443',
  caFile: join(userDataPath, 'ch-core-ca.pem'),
});
expect(await readFile(join(userDataPath, 'ch-core-ca.pem'), 'utf8'))
  .toContain('BEGIN CERTIFICATE');
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npx vitest run tests/unit/electron-packaged-deployment.test.ts`

Expected: FAIL because `core-packaged-deployment.ts` and the deployment resources do not exist.

- [ ] **Step 3: Add the immutable deployment assets**

Create `resources/ch-core-deployment.json`:

```json
{
  "endpoint": "https://192.168.1.14:8443"
}
```

Copy the public CA certificate verbatim to `resources/ch-core-ca.pem`. Verify its SHA-256 certificate fingerprint remains:

```text
39:7C:7A:74:5A:F5:99:ED:D7:F8:98:CE:FF:50:D3:F5:11:7C:7F:7D:1B:61:00:AC:8F:9C:AB:7D:E9:98:76:3C
```

- [ ] **Step 4: Implement the minimal packaged-deployment helper**

The helper must:

1. Read `ch-core-deployment.json` and `ch-core-ca.pem` from `resourcesPath` with the existing bounded reader.
2. Require the deployment JSON to contain exactly one string key, `endpoint`.
3. Combine the endpoint with absolute `join(userDataPath, 'ch-core-ca.pem')` and validate through `parseCoreEndpointConfig`.
4. Create the user-data directory.
5. Write the CA and config with exclusive-create semantics; ignore only `EEXIST` so existing installation state is preserved.
6. Use mode `0o600` for newly written files.

```ts
export async function ensurePackagedCoreDeployment(
  input: PackagedCoreDeploymentInput,
): Promise<string>;
```

- [ ] **Step 5: Wire packaged startup and Forge resources**

In `src/main.ts`, use the helper only when `app.isPackaged`; unpackaged development keeps the existing user-data config lookup. Pass `process.resourcesPath` and `app.getPath('userData')`, then pass the returned path to `createCoreDesktopService`.

In `forge.config.ts`, replace the example-only resource with:

```ts
extraResource: [
  'resources/ch-core-deployment.json',
  'resources/ch-core-ca.pem',
],
```

- [ ] **Step 6: Run focused Windows configuration tests**

Run:

```bash
npx vitest run \
  tests/unit/electron-packaged-deployment.test.ts \
  tests/unit/electron-main-startup.test.ts \
  tests/unit/electron-desktop-service.test.ts \
  tests/unit/electron-core-https.test.ts
npm run typecheck
```

Expected: all focused tests and TypeScript checks pass.

- [ ] **Step 7: Commit Task 1**

```bash
git add resources/ch-core-deployment.json resources/ch-core-ca.pem \
  src/electron/core-packaged-deployment.ts src/main.ts forge.config.ts \
  tests/unit/electron-packaged-deployment.test.ts
git commit -m "feat: bundle Windows pilot trust"
```

### Task 2: Bundle Android pilot endpoint and CA

**Files:**
- Create: `android/app/src/main/res/values/ch_core_config.xml`
- Create: `android/app/src/main/res/raw/ch_core_ca.pem`
- Create: `tests/unit/pilot-deployment-assets.test.ts`

**Interfaces:**
- Consumes: `CoreDeploymentConfig.load(Context)` resource names `ch_core_endpoint` and `ch_core_ca`.
- Produces: Android resources that resolve to the exact HTTPS endpoint and parseable public CA.

- [ ] **Step 1: Write the failing deployment-asset test**

The test reads both desktop and Android assets, parses both certificates with `node:crypto` `X509Certificate`, and asserts:

```ts
expect(androidConfig).toContain(
  '<string name="ch_core_endpoint">https://192.168.1.14:8443</string>',
);
expect(androidCertificate.fingerprint256).toBe(
  '39:7C:7A:74:5A:F5:99:ED:D7:F8:98:CE:FF:50:D3:F5:11:7C:7F:7D:1B:61:00:AC:8F:9C:AB:7D:E9:98:76:3C',
);
expect(androidCertificate.raw.equals(desktopCertificate.raw)).toBe(true);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npx vitest run tests/unit/pilot-deployment-assets.test.ts`

Expected: FAIL because the Android deployment resources do not exist.

- [ ] **Step 3: Add the Android resources**

Create `ch_core_config.xml` with `translatable="false"` and the exact endpoint. Copy the same public CA bytes to `res/raw/ch_core_ca.pem`. Do not add the CA signing key or leaf private key.

- [ ] **Step 4: Run Android-focused gates**

Run:

```bash
npx vitest run tests/unit/pilot-deployment-assets.test.ts
npm run android:sync
npm run android:test
npm run android:lint
```

Expected: the asset test, Gradle debug/release unit tests, and lint pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add android/app/src/main/res/values/ch_core_config.xml \
  android/app/src/main/res/raw/ch_core_ca.pem \
  tests/unit/pilot-deployment-assets.test.ts
git commit -m "feat: bundle Android pilot trust"
```

### Task 3: Add a gated GitHub pilot-release workflow

**Files:**
- Create: `.github/workflows/pilot-release.yml`
- Create: `docs/releases/pilot-0.1.0.md`
- Create: `tests/unit/github-pilot-release.test.ts`

**Interfaces:**
- Consumes: npm scripts in `package.json`, Electron Forge output under `out/make/squirrel.windows/x64`, and Gradle debug APK under `android/app/build/outputs/apk/debug`.
- Produces: workflow artifacts `CH-Ultimate-0.1.0-Setup.exe`, `CHU-Companion-Mobile-0.1.0-pilot-debug.apk`, and release-level `SHA256SUMS.txt`.

- [ ] **Step 1: Write the failing workflow-contract test**

Assert that the workflow:

- uses only `workflow_dispatch` and `pull_request` triggers;
- declares Node 24 and JDK 21;
- runs source gates before both platform jobs;
- runs Windows packaging on `windows-latest`;
- runs Android tests/lint before `assembleDebug` on `ubuntu-latest`;
- gives `contents: write` only to the publish job;
- publishes only when manual input `publish` is true;
- never contains `CH_CORE_TEST_DATABASE_URL`, a NAS password, `curl -k`, or certificate-validation bypasses.

- [ ] **Step 2: Run the workflow-contract test and verify failure**

Run: `npx vitest run tests/unit/github-pilot-release.test.ts`

Expected: FAIL because `.github/workflows/pilot-release.yml` does not exist.

- [ ] **Step 3: Implement the four workflow jobs**

Use pinned major action versions and these dependencies:

```yaml
source-gates: {}
windows-installer:
  needs: source-gates
android-apk:
  needs: source-gates
publish-prerelease:
  needs: [windows-installer, android-apk]
  if: github.event_name == 'workflow_dispatch' && inputs.publish
```

`source-gates` runs `npm ci`, `npm run verify`, `npm run test:mobile`, `npm run mobile:build`, `npm run server:test`, `npm run server:typecheck`, Playwright's Electron E2E under Xvfb, a tracked-private-key scan, and `git diff --check`.

`windows-installer` runs `npm ci` and `npm run make:windows`, locates exactly one `*Setup.exe`, renames it to `CH-Ultimate-0.1.0-Setup.exe`, and records its checksum.

`android-apk` installs Node 24, Temurin JDK 21, and Android tooling; runs `npm ci`, `npm run android:sync`, `npm run android:test`, and `npm run android:lint`; runs `./gradlew assembleDebug`; renames the APK and records its checksum.

The account's Actions artifact-storage quota is unavailable, so validation jobs do not use `upload-artifact`. `publish-prerelease` is the only write-enabled job: after both platform jobs pass, it rebuilds both payloads from the same commit on `windows-latest`, rejects missing or duplicate files, creates `SHA256SUMS.txt`, and uses authenticated `gh release create pilot-v0.1.0 ... --prerelease --notes-file docs/releases/pilot-0.1.0.md`.

- [ ] **Step 4: Write exact pilot installation notes**

Document:

- sign in to the private GitHub repository before downloading;
- connect the device to the same business Wi-Fi as `192.168.1.14`;
- Windows may require `More info` then `Run anyway` because Authenticode is absent;
- Android requires temporary permission for the browser/Files app to install unknown apps;
- the APK is debug-signed and may require uninstall for a future differently signed pilot;
- first launch must show configured/unpaired, followed by owner-approved pairing;
- the artifacts are copied-data pilot software, not the sole production record.

- [ ] **Step 5: Run workflow and release-contract tests**

Run:

```bash
npx vitest run \
  tests/unit/github-pilot-release.test.ts \
  tests/unit/pilot-deployment-assets.test.ts
git diff --check
```

Expected: all tests pass and YAML contains no forbidden secret or bypass markers.

- [ ] **Step 6: Commit Task 3**

```bash
git add .github/workflows/pilot-release.yml \
  docs/releases/pilot-0.1.0.md tests/unit/github-pilot-release.test.ts
git commit -m "ci: build private pilot installers"
```

### Task 4: Refresh distribution and acceptance documentation

**Files:**
- Modify: `README.md:10-32,83-143`
- Modify: `docs/ch-core-acceptance-status.md:38-58,68-118`

**Interfaces:**
- Consumes: the verified NAS TLS/firewall checkpoint and workflow artifact names.
- Produces: accurate current-state instructions without claiming physical installation or production readiness.

- [ ] **Step 1: Update README current boundaries**

Replace stale statements that CH Core is not deployed. State that the copied-data runtime and LAN HTTPS endpoint exist, while stable addressing, backup/restore, completed SMART, UPS signaling, soak, signed Android release, and physical-client gates remain open.

- [ ] **Step 2: Add GitHub pilot download instructions**

Link `docs/releases/pilot-0.1.0.md`, name both artifacts exactly, and explain that release availability is evidence of CI builds—not evidence of installation or synchronization on physical devices.

- [ ] **Step 3: Update the acceptance ledger only with proven states**

Mark GitHub source/release workflow `READY` after local tests. Keep Windows physical installation, Android physical installation, 24-hour pilot, and production rollout `BLOCKED` until direct evidence exists.

- [ ] **Step 4: Run documentation tests and patch hygiene**

Run:

```bash
npm --workspace @ch-ultimate/core run test -- \
  test/runbooks.test.ts test/deployment-artifacts.test.ts
git diff --check
```

Expected: 23/23 focused server tests pass and the patch is clean.

- [ ] **Step 5: Commit Task 4**

```bash
git add README.md docs/ch-core-acceptance-status.md
git commit -m "docs: add pilot installation handoff"
```

### Task 5: Run the complete prepublication test matrix

**Files:**
- No source changes unless a test exposes a defect directly caused by Tasks 1-4.

**Interfaces:**
- Consumes: all release source and workflow files.
- Produces: a current local verification receipt before any GitHub publication.

- [ ] **Step 1: Run root, mobile, server, and packaging gates**

Run:

```bash
npm run verify
npm run test:mobile
npm run mobile:build
npm run package
npm run test:e2e
npm run server:test
npm run server:typecheck
npm run android:sync
npm run android:test
npm run android:lint
git diff --check
```

Expected: every command passes. Do not run `server:test:integration` without the exact isolated `/chu_test` connection.

- [ ] **Step 2: Verify tracked-source secrecy and certificate identity**

Run:

```bash
git ls-files | rg -i '\.(key|jks|keystore|p12|pfx)$' && exit 1 || true
openssl x509 -in resources/ch-core-ca.pem -noout -fingerprint -sha256
git status --short
```

Expected: no tracked private-key files, the expected CA fingerprint, and a clean worktree.

### Task 6: Create and publish the private GitHub repository

**Files:**
- External GitHub state only.

**Interfaces:**
- Consumes: clean local branch `codex/ch-core-nas-sync` and authenticated GitHub account `KentMaoza`.
- Produces: private repository, `origin` remote, pushed `main` and feature branch, and a draft pull request.

- [ ] **Step 1: Reconfirm clean scope and authentication**

Run:

```bash
git status -sb
gh auth status
```

Expected: clean feature branch; active account `KentMaoza` with `repo` and `workflow` scopes.

- [ ] **Step 2: Create the private repository without rewriting history**

Run:

```bash
gh repo create KentMaoza/CH-Ultimate \
  --private \
  --description "Windows, Android, and LAN-only CH Core for Toko CH" \
  --source . \
  --remote origin
git push origin main:main
git push -u origin codex/ch-core-nas-sync
```

Expected: `gh repo view KentMaoza/CH-Ultimate --json isPrivate` returns `true`.

- [ ] **Step 3: Open the draft pull request**

Create a draft PR from `codex/ch-core-nas-sync` to `main` summarizing the CH Core implementation, NAS copied-data deployment, client trust assets, test matrix, and remaining physical/production gates.

- [ ] **Step 4: Wait for pull-request checks and fix only evidenced failures**

Use `gh pr checks --watch`. If a check fails, inspect its Actions log, apply the smallest correction, rerun the directly affected local test, commit, and push. Do not weaken a gate to make CI green.

- [ ] **Step 5: Merge only after required checks pass**

Mark the PR ready, merge it into `main`, and verify the merge commit is the remote default branch head. Preserve the feature branch until release verification completes.

### Task 7: Build, publish, and verify the GitHub prerelease

**Files:**
- External GitHub Actions and Release state only.

**Interfaces:**
- Consumes: merged workflow on `main`.
- Produces: private prerelease `pilot-v0.1.0` with two installers and `SHA256SUMS.txt`.

- [ ] **Step 1: Dispatch the nonpublishing build first**

Run:

```bash
gh workflow run pilot-release.yml --ref main -f publish=false
gh run watch --exit-status
```

Expected: source, Windows, and Android jobs pass; no GitHub Release is created.

- [ ] **Step 2: Download and inspect workflow artifacts**

Download the completed run into a temporary directory. Verify exactly one `.exe` and one `.apk`, filenames match the contract, neither is empty, `file` recognizes their formats, and the APK passes `apksigner verify` when available.

- [ ] **Step 3: Dispatch the publishing build**

Run:

```bash
gh workflow run pilot-release.yml --ref main -f publish=true
gh run watch --exit-status
```

Expected: all jobs pass and prerelease `pilot-v0.1.0` is created.

- [ ] **Step 4: Verify the private prerelease receipt**

Use `gh release view pilot-v0.1.0 --json isPrerelease,assets,url`. Download all assets into a new temporary directory, run `shasum -a 256 -c SHA256SUMS.txt`, and confirm there are exactly three assets.

- [ ] **Step 5: Record current evidence and stop before physical installation**

Update the acceptance ledger with the GitHub repository URL, release URL, workflow run IDs, artifact names, and checksum result. Keep Windows installation, Android installation, pairing, synchronization, and 24-hour pilot gates open until the user has the devices available.

- [ ] **Step 6: Commit and push the release receipt**

```bash
git add docs/ch-core-acceptance-status.md
git commit -m "docs: record pilot release artifacts"
git push
```
