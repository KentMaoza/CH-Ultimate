# Task 6 report: Cek Stok desktop and mobile UI

## Status

Complete and verified on `codex/ch-ultimate-v020`.

Assumptions kept intentionally narrow:

- Stock-check presentation and mutations use the existing `OperationsGateway`; no duplicate business state or direct Core transport was introduced.
- The mock gateway's `demo` phase is treated as locally available for package-barcode registration. Core-backed registration remains unavailable while offline, unpaired, revoked, or upgrade-blocked.
- Owner package-barcode controls use a dedicated `canManagePackageBarcodes` capability. Catalogue-staging permission is not used as a role proxy.
- No print, export, release, backend, database, or Android-native behavior was added.

## Implemented behavior

### Shared stock-check workflow

- Added one shared `StockCheckView` for desktop and mobile.
- Lists every active SKU, excluding archived SKU, ordered by never checked first, oldest physical `countedAt`, then numeric SKU number.
- Displays `Terakhir cek stok` from the physical count time in WITA. Audit detail separately displays physical `countedAt`, server `appliedAt`, observed stock, server-before stock, applied delta, forced-offline state, device, and note.
- Resolves exact normalized SKU numbers, legacy aliases, and all registered identifier kinds: primary, product code, alias, package barcode, and other.
- Requires a review before mutation and shows observed PCS, counted PCS, difference, and the trimmed optional note. The note input is capped at 512 characters. Unchanged counts remain valid.
- Detects a changed local observation before submission. A `STOCK_CHECK_STALE` Core rejection refreshes the snapshot and requires a fresh review and confirmation.
- Offline review shows an explicit warning that reconnect replay overwrites central stock with the absolute physical count. Forced audit entries show `DIPAKSA OFFLINE`.

### Desktop

- Added a first-class `Cek Stok` rail module directly after `SKU Gudang`.
- Added rapid keyboard-wedge handling terminated by Enter. Events from inputs, textareas, selects, buttons, and editable content are ignored so stock counting and other forms keep ownership of their keystrokes.
- Retained manual identifier entry.
- Added owner-only desktop package-barcode reassignment and removal with explicit review/confirmation. Client devices do not render these controls.

### Mobile

- Expanded the bottom navigation to exactly six items.
- Added the visual label `Stok` with accessible name, title, and focused page heading `Cek Stok`.
- Reuses the existing camera scanner port and retains manual entry after cancellation or camera failure.
- Shared responsive rules stack forms, review actions, and audit details at 360 px without horizontal document overflow.

### Unknown package barcode registration

- An unknown code can be staged only while the gateway is connected (or in the frontend demo).
- Registration requires selecting an active target SKU, advancing to a separate confirmation step, and typing the exact scanned code again.
- Registration is available to paired clients through the existing gateway mutation; removal and reassignment remain owner-only desktop actions.

## Files changed

- Shared domain/UI: `src/domain/stock-checks.ts`, `src/domain/mobile-demo-state.ts`, `src/renderer/stock-check/StockCheckView.tsx`, `src/renderer/stock-check/stock-check.css`.
- Desktop integration: `src/renderer/App.tsx`.
- Mobile integration: `mobile/MobileApp.tsx`, `mobile/components/Icons.tsx`, `mobile/styles.css`.
- Capability contract: `src/gateway/operations-gateway-contract.ts`, `src/gateway/core-operations-gateway.ts`, `src/gateway/mock-operations-gateway.ts`.
- Focused coverage: `tests/unit/stock-check-selectors.test.ts`, `tests/unit/stock-check-ui.test.tsx`, `tests/unit/stock-check-desktop.test.tsx`, `tests/unit/stock-check-mobile.test.tsx`.
- Existing contract/shell coverage updated: `tests/unit/app-shell.test.tsx`, `tests/unit/mobile-app.test.tsx`, `tests/unit/operations-sync-contract.test.ts`, `tests/unit/core-operations-gateway.test.ts`, `tests/unit/core-operations-gateway-mutations.test.ts`, `tests/e2e/app.spec.ts`.

## RED evidence

1. Selector/scanner coverage initially failed because the shared stock-check selector and every-identifier resolver did not exist.
2. Shared UI coverage initially failed because there was no stock-check workflow for sorting, audit details, confirmation, stale refresh, offline warning, or two-step registration.
3. Desktop coverage initially failed because the rail module and keyboard-wedge/owner-management surface did not exist.
4. The owner authorization regression failed until a dedicated `canManagePackageBarcodes` capability was added and derived from the authenticated owner role.
5. Mobile coverage produced five expected failures before implementation because the bottom navigation still had five items and no accessible `Cek Stok` page, camera flow, or manual fallback.

## GREEN evidence

- Focused selector/UI/desktop/mobile/scanner/accessibility/gateway matrix: 10 files, 88 tests passed.
- Full renderer suite: `npm test` passed, 80 files and 579 tests.
- Renderer/mobile typecheck: `npm run typecheck` passed.
- Mobile production build: `npm run mobile:build` passed.
- Local Electron package prerequisite: `npm run package` passed.
- Existing Electron E2E suite: `npm run test:e2e` passed, 8/8 tests.
- Live mobile browser check at a 360 x 800 viewport:
  - normal text: `clientWidth=360`, `scrollWidth=360`, six nav items;
  - 200 percent root text scale: `clientWidth=360`, `scrollWidth=360`, six nav items.
- `git diff --check` passed before report/commit.

The first E2E invocation timed out because this isolated worktree had no `.vite/build/main.js`; the suite launches that generated file directly. Running the repository-documented local package prerequisite produced the ignored build artifact, after which all eight E2E tests passed.

## Self-review

- Confirmed the SKU list does not filter out zero, negative, or untracked active rows; only archived rows are excluded.
- Confirmed audit ordering uses `appliedAt` only for newest-first presentation, while list priority and `Terakhir cek stok` use physical `countedAt`.
- Confirmed the scanner resolver is exact after whitespace/case normalization and does not perform partial identifier matches.
- Confirmed stale submission closes the existing review instead of silently resubmitting against refreshed stock.
- Confirmed offline confirmation describes absolute central overwrite before queueing and forced replay is visibly distinguishable in audit history.
- Confirmed management authorization is explicit, desktop-only, and independent of initial-catalogue staging.
- Confirmed generated package and mobile build artifacts remain ignored and are not included in the task diff.

## Remaining concerns

- No physical Android camera/device run was performed. Camera success/failure behavior is covered through the scanner port, the mobile bundle production-builds, and the responsive page was exercised in a headless browser.
- The full renderer suite still emits the previously recorded React `act(...)` warning from `nota-core-typing.test.tsx`; all 579 tests pass and Task 6 does not touch that Nota case.
- The mobile production build retains the previously recorded greater-than-500-kB chunk warning. Bundle splitting is outside this UI slice.

## Fix round 1

### Regressions closed

- Desktop keyboard-wedge buffering now ignores standalone modifier/control keys without clearing printable input. A true Shift keydown/keyup HID sequence resolves correctly, as do exact one- and two-character registered identifiers. Enter submits any non-empty trimmed buffer; form and editor isolation remains intact.
- A blank count is rejected before numeric conversion, so it cannot become an absolute zero count. Explicit `0` remains valid and fractional values remain rejected.
- A `STOCK_CHECK_STALE` response now blocks a new review until an authoritative refresh succeeds, the resulting sync phase is `online`, and the selected active SKU exists in the refreshed snapshot. Failed/offline refresh shows an explicit Indonesian error and exposes `Coba muat ulang stok`; only a later successful refresh clears the block.
- Owner package-barcode capability is cleared on normal authentication revocation, persisted/deferred authentication revocation, installation quarantine mismatch, and owner-to-client bootstrap. A Core-backed desktop regression proves the controls disappear when revoked; server authorization remains unchanged as defense in depth.
- Every mobile bottom-nav label now has a bounded wrapping element. The six-item nav grows vertically as needed at 200 percent text instead of allowing labels to overflow or clip horizontally.

### RED evidence

1. Wedge/count focused RED: 3 failures and 9 passes. The shifted HID sequence was reduced to an unknown partial code after `Shift`/`CapsLock` cleared the buffer, one- and two-character identifiers were rejected by the three-character floor, and blank count opened a zero-count confirmation.
2. Stale-refresh RED: the failed retry still rendered `Data terbaru dimuat` and left `Tinjau cek stok` enabled instead of producing the required refresh failure/block.
3. Capability RED: 2 failures and 32 passes. Both the deferred-401 gateway assertion and the integrated desktop UI still retained owner package-management access after `phase=revoked`.
4. Live mobile browser RED at 360 x 800 and 200 percent root text: the six-item nav measured `scrollWidth=364` with `clientWidth=360` before per-label containment was added.

### GREEN evidence

- Wedge and count UI matrix after the first fixes: 12/12 tests passed.
- Stale success/failure/later-retry matrix: 10/10 stock-check UI tests passed.
- Owner bootstrap/revocation/UI matrix: 34/34 tests passed.
- Live Playwright nav containment: 1/1 passed; nav, every button, and every visual label satisfy `scrollWidth <= clientWidth` at 360 x 800 and 200 percent root text.
- Final focused stock UI/gateway/mobile matrix: 9 files, 99/99 tests passed.
- Renderer/mobile typecheck: `npm run typecheck` passed.
- Full renderer suite: `npm test` passed, 80 files and 585 tests.
- Mobile production build: `npm run mobile:build` passed.
- Local Electron package prerequisite: `npm run package` passed.
- Full E2E suite: `npm run test:e2e` passed, 9/9 tests including the live mobile containment regression.

### Fix-round self-review and concerns

- Reconfirmation remains impossible after a stale refresh failure even if the count input is edited; choosing/scanning a different SKU resets the SKU-scoped block.
- Successful stale refresh preserves the operator's physical count while updating only the authoritative observed stock, so the difference is recalculated during the required new review.
- Capability changes are applied before revoked sync publication, allowing subscribed UI to rerender without a privileged intermediate frame.
- No print, export, server authorization, release, backend schema, or Android-native work was added.
- The existing Nota `act(...)` warning and mobile greater-than-500-kB chunk warning remain unchanged. Physical Android camera verification remains outside this local fix round.
