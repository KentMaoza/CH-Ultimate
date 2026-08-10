# Live Catalogue Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import all 3,172 approved workbook rows into the live NAS catalogue while preserving existing SKU identities, Nota history, price history, and stock history, and recording any matched-SKU stock change as an auditable reconciliation movement.

**Architecture:** Extend the pure identity reconciliation model with locked balance snapshots and untouched-SKU reporting. Keep the existing owner-only staged import and business-write transaction, but replace the blanket live-history rejection and balance upsert with non-destructive writes: new SKUs receive a baseline balance, matched SKUs receive a versioned `catalogue_reconciliation` movement only when their workbook quantity differs, and unmatched stored SKUs remain untouched.

**Tech Stack:** TypeScript 5, Node.js 24, MariaDB 10, Vitest, Fastify, ExcelJS, Docker Compose on Synology DSM.

## Global Constraints

- Preserve every existing SKU identity, Nota reference, stock movement, stock check, price-history record, and audit event.
- The approved workbook SHA-256 remains `f18d41b93197a59be3b3b93c5b68ce841716f9eb91b5f0912a81c50470b07d78` and the XLSX bytes remain outside Git.
- No `DELETE`, `TRUNCATE`, production-database drop, or automatic SKU archive may be introduced.
- Existing identifiers remain attached to their SKU; conflicting cross-SKU identities fail the entire transaction with HTTP 409.
- A matched balance changes only through one version increment, one `catalogue_reconciliation` movement, audit evidence, and change-log evidence; a zero delta changes none of those stock records.
- The staged import remains owner-only, transactional, hash-pinned, and idempotent.
- UI and user-facing error copy remain Indonesian; internal diagnostics may stay English.

---

### Task 1: Model Non-Destructive Identity Reconciliation

**Files:**
- Modify: `server/src/catalogue/catalogue-writer.ts`
- Modify: `server/src/catalogue/catalogue-reconciliation.ts`
- Test: `server/test/catalogue-reconciliation.test.ts`

**Interfaces:**
- Consumes: `CatalogueRow`, `ExistingCatalogueRow`, UUID supplier `() => string`.
- Produces: `PreparedCatalogueRow.existingSku.quantityPcs: string`, `PreparedCatalogueRow.stockMovementId: string`, and `CatalogueReconciliation.untouchedExistingCount: number`.

- [ ] **Step 1: Write failing reconciliation tests**

Add literal balance values to the `existing(...)` fixture and tests equivalent to:

```ts
it('retains extra identifiers and unmatched active SKUs', () => {
  const result = reconcileCatalogue(
    [source()],
    [
      existing(skuA, identifierA, 'SKU-A', false, '7'),
      existing(skuA, identifierB, 'LEGACY-A', false, '7'),
      existing(skuB, '66666666-6666-4666-8666-666666666666', 'SKU-B', false, '3'),
    ],
    uuidSequence(),
  );
  expect(result).toMatchObject({
    matchedExistingCount: 1,
    createdSkuCount: 0,
    untouchedExistingCount: 1,
  });
  expect(result.rows[0]?.existingSku).toMatchObject({ quantityPcs: '7' });
});
```

Keep the two conflict tests proving that identifiers pointing to different SKUs and two workbook rows resolving to one SKU still throw `CATALOGUE_IDENTITY_CONFLICT`.

Add a matched-row fixture with `quantity_pcs: null` and `balance_row_version: null`; assert that reconciliation throws an internal invalid-balance error before returning prepared rows.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm --workspace @ch-ultimate/core test -- --run test/catalogue-reconciliation.test.ts
```

Expected: FAIL because `quantity_pcs`, `stockMovementId`, and `untouchedExistingCount` are not modeled and unmatched/extra identifiers are still rejected.

- [ ] **Step 3: Implement the minimal pure reconciliation change**

Update `ExistingCatalogueRow` and the hydrated SKU snapshot to read `quantity_pcs`. Preserve the entire identifier map. When a workbook row matches an existing SKU, require both a positive balance row version and an integer quantity; fail before writes if either is absent or malformed. Remove `UNEXPECTED_EXISTING_IDENTIFIERS` and `UNMATCHED_EXISTING_SKUS` branches. Generate one `stockMovementId` per prepared row, pass the existing quantity into `existingSku`, and return:

```ts
return {
  rows,
  matchedExistingCount: assignedExisting.size,
  createdSkuCount: rows.length - assignedExisting.size,
  untouchedExistingCount: [...existingSkus.values()].filter(
    (sku) => !assignedExisting.has(sku.id),
  ).length,
};
```

- [ ] **Step 4: Run the focused reconciliation tests**

Run:

```bash
npm --workspace @ch-ultimate/core test -- --run test/catalogue-reconciliation.test.ts
```

Expected: reconciliation tests PASS. Repository fixtures are updated in Task 2 before the next full typecheck.

- [ ] **Step 5: Commit the pure model slice**

```bash
git add server/src/catalogue/catalogue-writer.ts server/src/catalogue/catalogue-reconciliation.ts server/test/catalogue-reconciliation.test.ts
git commit -m "feat: preserve live catalogue identities during reconciliation"
```

---

### Task 2: Write Audited Stock Reconciliation Atomically

**Files:**
- Modify: `server/src/catalogue/catalogue-writer.ts`
- Modify: `server/src/catalogue/mariadb-repository.ts`
- Test: `server/test/catalogue-repository.test.ts`

**Interfaces:**
- Consumes: Task 1 `PreparedCatalogueRow` with existing quantity, balance version, and movement UUID.
- Produces: `CatalogueWriteSummary { stockAdjustedCount: number; zeroDeltaMatchedCount: number }` returned by `insertCatalogue(...)`.

- [ ] **Step 1: Write failing repository tests for live history and stock deltas**

Update the harness rows to include `quantity_pcs`. Replace the old `LIVE_TRANSACTIONS_EXIST` expectations with tests that assert:

```ts
expect(queries.some(({ sql }) => sql.includes('AS has_live_transactions'))).toBe(false);
expect(queries.some(({ sql }) => sql.startsWith('DELETE FROM'))).toBe(false);
```

For a matched row with current quantity `7` and workbook quantity `12`, assert one balance update with `12`, one movement containing delta `5`, reason `catalogue_reconciliation`, import ID as `operation_id`, one stock audit, and stock balance/movement change-log payloads. For current quantity `12`, assert no balance update and no stock movement. For a new row, assert one balance insert with quantity `12` and no reconciliation movement.

- [ ] **Step 2: Run the repository test and verify RED**

Run:

```bash
npm --workspace @ch-ultimate/core test -- --run test/catalogue-repository.test.ts
```

Expected: FAIL because the repository still rejects live activity and the writer still performs `ON DUPLICATE KEY UPDATE` without a movement.

- [ ] **Step 3: Query locked quantities and remove the broad live-history gate**

Delete only the `has_live_transactions` query and error branch from `MariaDbCatalogueRepository.commit`. Extend the existing locked catalogue query with:

```sql
sb.quantity_pcs
```

Keep the business-write lock, import-row lock, replay branch, and full transaction unchanged.

- [ ] **Step 4: Implement baseline versus matched stock writes**

Change `insertCatalogue` to return `CatalogueWriteSummary`. Insert `stock_balances` only for new rows. For each matched row, compute BigInt before/after/delta. If zero, increment `zeroDeltaMatchedCount` and make no stock write. Otherwise:

```sql
UPDATE stock_balances
SET quantity_pcs = ?, row_version = row_version + 1, updated_at = ?
WHERE sku_id = UNHEX(REPLACE(?, '-', ''))
```

Then insert exactly one movement:

```sql
INSERT INTO stock_movements
  (id, sku_id, delta_pcs, reason, device_id, operation_id,
   balance_row_version_after, created_at)
VALUES
  (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?,
   'catalogue_reconciliation', UNHEX(REPLACE(?, '-', '')),
   UNHEX(REPLACE(?, '-', '')), ?, ?)
```

Use `record.createdByDeviceId` as device, `record.id` as operation, and the prepared movement UUID as movement ID. Add `catalogue.stock_reconciled` audit detail with before, after, delta, import ID, and workbook SHA. Emit stock-balance and stock-movement change-log payloads only for new baselines or non-zero matched deltas.

- [ ] **Step 5: Audit the reconciliation summary**

Capture `const writeSummary = await insertCatalogue(...)` and include `stockAdjustedCount`, `zeroDeltaMatchedCount`, and `untouchedExistingCount` in the `catalogue.import_committed` audit detail. Task 3 adds the same counters to the public persisted result after extending its contract.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npm --workspace @ch-ultimate/core test -- --run test/catalogue-repository.test.ts test/catalogue-reconciliation.test.ts
npm --workspace @ch-ultimate/core run typecheck
```

Expected: all focused tests and typecheck PASS; no `LIVE_TRANSACTIONS_EXIST`, balance-upsert, or destructive write remains in the commit path.

- [ ] **Step 7: Commit the database-write slice**

```bash
git add server/src/catalogue/catalogue-writer.ts server/src/catalogue/mariadb-repository.ts server/test/catalogue-repository.test.ts
git commit -m "feat: reconcile imported stock with audited movements"
```

---

### Task 3: Persist and Return Reconciliation Evidence

**Files:**
- Modify: `server/src/catalogue/service.ts`
- Modify: `server/src/catalogue/catalogue-import-store.ts`
- Modify: `server/src/catalogue/mariadb-repository.ts`
- Create: `server/test/catalogue-import-store.test.ts`
- Modify: `server/test/catalogue-service.test.ts`
- Modify: `server/test/catalogue-http.test.ts`
- Modify: `tests/unit/core-operations-gateway-mutations.test.ts`

**Interfaces:**
- Consumes: Task 2 write summary and Task 1 identity summary.
- Produces: `CatalogueCommitResult` with `matchedExistingCount`, `createdSkuCount`, `untouchedExistingCount`, `stockAdjustedCount`, and `zeroDeltaMatchedCount` as non-negative safe integers.

- [ ] **Step 1: Write failing result-parser and boundary tests**

Add a parser test using a literal JSON object with all five new counters and assert exact round-trip parsing. Add malformed cases for a negative, fractional, or missing counter. Update service, HTTP, and renderer gateway fixtures to include:

```ts
matchedExistingCount: 1,
createdSkuCount: 3171,
untouchedExistingCount: 4,
stockAdjustedCount: 1,
zeroDeltaMatchedCount: 0,
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm --workspace @ch-ultimate/core test -- --run test/catalogue-import-store.test.ts test/catalogue-service.test.ts test/catalogue-http.test.ts
npm test -- --run tests/unit/core-operations-gateway-mutations.test.ts
```

Expected: FAIL because the result interface and parser omit the counters.

- [ ] **Step 3: Extend the result contract and strict parser**

Add the five numeric properties to `CatalogueCommitResult`. In `parseCatalogueCommitResult`, validate each with:

```ts
function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
```

Return all five values unchanged. The verified live receipt has `TABLE_COUNT=imports|0`, so no legacy committed result needs an ambiguous compatibility default.

Add the same five counters to the repository's committed `result_json` object using the identity reconciliation and writer summaries produced by Tasks 1-2.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the commands from Step 2 plus:

```bash
npm run typecheck
npm --workspace @ch-ultimate/core run typecheck
```

Expected: all result, HTTP, service, renderer, and type checks PASS.

- [ ] **Step 5: Commit the result-contract slice**

```bash
git add server/src/catalogue/service.ts server/src/catalogue/catalogue-import-store.ts server/test/catalogue-import-store.test.ts server/test/catalogue-service.test.ts server/test/catalogue-http.test.ts tests/unit/core-operations-gateway-mutations.test.ts
git commit -m "feat: report live catalogue reconciliation evidence"
```

---

### Task 4: Prove Transactional Preservation and Workbook Acceptance

**Files:**
- Create: `server/test/catalogue-live-reconciliation.integration.test.ts`
- Modify: `server/test/catalogue-real.acceptance.test.ts`
- Modify: `docs/releases/pilot-0.2.4.md`

**Interfaces:**
- Consumes: production repository, migration 10 schema, approved workbook SHA.
- Produces: isolated MariaDB evidence that Nota/history survive reconciliation and real-workbook evidence that all rows remain accepted.

- [ ] **Step 1: Write the isolated MariaDB integration test**

Against the guarded `/chu_test` database, create an owner device, one matched SKU with extra legacy identifier, a balance of `7`, one Nota snapshot, one manual price-history row, one stock movement, and one unmatched active SKU. Stage a two-row workbook model and call the real `MariaDbCatalogueRepository.commit`.

Assert literal postconditions:

```ts
expect(result).toMatchObject({
  matchedExistingCount: 1,
  createdSkuCount: 1,
  untouchedExistingCount: 1,
  stockAdjustedCount: 1,
  zeroDeltaMatchedCount: 0,
});
expect(rows[0]).toMatchObject({
  matched_quantity: 12n,
  reconciliation_movements: 1n,
  nota_count: 1n,
  manual_price_count: 1n,
  original_movement_count: 1n,
  unmatched_active_count: 1n,
});
```

Call commit again and prove every count is unchanged while `replayed: true`.

- [ ] **Step 2: Run the integration test and verify RED then GREEN**

Create/use only an explicitly isolated `chu_test` schema and account. Run:

```bash
CH_CORE_TEST_DATABASE_URL="$CH_CORE_V024_TEST_DATABASE_URL" \
  npm --workspace @ch-ultimate/core run test:integration -- \
  --run test/catalogue-live-reconciliation.integration.test.ts
```

Expected before implementation: FAIL on the live-history gate. Expected after Tasks 1-3: PASS. Never point this command at `/chu` or `/chu_restore_v024`.

- [ ] **Step 3: Keep the real-workbook acceptance exact**

Confirm `catalogue-real.acceptance.test.ts` pins the approved filename, SHA, 3,172 rows, 6,344 identifiers, 2,788 image jobs, 384 missing images, selected-price total `277389272`, and stock total `4411`. Add only missing literal assertions.

Run:

```bash
CH_CORE_CATALOGUE_ACCEPTANCE=1 \
CH_CORE_CATALOGUE_XLSX='/Users/hamlet/Downloads/SKU_Gudang20260808075120732.xlsx' \
npm --workspace @ch-ultimate/core test -- --run test/catalogue-real.acceptance.test.ts
```

Expected: one acceptance test PASS.

- [ ] **Step 4: Update release documentation with live-preservation semantics**

Document that v0.2.4 imports the workbook through audited reconciliation, keeps unmatched legacy SKUs, preserves Nota/history, and records non-zero matched-stock differences as `catalogue_reconciliation` movements.

- [ ] **Step 5: Run the complete verification suite**

Run:

```bash
npm run verify
npm run server:test
npm run server:typecheck
npm run server:build
npm run mobile:build
```

Expected: every command exits 0. Record integration, real-workbook, Windows, Android, and NAS checks separately; do not use unit tests to claim physical-device or deployment success.

- [ ] **Step 6: Commit the acceptance slice**

```bash
git add server/test/catalogue-live-reconciliation.integration.test.ts server/test/catalogue-real.acceptance.test.ts docs/releases/pilot-0.2.4.md
git commit -m "test: prove live catalogue history preservation"
```

---

### Task 5: Cut Over, Commit the Workbook Once, and Verify Production

**Files:**
- No planned source modification; any newly discovered cutover defect returns to a failing test before editing `scripts/ch-core-v024-nas-cutover.sh`.
- Produce outside Git: staged source archive, backup receipt, deploy receipt, import receipt, Windows installer, Android APK, soak log.

**Interfaces:**
- Consumes: final Git commit, exact source archive SHA, existing CA, root-only DSM tasks, owner-authenticated import API.
- Produces: deployed schema 10/API schema 2, committed workbook SHA, verified retained history, release artifacts, and GitHub v0.2.4 release.

- [ ] **Step 1: Build and pin the final source and installers**

Create a new exact-commit archive and rebuild the Windows installer and Android APK from that same final commit. Record full commit, source SHA, installer SHA, APK SHA, APK signature, and Windows Authenticode boundary.

- [ ] **Step 2: Refresh the one-backup cutover evidence**

Clean only the prior temporary `chu_backup_v024`, `chu_restore_v024`, and scratch schema after proving their exact count. Run final `prepare` and `backup-restore`; require `BACKUP_VERIFIED=YES`, `SCRATCH_RESTORE=PASS`, `CANONICAL_MATCH=YES`, and unchanged predeploy business counts. Stop on any mismatch.

- [ ] **Step 3: Deploy and validate the strict bootstrap**

Run final `deploy`. Require CA-validated `/health/live` and `/health/ready` HTTP 200, migration count 10, `apiSchemaVersion: 2`, and `stockChecks: []` or valid stock-check rows in the authenticated bootstrap. Invalid bootstrap must never show synchronized/zero-data UI states.

- [ ] **Step 4: Stage and commit the workbook once as owner**

Call `/v1/imports/validate`, review the returned preview against the pinned metrics, then call `/v1/imports/:id/commit`. Save a sanitized receipt containing import ID, workbook SHA, row count, all reconciliation counters, and commit time. Replay the commit once and require `replayed: true` with unchanged database counts.

- [ ] **Step 5: Prove production preservation and completeness**

Use read-only counts and authenticated bootstrap to prove: all 3,172 workbook rows/6,344 identifiers are present; the original 4 Nota, 6 pre-import movements, and 8 manual price-history rows remain; reconciliation movement count equals `stockAdjustedCount`; unmatched existing count equals the result; and no import is staged or duplicated.

- [ ] **Step 6: Complete device acceptance and soak**

After the owner manually installs GitHub artifacts, test Windows and Samsung against the same Core: Nota editing, PCS/LSN, SKU pagination/search, image sync, stock check/barcode/update, print to Microsoft Print to PDF, Excel/PDF exports, Android Back navigation, packaged logo, sync-state labels, offline/upgrade-required states, and restart/replay. Run a 60-minute CA-validated health/bootstrap soak with no failed sample.

- [ ] **Step 7: Publish only after every gate is proven**

Run final verification-before-completion, tag the exact commit `v0.2.4`, create the GitHub release with installer/APK checksums and known signing boundary, and keep the workbook private. Do not claim a physical printer was tested when acceptance used Microsoft Print to PDF.
