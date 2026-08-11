# Restock Recommendations Implementation Plan

> **Execution:** Use `superpowers:executing-plans`. Work directly on updated `main` as required by `AGENTS.md`; do not create a new branch/worktree. Keep acceptance-only files untracked and preserve all pre-existing dirty worktrees.

**Goal:** Deliver a production-ready desktop `Rekomendasi Restock` workflow derived from synchronized Core history, with deterministic ranking, safe report selection, and a restricted portrait A4 PDF.

**Architecture:** Add pure domain sales/recommendation selectors over `DemoState`, integrate their output into the existing `Barang Kosong` page, and add a dedicated output document kind for the special A4 layout. Do not add Core schema/API/database changes and do not mutate stock from the report workflow.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, Playwright Electron, Electron Forge, Capacitor Android, CH Core/NAS health verification, Windows UI Automation.

**Design:** `docs/superpowers/specs/2026-08-11-restock-recommendations-design.md`

## Global Gates

- Test-first: every behavior slice begins with a focused failing test.
- WITA boundaries and Nota lifecycle corrections are business invariants.
- One functional/data/sync/native-input/PDF-layout failure blocks release.
- CDP/JavaScript may only read/assert installed-app state; native Windows input performs interactions.
- Use only `ACCEPTANCE TEST ONLY` data for physical verification; never delete or rewrite audit history.
- No stock mutation is allowed from `Barang Kosong` recommendation/report controls.

---

### Task 1: Lifecycle-Aware SKU Sales Timeline

**Files:**
- Create: `src/domain/sku-sales-history.ts`
- Create: `tests/unit/sku-sales-history.test.ts`

- [ ] Write failing tests for `complete`, `recomplete`, cancel/reversal, restore, missing posting fallback, future exclusion, and exact WITA `D-29`/`D-59` boundaries.
- [ ] Run `npm test -- tests/unit/sku-sales-history.test.ts` and confirm failure for the missing helper.
- [ ] Implement the smallest pure selector returning lifetime net pieces, 30/60-day net pieces, and latest effective sale date per SKU.
- [ ] Re-run the focused test and `npm run typecheck`.

### Task 2: Deterministic Restock Report

**Files:**
- Create: `src/domain/restock-recommendations.ts`
- Create: `tests/unit/restock-recommendations.test.ts`

- [ ] Write failing tests for ever-stocked proof from balance/adjustment/stock-check, ever-sold proof, active/tracked/archive filtering, candidate union, top-third cutoff ties, deduplication, ranking bands, supplier grouping, and quantities.
- [ ] Run the focused test and confirm behavioral failures.
- [ ] Implement the pure report builder exactly as specified, including stable tie handling and supplier-independent colors.
- [ ] Re-run Tasks 1–2 tests plus typecheck.

### Task 3: Dedicated Portrait A4 Output Contract

**Files:**
- Modify: `src/domain/output-documents.ts`
- Create: `src/domain/restock-recommendation-document.ts`
- Modify: `src/electron/output-contract.ts`
- Modify: `src/electron/output-ipc.ts`
- Modify: `src/renderer/output/PrintDocumentHost.tsx`
- Modify: `src/renderer/styles.css`
- Create: `src/renderer/restock-recommendation-images.ts`
- Create: `tests/unit/restock-recommendation-document.test.ts`
- Modify: `tests/unit/print-document-host.test.tsx`
- Modify: `tests/unit/electron-output.test.ts`

- [ ] Write failing tests proving the new kind is accepted, dimensions are `210 × 297`, supplier groups paginate, and product cards expose only image/name/quantity data.
- [ ] Add a dedicated plan, image hydration with CHU fallback, IPC allowlist entry, host layout, and print CSS.
- [ ] Assert every card/image/copy stays within page bounds and no stock, sales, price, or SKU-number field appears in the PDF host.
- [ ] Re-run the focused document/IPC tests plus typecheck.

### Task 4: Barang Kosong UI Integration

**Files:**
- Modify: `src/renderer/pages/EmptyStockPage.tsx`
- Modify: `src/renderer/pages/empty-stock-utils.ts`
- Modify: `src/renderer/styles.css`
- Modify: `tests/unit/empty-stock-filters.test.ts`
- Modify: `tests/unit/reports-ui.test.tsx`

- [ ] Write failing UI tests for recommendation grouping/badges/reasons, supplier/search filtering, add-one, add-all-filtered, suggested/manual quantities, selected top sellers above stock `2`, and `Keluarkan dari laporan`.
- [ ] Assert the gateway stock snapshot is byte-for-byte unchanged after every report action.
- [ ] Implement shared report selection over active SKU, preserving existing low-stock list behavior and session-only overrides.
- [ ] Add `Simpan PDF Rekomendasi`, hydrate images, and surface saved/cancelled/failed statuses.
- [ ] Re-run the focused Empty Stock tests plus Tasks 1–3 tests and typecheck.

### Task 5: Automated Regression and Packaging

**Files:**
- Modify: `tests/e2e/app.spec.ts`
- Modify only other files exposed by a regression.

- [ ] Add an Electron E2E happy path using UI controls for recommendation filter, add/remove, quantity correction, restricted PDF host, and unchanged stock.
- [ ] Run `npm run verify`.
- [ ] Run `npm run test:e2e`.
- [ ] Run `npm run server:typecheck`, `npm run server:test`, and the available MariaDB integration gate.
- [ ] Run `npm run android:test`, `npm run android:lint`, and `npm run android:release` to prove the shared release remains healthy.
- [ ] Run `npm run package` and `npm run make:windows`; inspect packaged assets and `git diff --check`.

### Task 6: Exact Candidate Commit and CI

**Files:**
- Modify version/release metadata only after Tasks 1–5 pass.
- Add release evidence under `docs/releases/`.

- [ ] Set the next patch version (`0.2.6`) consistently across desktop/mobile packaging metadata without changing Core schema version.
- [ ] Commit implementation in reviewable slices, run a final diff review, and push exact `main`.
- [ ] Require GitHub CI green for the exact candidate commit and download artifacts for hash verification.
- [ ] Do not publish a final release before installed-device acceptance.

### Task 7: Installed Windows, Android, and NAS Acceptance

**Windows installed app:**

- [ ] Install the exact GitHub candidate on Windows and verify version/hash/startup/Core sync.
- [ ] Use native Windows mouse/keyboard/UI Automation to exercise supplier/search filters, add-one/add-all, quantity Backspace/correction, remove-from-report, and app restart.
- [ ] Read/assert that colors/reasons/quantities match the domain fixture and real synchronized history.
- [ ] Prove warehouse stock did not change.
- [ ] Save a real recommendation PDF, verify portrait A4, supplier grouping, image/name/quantity-only content, no clipping/blank pages, and valid file bytes.
- [ ] Regression-smoke Barang Kosong, Stok Menipis, export, native print/PDF, and Nota.

**Android and Core/NAS:**

- [ ] Install the matching candidate APK and smoke pairing, truthful sync, catalogue/images, Nota, stock check, offline/reconnect, and restart persistence.
- [ ] Verify CH Core `/health/live` and `/health/ready` return authenticated/CA-valid HTTP 200 and raw database/Core ports remain closed.
- [ ] Reconfirm backup/restore receipts only when NAS access is available; do not claim fresh receipt evidence from health checks alone.

### Task 8: Public Release and Clean-Download Smoke

- [ ] Publish the exact accepted commit as a GitHub prerelease with Windows installer, Android APK, and `SHA256SUMS.txt`.
- [ ] Download public assets fresh, verify hashes/version, clean-install them, and repeat critical Windows/Android smoke checks.
- [ ] Record explicit physical evidence and remaining operational limitations in the release evidence document.
- [ ] Mark the active goal complete only after all required gates are proven and no blocker remains.
