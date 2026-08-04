# CH Core Owner Device Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the sole Windows owner generate, inspect, and explicitly approve a one-use pairing request so a Windows or Android client can finish CH Core enrollment.

**Architecture:** CH Core adds one owner-only read projection for an existing pairing ID. Electron main owns authenticated calls and strict response parsing; the preload exposes three fixed owner methods without tokens or arbitrary HTTP. A focused Settings card holds only the currently displayed pairing and requires the owner to inspect the claimed device name/platform before approval.

**Tech Stack:** Node 24, TypeScript, Fastify 5, MariaDB 10, Electron, React 19, Zod, Vitest, Testing Library, Playwright, Capacitor Android, GitHub Actions.

## Global Constraints

- The first Windows laptop is the sole `owner`; every other Windows/Android installation is a `client`.
- `Nama perangkat` is a trimmed 1-160 character installation label, not a login or password.
- Pairing codes remain one-use, eight digits, and valid for ten minutes.
- The owner must see the claimed device name and platform before approval.
- Bearer tokens, recovery credentials, hashes, installation IDs, and claim secrets never enter renderer JavaScript or a public pairing response.
- Keep the endpoint pinned to `https://192.168.50.14:8443` and validate with the bundled private CA.
- Keep v0.1.2 immutable; publish the result as private prerelease v0.1.3.
- Do not add revocation UI, multiple-request history, QR codes, owner transfer, or automatic approval.
- Preserve the root checkout's unrelated branding assets and deleted document.

---

### Task 1: Owner-only public pairing status

**Files:**
- Modify: `server/src/auth/identity-types.ts`
- Modify: `server/src/auth/pairing.ts`
- Modify: `server/src/auth/identity.ts`
- Modify: `server/src/http/protocol-types.ts`
- Modify: `server/src/http/identity-routes.ts`
- Test: `server/test/pairing.test.ts`
- Test: `server/test/protocol-http.test.ts`

**Interfaces:**
- Consumes: existing `PairingRecord`, `requireOwner`, `authenticateRequest`, and `uuidPath`.
- Produces:

```ts
export type PublicPairingState =
  | 'available'
  | 'pending'
  | 'approved'
  | 'consumed'
  | 'expired';

export interface PublicPairingStatus {
  pairingId: string;
  state: PublicPairingState;
  expiresAt: string;
  requestedDevice?: { displayName: string; platform: string };
}

IdentityService.inspectPairing(
  ownerDeviceId: string,
  pairingId: string,
): Promise<PublicPairingStatus>;
```

- [ ] **Step 1: Write failing service tests**

Add literal assertions proving `available`, claimed `pending` with only public
device fields, `approved`, `consumed`, and `expired`. Assert the complete
returned object so adding `codeHash`, `claimHash`, `installationId`, or secrets
would fail the test. Add non-owner and malformed/unknown-ID rejection cases.

```ts
expect(await service.inspectPairing(owner.device.id, pairing.pairingId)).toEqual({
  pairingId: pairing.pairingId,
  state: 'pending',
  expiresAt: pairing.expiresAt,
  requestedDevice: { displayName: 'HP Gudang', platform: 'android' },
});
```

- [ ] **Step 2: Run the service tests and verify RED**

Run: `npm run server:test -- test/pairing.test.ts`

Expected: FAIL because `inspectPairing` does not exist.

- [ ] **Step 3: Implement the minimal projection**

Add `inspectPairing` to `pairing.ts`. Validate the UUID, require the active
owner inside the transaction, load the pairing, derive the state in this exact
precedence, and return only the public projection:

```ts
const state = pairing.consumedAt
  ? 'consumed'
  : pairing.approvedAt
    ? 'approved'
    : now.getTime() >= pairing.expiresAt.getTime()
      ? 'expired'
      : pairing.redeemedAt
        ? 'pending'
        : 'available';
```

Include `requestedDevice` only when both stored name and platform are present.
Expose the method through `IdentityService` and `ProtocolIdentityService`.

- [ ] **Step 4: Run the service tests and verify GREEN**

Run: `npm run server:test -- test/pairing.test.ts`

Expected: all pairing tests PASS.

- [ ] **Step 5: Write the failing HTTP contract test**

Register the mocked `inspectPairing` method and assert:

```ts
const response = await app.inject({
  method: 'GET',
  url: '/v1/pairings/33333333-3333-4333-8333-333333333333',
  headers: { authorization: `Bearer ${token}` },
});
expect(response.statusCode).toBe(200);
expect(response.json()).toEqual(publicStatus);
```

Also assert missing authentication and malformed UUID are rejected before the
service call.

- [ ] **Step 6: Run the HTTP test and verify RED**

Run: `npm run server:test -- test/protocol-http.test.ts`

Expected: FAIL with 404 because the GET route is absent.

- [ ] **Step 7: Register the owner-only GET route**

Add `GET /v1/pairings/:id` beside the existing pairing routes. Require an empty
query, authenticate, require owner, parse `uuidPath`, and return
`identity.inspectPairing(authenticated.device.id, id)`.

- [ ] **Step 8: Verify and commit the server slice**

Run:

```bash
npm run server:test -- test/pairing.test.ts test/protocol-http.test.ts
npm run server:typecheck
git diff --check
```

Expected: focused tests and typecheck PASS with no whitespace errors.

Commit:

```bash
git add server/src/auth/identity-types.ts server/src/auth/pairing.ts \
  server/src/auth/identity.ts server/src/http/protocol-types.ts \
  server/src/http/identity-routes.ts server/test/pairing.test.ts \
  server/test/protocol-http.test.ts
git commit -m "feat: expose owner pairing status"
```

### Task 2: Authenticated Electron owner-pairing service

**Files:**
- Create: `src/electron/core-owner-pairing-main.ts`
- Test: `tests/unit/electron-owner-pairing-main.test.ts`

**Interfaces:**
- Consumes: `CoreCredentialStore.getCurrentToken()` and the existing fixed-endpoint `send(request, authorization)` function.
- Produces:

```ts
export interface OwnerPairing {
  pairingId: string;
  code: string;
  expiresAt: string;
}

export interface OwnerPairingStatus {
  pairingId: string;
  state: 'available' | 'pending' | 'approved' | 'consumed' | 'expired';
  expiresAt: string;
  requestedDevice?: { displayName: string; platform: string };
}

createCoreOwnerPairingMain({ store, send }): {
  createOwnerPairing(): Promise<OwnerPairing>;
  getOwnerPairing(pairingId: string): Promise<OwnerPairingStatus>;
  approveOwnerPairing(pairingId: string): Promise<{ status: 'approved' }>;
};
```

- [ ] **Step 1: Write failing parser/request tests**

Test literal POST/GET/POST paths, `Bearer <token>` authorization, strict UUIDs,
strict eight-digit codes, ISO timestamps, every allowed state, optional public
device fields, and rejection of extra/private response keys. Assert that no
returned object contains the token.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- tests/unit/electron-owner-pairing-main.test.ts`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the narrow main-process service**

Use strict Zod schemas for all response bodies and a UUID schema for arguments.
For each call, read the current encrypted token and pass it only as the
authorization argument to `send`. Fixed requests are:

```ts
{ method: 'POST', path: '/v1/pairings' }
{ method: 'GET', path: `/v1/pairings/${pairingId}` }
{ method: 'POST', path: `/v1/pairings/${pairingId}/approve` }
```

Accept only HTTP 201 for create and 200 for inspect/approve. Throw
`Respons pemasangan CH Core tidak valid.` for malformed responses.

- [ ] **Step 4: Verify and commit the main-process service**

Run:

```bash
npm test -- tests/unit/electron-owner-pairing-main.test.ts
npm run typecheck
git diff --check
```

Expected: focused test and typecheck PASS.

Commit:

```bash
git add src/electron/core-owner-pairing-main.ts \
  tests/unit/electron-owner-pairing-main.test.ts
git commit -m "feat: add secure owner pairing client"
```

### Task 3: Fixed preload and IPC owner methods

**Files:**
- Modify: `src/electron/core-bridge-contract.ts`
- Modify: `src/electron/core-ipc.ts`
- Modify: `src/electron/core-desktop-service.ts`
- Test: `tests/unit/electron-preload-surface.test.ts`
- Test: `tests/unit/electron-desktop-service.test.ts`

**Interfaces:**
- Consumes: the three methods from `createCoreOwnerPairingMain`.
- Produces: the same three fixed methods on `ChCoreBridge` and channels
  `ch-core:create-owner-pairing`, `ch-core:get-owner-pairing`, and
  `ch-core:approve-owner-pairing`.

- [ ] **Step 1: Extend preload/IPC tests first**

Change the exact bridge-method assertion from seven to ten methods. Invoke all
three owner methods and assert their fixed channels and UUID-only argument.
Add IPC cases rejecting empty, malformed, or object pairing IDs before the
service is called, plus untrusted sender/frame cases for an owner channel.

- [ ] **Step 2: Run the preload tests and verify RED**

Run: `npm test -- tests/unit/electron-preload-surface.test.ts`

Expected: FAIL because the channels and methods do not exist.

- [ ] **Step 3: Add the bridge and IPC methods**

Add the three methods to `CH_CORE_IPC_CHANNELS`, `ChCoreBridge`, and
`createChCoreBridge`. Add a `requirePairingId` validator that accepts only a
UUID string. Register all three fixed handlers through the existing trusted
sender wrapper; cleanup continues to iterate `Object.values`.

- [ ] **Step 4: Run the preload tests and verify GREEN**

Run: `npm test -- tests/unit/electron-preload-surface.test.ts`

Expected: all preload/IPC tests PASS.

- [ ] **Step 5: Write failing desktop-service wiring tests**

Assert a configured paired service sends the exact owner requests through the
new methods and an unavailable configuration rejects each method. Keep the
complete service double aligned with the ten-method bridge.

- [ ] **Step 6: Run the desktop-service tests and verify RED**

Run: `npm test -- tests/unit/electron-desktop-service.test.ts`

Expected: FAIL because the service does not wire the owner client.

- [ ] **Step 7: Wire the owner service**

Construct `createCoreOwnerPairingMain({ store: options.store, send })` in
`createCoreDesktopService`, return its three methods, and add all three to the
unavailable service. Do not add owner pairing routes to the renderer's generic
`request` allowlist.

- [ ] **Step 8: Verify and commit the bridge slice**

Run:

```bash
npm test -- tests/unit/electron-preload-surface.test.ts \
  tests/unit/electron-desktop-service.test.ts
npm run typecheck
git diff --check
```

Expected: focused tests and typecheck PASS.

Commit:

```bash
git add src/electron/core-bridge-contract.ts src/electron/core-ipc.ts \
  src/electron/core-desktop-service.ts \
  tests/unit/electron-preload-surface.test.ts \
  tests/unit/electron-desktop-service.test.ts
git commit -m "feat: expose fixed owner pairing bridge"
```

### Task 4: Windows owner pairing card

**Files:**
- Create: `src/renderer/components/OwnerPairingCard.tsx`
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Modify: `src/renderer/styles.css` (append only scoped `.owner-pairing-*` rules)
- Test: `tests/unit/owner-pairing-card.test.tsx`
- Test: `tests/unit/settings-ui.test.tsx`

**Interfaces:**
- Consumes: `ChCoreBridge.createOwnerPairing`, `getOwnerPairing`, and `approveOwnerPairing`.
- Produces: `<OwnerPairingCard bridge={window.chCore} />` shown only when `coreBacked` and the bridge exists.

- [ ] **Step 1: Write failing card behavior tests**

Test the real component for these observable states:

```ts
fireEvent.click(screen.getByRole('button', { name: 'Buat kode pemasangan' }));
expect(await screen.findByText('12345678')).toBeVisible();
fireEvent.click(screen.getByRole('button', { name: 'Periksa permintaan' }));
expect(await screen.findByText('HP Gudang')).toBeVisible();
expect(screen.getByText('android')).toBeVisible();
fireEvent.click(screen.getByRole('button', { name: 'Setujui perangkat' }));
expect(await screen.findByText(/Periksa persetujuan/)).toBeVisible();
```

Use a complete bridge double but assert the rendered state and disabled/absent
approval button, not only mock call counts. Add available, expired, consumed,
non-owner, malformed-response, and busy-state cases.

- [ ] **Step 2: Run the card test and verify RED**

Run: `npm test -- tests/unit/owner-pairing-card.test.tsx`

Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement the minimal stateful card**

Keep only the current `OwnerPairing`/`OwnerPairingStatus`, busy flag, and public
message in component state. Show the code as eight text digits, format expiry in
WITA, allow status refresh, and render approval only for `pending` with a
requested device. Map rejected owner calls to
`Hanya perangkat pemilik yang dapat mengatur pemasangan.` and other failures to
`Pemasangan belum dapat diproses. Coba lagi.`

- [ ] **Step 4: Run the card test and verify GREEN**

Run: `npm test -- tests/unit/owner-pairing-card.test.tsx`

Expected: all card tests PASS.

- [ ] **Step 5: Write the failing Settings integration test**

Assert the owner card appears only for a CH Core-backed settings page with
`window.chCore`; the demo page retains the existing session-only content and no
pairing controls.

- [ ] **Step 6: Run the Settings test and verify RED**

Run: `npm test -- tests/unit/settings-ui.test.tsx`

Expected: FAIL because `SettingsPage` does not render the card.

- [ ] **Step 7: Integrate and style the card**

Add the card beside the existing data/application/security cards without
changing their behavior. Append only scoped responsive rules for the pairing
code, public device summary, actions, and status text.

- [ ] **Step 8: Verify and commit the renderer slice**

Run:

```bash
npm test -- tests/unit/owner-pairing-card.test.tsx \
  tests/unit/settings-ui.test.tsx
npm run typecheck
git diff --check
```

Expected: focused tests and typecheck PASS.

Commit:

```bash
git add src/renderer/components/OwnerPairingCard.tsx \
  src/renderer/pages/SettingsPage.tsx src/renderer/styles.css \
  tests/unit/owner-pairing-card.test.tsx tests/unit/settings-ui.test.tsx
git commit -m "feat: add Windows owner pairing controls"
```

### Task 5: v0.1.3 release contract and operator guidance

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `android/app/build.gradle`
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Modify: `.github/workflows/pilot-release.yml`
- Create: `docs/releases/pilot-0.1.3.md`
- Modify: `docs/ch-core-acceptance-status.md`
- Modify: `server/test/deployment-artifacts.test.ts`
- Modify: `server/test/runbooks.test.ts`
- Modify: relevant existing unit version assertions found by `rg -n "0\\.1\\.2|versionCode 3" tests server/test`

**Interfaces:**
- Produces: package/version `0.1.3`, Android `versionCode 4`, release tag `pilot-v0.1.3`, Windows filename `CH-Ultimate-0.1.3-Setup.exe`, Android filename `CHU-Companion-Mobile-0.1.3-pilot-debug.apk`.

- [ ] **Step 1: Write failing release-contract assertions**

Update literal version, tag, filename, settings-copy, and Android-code
expectations first. Add runbook assertions that the v0.1.3 guide requires
owner bootstrap, code generation, claimed-name/platform confirmation, explicit
approval, client completion, and one synchronized edit.

- [ ] **Step 2: Run focused release tests and verify RED**

Run:

```bash
npm test -- tests/unit/app-shell.test.tsx
npm run server:test -- test/deployment-artifacts.test.ts test/runbooks.test.ts
```

Expected: FAIL on the still-v0.1.2 source and absent release guide.

- [ ] **Step 3: Bump and document v0.1.3**

Run `npm version 0.1.3 --no-git-tag-version`, set Android version code/name to
`4`/`0.1.3`, update the Settings version, and update the workflow's exact tag
and filenames. The release guide must say that an existing v0.1.2 debug APK may
require uninstall before v0.1.3 because GitHub debug signers can differ; the
currently unpaired phone has no shared/offline data to preserve.

Update the acceptance ledger as implementation-ready only. Do not mark physical
pairing, synchronization, server upgrade, or production acceptance complete.

- [ ] **Step 4: Verify and commit the release contract**

Run:

```bash
npm test -- tests/unit/app-shell.test.tsx
npm run server:test -- test/deployment-artifacts.test.ts test/runbooks.test.ts
npm run typecheck
git diff --check
```

Expected: focused tests and typecheck PASS.

Commit:

```bash
git add package.json package-lock.json android/app/build.gradle \
  src/renderer/pages/SettingsPage.tsx .github/workflows/pilot-release.yml \
  docs/releases/pilot-0.1.3.md docs/ch-core-acceptance-status.md \
  server/test/deployment-artifacts.test.ts server/test/runbooks.test.ts tests
git commit -m "release: prepare owner pairing pilot v0.1.3"
```

### Task 6: Full local and CI verification

**Files:**
- Modify only files required to fix failures caused by Tasks 1-5.

**Interfaces:**
- Consumes: complete v0.1.3 source tree.
- Produces: verified Windows/Android/server release candidate with no private keys tracked.

- [ ] **Step 1: Run the full local gate**

Run:

```bash
npm run verify
npm run test:mobile
npm run mobile:build
npm run package
npm run test:e2e
npm run server:test
npm run server:typecheck
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="/Users/hamlet/Library/Android/sdk" \
ANDROID_SDK_ROOT="/Users/hamlet/Library/Android/sdk" npm run android:sync
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="/Users/hamlet/Library/Android/sdk" \
ANDROID_SDK_ROOT="/Users/hamlet/Library/Android/sdk" npm run android:test
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="/Users/hamlet/Library/Android/sdk" \
ANDROID_SDK_ROOT="/Users/hamlet/Library/Android/sdk" npm run android:lint
git diff --check
```

Expected: every command exits 0; the intentional real-workbook server test may
remain skipped.

- [ ] **Step 2: Inspect packaged boundaries**

Confirm the packaged Electron config and APK both embed exactly
`https://192.168.50.14:8443`, the public CA hash matches the source, no tracked
private key/credential exists, and the APK reports package
`com.tokoch.chucompanion`, version `0.1.3`, code `4`.

- [ ] **Step 3: Commit only a required verification fix**

If a gate revealed a feature-caused defect, write/verify a regression test and
commit only that fix as `fix: close owner pairing verification gap`. If no gate
fails, create no empty verification commit.

- [ ] **Step 4: Push and open a pull request**

Push `codex/owner-device-pairing`, open a PR against `main`, and wait for source,
Windows, and Android jobs. Merge only if every required job passes.

### Task 7: Deploy compatible Core and publish v0.1.3

**Files:**
- Modify: `docs/ch-core-acceptance-status.md` only after each live result exists.

**Interfaces:**
- Consumes: merged v0.1.3 commit, current NAS project, existing MariaDB schema, fixed HTTPS endpoint.
- Produces: compatible CH Core runtime and independently verified private prerelease artifacts.

- [ ] **Step 1: Pre-deployment read-only checks**

Verify `origin/main`, clean release source, CA-validated live/ready health,
current NAS address/MAC, raw 18080 and MariaDB 3306 isolation, Container Manager
project state, and available NAS resources. This route adds no migration; do
not alter MariaDB data.

- [ ] **Step 2: Save the current rollback identity and deploy the merged server**

Record the current container/image/project identity. Stage the exact merged
server artifact through the existing bounded private deployment location,
rebuild the ARM64 image, and replace only the CH Core container. Preserve the
existing `.env`, MariaDB socket mount, numeric service user, read-only root,
dropped capabilities, and resource limits.

- [ ] **Step 3: Verify the live server before client publication**

Prove CA-validated `/health/live` and `/health/ready`, raw-port/database
isolation, and an authenticated owner create/inspect/approve test using a
disposable request without enrolling an unintended device. If the runtime
fails, restore the recorded previous image; no schema rollback is required.

- [ ] **Step 4: Publish and independently verify the private prerelease**

Dispatch the merged GitHub workflow with publication enabled. Require every job
to pass and release `pilot-v0.1.3` to contain exactly:

- `CH-Ultimate-0.1.3-Setup.exe`;
- `CHU-Companion-Mobile-0.1.3-pilot-debug.apk`;
- `SHA256SUMS.txt`.

Download all three into a fresh temporary directory, run
`shasum -a 256 -c SHA256SUMS.txt`, identify the Windows PE installer, verify the
APK signature/package/version/code/endpoint, record exact sizes and SHA-256
digests, then move the temporary copies to Trash.

- [ ] **Step 5: Record evidence and hand off physical pairing**

Update the acceptance ledger with the merged commit, workflow run, release URL,
asset sizes/hashes, signer, live route result, and remaining physical gates.
Commit and push the receipt to `main` after focused runbook tests and
`git diff --check` pass.

Tell the user to install v0.1.3 on the first Windows laptop, bootstrap it as the
owner, generate a code, reinstall/update the currently unpaired Android pilot,
confirm the displayed device name/platform, approve it, select **Periksa
persetujuan** on Android, and perform one small synchronized edit. Do not mark
the physical pairing or production gates complete until those actions produce
direct evidence.
