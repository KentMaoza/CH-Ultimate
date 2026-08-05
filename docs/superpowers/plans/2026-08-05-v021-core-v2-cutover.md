# CH Ultimate v0.2.1 and CH Core v2 Coordinated Cutover Implementation Plan

> **Execution:** Use the Superpowers subagent-driven-development workflow.
> Implement one task at a time, test-first, with a fresh read-only review after
> each implementation task and a final holistic review before publication.

**Goal:** Publish corrected Windows and Android v0.2.1 clients, then perform a
receipt-backed CH Core API v2 cutover and start a four-day copied-data LAN pilot.

**Architecture:** Preserve strict shared schema v2 and the `OperationsGateway`
boundary. Present synchronization from actual `SyncStatus.phase`, block business
screens on incompatibility, route Android Back through a narrow Capacitor port,
and package the logo through Vite. Publish clients before the guarded server
maintenance window.

**Stack:** TypeScript, React 19, Vitest/Testing Library, Electron Forge/Vite,
Capacitor 8, Playwright, Fastify/MariaDB, GitHub Actions.

## Global constraints and success criteria

- Work only in branch `codex/v021-core-v2-cutover` and its isolated worktree.
- Use RED-GREEN-REFACTOR for every behavior change. Never make a failing test
  pass by weakening the asserted contract.
- Keep Indonesian copy, WITA, integer rupiah, the monochrome visual system, and
  all renderer business access behind `OperationsGateway`.
- Treat `/Users/hamlet/Documents/CH Nota` as read-only.
- Preserve v0.2.0 release/tag/artifacts and the Android signer digest
  `57e0731ce3db068e6581980c53610764af05c612184ff50e18a9f4912ca59ba5`.
- Automated completion requires all local gates green. Deployment and pilot
  completion additionally require live receipts and physical-device evidence.
- External maintenance stops at the first unmeasured, mismatched, or failed
  gate. Do not bypass TLS, invent credentials, clear data, or improvise SQL.

## Task 1: Truthful sync presentation and bootstrap failure boundary

**Files:**
- Create: `src/gateway/sync-presentation.ts`
- Modify: `src/gateway/core-polling.ts`
- Modify: `src/gateway/core-operations-gateway.ts`
- Modify: `src/renderer/main.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/nota/NotaWorkspace.tsx`
- Modify: `mobile/main.tsx`
- Modify: `mobile/MobileApp.tsx`
- Modify: `mobile/components/DashboardView.tsx`
- Modify: `mobile/components/MobileNotaView.tsx`
- Modify: `mobile/components/MobileArchiveView.tsx`
- Test: `tests/unit/sync-presentation.test.ts`
- Test: `tests/unit/core-gateway-lifecycle.test.ts`
- Test: `tests/unit/core-app-rendering.test.tsx`
- Test: `tests/unit/mobile-core-rendering.test.tsx`
- Test: `tests/unit/app-shell.test.tsx`
- Test: `tests/unit/mobile-app.test.tsx`

### Slice 1A: Pure sync presentation mapping

1. Add focused tests that enumerate every `SyncPhase`; assert only `online`
   yields `Tersinkronisasi` and `upgrade-required` yields the exact Indonesian
   compatibility message.
2. Run `npx vitest run tests/unit/sync-presentation.test.ts` and capture RED.
3. Implement the smallest typed pure helper using the existing sync types.
4. Rerun the focused test and require GREEN before the next slice.

### Slice 1B: Strict bootstrap diagnostics

1. Extend the lifecycle test so a malformed bootstrap produces
   `upgrade-required`, exposes only the Indonesian message, and delivers the
   technical parser error to an injected diagnostic spy.
2. Run `npx vitest run tests/unit/core-gateway-lifecycle.test.ts` and capture RED.
3. Add an optional non-secret diagnostic sink to `CorePollingCoordinator` and
   thread it through the Core gateway factory. Production main entrypoints pass
   a console-backed sink; tests default to no-op.
4. Preserve strict parsing and the existing valid schema v2 path.
5. Run `npx vitest run tests/unit/core-gateway-lifecycle.test.ts tests/unit/core-api-types.test.ts tests/unit/core-operations-gateway-schema.test.ts`.

### Slice 1C: Block incompatible Core and replace false sync copy

1. Add desktop and mobile render tests for `connecting`, `offline`, and
   `upgrade-required`; assert no synchronized label outside `online` and no
   normal `0 SKU`/empty catalogue on `upgrade-required`.
2. Keep or add the valid-v2 regression that bootstraps with
   `apiSchemaVersion: 2` and `stockChecks: []`, reaches online, and renders the
   editable Nota fields/unit buttons.
3. Run the six listed UI test files and capture RED.
4. Subscribe App/MobileApp to sync state, render one blocking compatibility
   surface for `upgrade-required`, and pass derived presentation copy to the
   four affected components. Keep demo copy unchanged.
5. Run the six UI tests plus
   `tests/unit/nota-core-typing.test.tsx` and require GREEN.
6. Commit the task and create a task report; run a read-only spec/quality review.

## Task 2: Android Back navigation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `mobile/ports.ts`
- Modify: `mobile/native-adapters.ts`
- Modify: `mobile/main.tsx`
- Modify: `mobile/MobileApp.tsx`
- Test: `tests/unit/mobile-native-adapters.test.ts`
- Test: `tests/unit/mobile-app.test.tsx`

### Slice 2A: Native port contract

1. Add adapter tests proving one `backButton` listener is registered, its latest
   handler decides whether to navigate, and `exitApp()` runs only when the
   handler reports unhandled home state.
2. Run `npx vitest run tests/unit/mobile-native-adapters.test.ts` and capture RED.
3. Install the exact Capacitor App major compatible with Capacitor 8 using npm;
   add `AppBackButtonPort`, browser no-op, and native adapter.
4. Rerun the adapter test and require GREEN.

### Slice 2B: React navigation order

1. Add interaction tests for Back from notification prices, scanner, SKU detail,
   archived Nota edit, recommendations, export, each top-level screen, and home.
2. Run `npx vitest run tests/unit/mobile-app.test.tsx` and capture RED.
3. Implement a latest-handler ref and minimal origin state. Close detail/overlay
   before changing screens; return subordinate flows to their origin; return
   top-level screens to home; report home as unhandled.
4. Inject the browser default so existing preview/tests need no Capacitor runtime.
5. Run `npx vitest run tests/unit/mobile-app.test.tsx tests/unit/mobile-native-adapters.test.ts`.
6. Run `npm run android:sync` and ensure the App plugin is registered without
   changing the Android package ID or signer configuration.
7. Commit the task and create a task report; run a fresh read-only review.

## Task 3: Packaged Windows logo

**Files:**
- Create: `src/renderer/assets/ch-ultimate-mark.svg`
- Modify: `src/renderer/App.tsx`
- Modify: `tests/unit/app-shell.test.tsx`
- Modify: `tests/unit/electron-packaged-deployment.test.ts`
- Modify: `tests/e2e/app.spec.ts` or the existing packaged Electron smoke spec

1. Change unit/package contract tests to reject `/brand/ch-ultimate-mark.svg`
   and require a Vite-managed asset reference. Add an Electron assertion that
   the visible sidebar image is complete with `naturalWidth > 0`.
2. Run the focused unit/package/E2E test and capture RED at the smallest layer
   available before production change.
3. Copy the existing mark bytes into the source asset via `apply_patch`, import
   it from `App.tsx`, and use the emitted URL.
4. Run `npx vitest run tests/unit/app-shell.test.tsx tests/unit/branding-assets.test.ts tests/unit/electron-packaged-deployment.test.ts`.
5. Run `npm run package` followed by the targeted Electron Playwright spec and
   require GREEN.
6. Commit the task and create a task report; run a fresh read-only review.

## Task 4: v0.2.1 release contract

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `android/app/build.gradle`
- Modify: `scripts/copy-android-release.mjs`
- Modify: `.github/workflows/pilot-release.yml`
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Modify: `tests/unit/github-pilot-release.test.ts`
- Modify: `tests/unit/settings-ui.test.tsx`
- Create: `docs/releases/pilot-0.2.1.md`
- Create: `docs/releases/pilot-0.2.1-evidence.md`
- Modify: `docs/ch-core-v0.2-maintenance-rollback.md`

1. Change release contract tests first to require version `0.2.1`, Android
   `versionCode 8`, tag `pilot-v0.2.1`, exact v0.2.1 Windows/APK filenames,
   v0.2.1 notes, and unchanged permanent signer digest. Capture RED.
2. Update metadata and release workflow surgically. Do not modify dependency
   versions except the added official App plugin from Task 2.
3. Write release notes describing the six fixes, Core v2 prerequisite, update
   order, old-client fail-closed behavior, and copied-data pilot boundary.
4. Write evidence fields for automated gates and physical acceptance. Add a
   v0.2.1 supplement to the maintenance runbook without rewriting its guarded
   backup/rollback rules.
5. Run `npx vitest run tests/unit/github-pilot-release.test.ts tests/unit/settings-ui.test.tsx tests/unit/pilot-deployment-assets.test.ts`.
6. Run `git diff --check` and commit; create a task report and obtain a fresh
   read-only review.

## Task 5: Full verification, review, merge, and GitHub publication

**Verification commands:**

1. `npm run verify`
2. `npm run test:mobile`
3. `npm run mobile:build`
4. `npm run server:test`
5. `npm run server:typecheck`
6. `npm run server:test:integration` with its documented isolated database
   environment; if required credentials are unavailable, record this as a
   distinct environment gate and do not mislabel it as passed.
7. `npm run android:sync`
8. `npm run android:test`
9. `npm run android:lint`
10. `npm run package`
11. `npm run test:e2e`
12. `git diff --check` and repository private-key hygiene check.

After all locally available gates pass:

1. Generate the subagent-driven-development task index and obtain a holistic
   final review over the merge base through branch HEAD.
2. Address every High/Medium issue test-first and rerun the affected full gate.
3. Merge the reviewed branch into `main` without rewriting history, push
   `main`, and dispatch `.github/workflows/pilot-release.yml` with
   `publish=true`.
4. Wait for the source, Windows, Android, and publish jobs to finish. Do not
   publish manually around a failed workflow.
5. Download `CH-Ultimate-0.2.1-Setup.exe`,
   `CHU-Companion-Mobile-0.2.1-release.apk`, and `SHA256SUMS.txt` from the new
   GitHub prerelease into a fresh temporary directory.
6. Verify both SHA-256 values against the manifest, inspect Windows product
   version/name, inspect Android versionName/versionCode/package ID, and verify
   the APK certificate digest equals the pinned digest.
7. Record GitHub release URL, workflow run, commit, asset sizes, checksums,
   metadata, and signer result in the v0.2.1 evidence document. Commit and push
   evidence only if it contains no secret or local credential path.

## Task 6: Guarded CH Core v2 preflight and deployment

**Authority:** Follow `docs/ch-core-v0.2-maintenance-rollback.md` exactly. The
user approved the recommended cutover, but every operational gate still needs
measured evidence.

1. Identify the exact currently deployed Core artifact/image/commit and the
   reviewed v2 artifact checksum. Prove the expected migration set includes
   `010_stock_checks.sql`.
2. Notify the operator, quiesce all client writes, enumerate known client
   versions, capture outbox counts per client, and verify no active write
   request. Leave service readable until backup capture requires otherwise.
3. Run CA-validated `/health/live` and `/health/ready`; capture status, sanitized
   body, leaf fingerprint, and WITA time. Never use `-k`.
4. With approved read-only access, capture exact count for every runbook table,
   current `schema_migrations`, and repository migration checksums.
5. Create a new timestamped logical backup bundle using the repository opt-in
   operation. Verify `COMPLETE`, structure, and `dump.sql` SHA-256.
6. Copy the complete bundle to an approved independent target and verify the
   destination SHA-256 equals the NAS source.
7. Create a clean scratch schema with scratch-only credentials, restore the
   bundle, run the exact old artifact against it, and compare all table counts,
   business invariants, cursors, and image references. Destroying scratch data
   is a separate cleanup action after evidence is retained.
8. If every preflight receipt is PASS, deploy the exact reviewed Core v2
   artifact once and allow its migration advisory lock to apply migration 010.
9. Verify health again, exact migration rows/checksums, authenticated bootstrap
   marker 2 plus `stockChecks`, and old-client fail-closed behavior without a
   write attempt.
10. Install verified v0.2.1 clients and perform bounded idempotent test reads and
    writes. Record pre/post revision, audit ID, and counts; do not replay an
    uncontrolled old outbox.
11. If failure occurs before any v2 write/replay, choose rollback only with the
    runbook evidence. After any v2 write/replay, quiesce and forward-fix.
12. Store a sanitized maintenance receipt; never commit credentials, tokens,
    private keys, raw dumps, or business snapshot contents.

## Task 7: Physical acceptance and four-day pilot start

1. On the connected Samsung, verify package ID, versionName 0.2.1, versionCode 8,
   and unchanged signer before in-place installation. Do not uninstall or clear
   application data.
2. On Windows, install the verified v0.2.1 installer and verify the product
   version plus sidebar logo under the installed `file://` renderer.
3. Pair/connect both devices to Core v2 and prove a valid bootstrap shows five
   actual Core SKU rather than zero; record sync phase and revision.
4. Verify desktop Nama Barang, Jenis, PCS, and LSN editing; verify no false
   synchronized copy during a controlled offline/reconnect transition.
5. Verify Android Back from Notifikasi Harga, scanner, SKU detail, archive edit,
   recommendations, and export; confirm only Beranda exits.
6. Verify bidirectional image display, one stock-check scan/update with timestamp,
   Windows print dialog/logo, PDF, mobile share, and XLSX export. Label every
   environment-dependent gate truthfully.
7. When physical acceptance passes, record Day 1 WITA and begin four consecutive
   copied-data LAN pilot days. Each daily receipt records sync/reconnect, outbox,
   Nota, image, stock-check, print/export, restart, and error observations.
8. Do not declare the pilot complete until Day 4 has a recorded disposition and
   unresolved incidents are either closed or explicitly block rollout.
