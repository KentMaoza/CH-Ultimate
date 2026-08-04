# Task 8 Report: Authoritative Catalogue Operations

## Status

`DONE_WITH_CONCERNS`

SKU, signed stock adjustment, label-template, and invoice-template writes now
use authenticated, idempotent CH Core transactions. The Core gateway retains
authoritative row versions, sends versioned commands, converges bootstrap and
change history, and reports permanent business rejections in actionable
Indonesian copy.

The remaining concern is environmental: `CH_CORE_TEST_DATABASE_URL` was not
configured, so the guarded destructive integration suite against an isolated
MariaDB test schema was not run. No real MariaDB or NAS deployment success is
claimed.

## Implemented behavior

- Added strict bounded validation and authenticated routes for:
  - `POST /v1/skus`
  - `PATCH /v1/skus/:id`
  - `POST /v1/skus/:id/stock-adjustments`
  - `PATCH /v1/templates/:kind`
- Every route requires a UUID idempotency key and uses the existing durable
  idempotent mutation transaction, including the shared
  `business_write_lock`.
- SKU creation preserves original identifier text, stores the normalized
  SHA-256 lookup, creates the optional tracked balance, appends initial price
  history, and commits audit/change/receipt data atomically.
- Versioned SKU updates return typed 409 conflicts with base, mine, and server
  material. Primary-identifier replacement retains the previous identifier as
  an alias; alias collisions fail before partial writes. Price changes append
  immutable price history, and archive state remains represented in bootstrap.
- The reusable active-SKU lookup rejects archived or missing SKUs for future
  online business operations.
- Stock accepts only a nonzero safe-integer signed delta. The repository locks
  the active SKU and balance row, increments rather than replaces the balance,
  permits negative results, and appends one immutable movement linked to the
  idempotency operation UUID.
- Template writes validate the exact label/invoice definition before SQL,
  create or update the single active row for the kind under the shared write
  lock, and return typed version conflicts.
- Bootstrap and ordered changes now include authoritative price-history and
  stock-movement rows. The client maps them back to existing price-change and
  adjustment history without changing the mock gateway contract.
- Core-only state retains SKU, balance, and template versions from bootstrap,
  ordered changes, and mutation acknowledgements. A missing SKU version fails
  closed before transport.
- Pending versioned edits to the same entity are rebased to the preceding
  acknowledgement version and persisted before their first send. This closes
  the in-flight sequential-edit race while retaining durable idempotency.
- Permanent 400/403/404/409/422 business rejections leave the retry outbox and
  surface localized copy. Typed `CONFLICT` responses retain the existing
  conflict queue and remove their optimistic overlay.
- Inventory keeps a failed stock-adjustment dialog open. Label and invoice
  builders expose asynchronous save failures. Existing mock behavior remains
  intact.

No migration was added for template uniqueness because all catalogue/template
writes are serialized by the existing singleton `business_write_lock`, and the
repository updates the locked active row instead of inserting a replacement.

## TDD evidence

Each slice was observed red before the smallest implementation:

1. Route/service tests failed on missing route, validation, and service
   modules; they then passed for auth, UUID paths, idempotency keys, strict
   bodies, version strings, template kinds, and signed deltas.
2. SKU repository tests failed on the absent repository; they then passed for
   creation, normalized identifier collision, version conflict, price history,
   identifier rollover, archive, audit, and ordered changes.
3. Stock repository tests failed on the absent repository; they then passed
   for additive deltas, negative balances, active/tracked guards, immutable
   movement data, and transaction-shaped replay behavior.
4. Template repository tests failed on the absent repository; they then
   passed for create/update, version conflict, and serialized one-row-per-kind
   behavior.
5. Core gateway and UI tests failed on missing row versions, absolute stock
   payloads, missing history hydration, and swallowed UI errors; they then
   passed with the authoritative contracts. A final regression test reproduced
   an in-flight second edit sending stale version `12`; after the queue rebase,
   it sends acknowledged version `13`.

## Fresh verification

| Gate | Result |
| --- | --- |
| `npm --prefix server test` | PASS — 30 files; 193 passed, 1 guarded workbook test skipped |
| `npm --prefix server run typecheck` | PASS |
| `npm --prefix server run build` | PASS |
| `npm run verify` | PASS — 53 files, 391 tests |
| authoritative gateway + mutation queue focused tests | PASS — 2 files, 16 tests |
| inventory/label/invoice focused UI tests | PASS — 3 files, 18 tests |
| `git diff --check` | PASS |

The root test run retains only the existing Vite CJS API deprecation warning.

## Boundaries

- `CH_CORE_TEST_DATABASE_URL` was unavailable, so no real MariaDB transaction,
  migration, rollback, concurrency, or restart result is claimed.
- No NAS, DSM, SMB share, QuickConnect, Tailscale endpoint, or deployment
  setting was accessed or changed.
- `/Users/hamlet/Documents/CH Nota` was not accessed or modified.
- Nota operations, offline/outbox expansion, pairing, packaging, and rollout
  remain outside Task 8.

## Fix round 1/5 — reviewer closure

This round supersedes the earlier “no migration” decision. All seven Important
review findings and the safe minor findings are closed in the implementation:

1. Identifier normalization now trims, applies NFKC, and lowercases using the
   Indonesian locale. Renaming to an existing alias on the same SKU promotes
   that row; a normalized-equivalent primary rename updates that row in place;
   another SKU's identifier still rejects before writes.
2. Versioned SKU and template mutations now send the actual canonical base
   fields. Strict validation requires matching SKU base/patch keys and
   consistent template version/base knowledge, so conflicts can show meaningful
   base, mine, and server values.
3. Unknown template version state is distinct from a confirmed absent template.
   Cached/offline template writes fail closed until bootstrap. Restored template
   outbox entries are rebased to the bootstrap version and persisted before
   send; acknowledged optimistic templates become the next canonical base.
4. Inventory image replacement is functional end to end. The clients accept a
   bounded image data URL, native transports allow only the exact authenticated
   upload route, CH Core validates base64, MIME, magic bytes, dimensions, and
   size, private storage deduplicates by SHA-256, and the SKU update replaces
   its image hash/source metadata.
5. Inventory archive/restore now awaits the gateway write and reports success
   or rejection. A failed write no longer appears successful or silently
   disappears from operator feedback.
6. A guarded real-MariaDB suite was added for concurrent signed stock deltas,
   lost-response replay counts, identifier-conflict rollback, and duplicate
   active-template migration failure/recovery. It refuses any database name
   except exactly `chu_test`.
7. Migration `007_active_template_kind.sql` adds a generated active-kind column
   plus a unique index, making one active template per kind a durable database
   invariant. The repository also explicitly rejects pre-existing duplicate
   active rows instead of selecting the first.

Safe minor closure:

- Whitespace-only identifiers are rejected.
- Duplicate label fields and duplicate invoice element IDs are rejected.
- The stale bootstrap mapping comment now describes stock and price history.
- The former dense SKU repository is split into create, update, identifier,
  and payload modules.
- Bootstrap outbox rebasing avoids an unnecessary second state publication
  when no versioned template entry changed.

### Fix-round TDD evidence

- Identifier repository: RED 2/8, then GREEN 8/8.
- Strict conflict/template contracts: GREEN 23/23 server and 16/16 gateway
  focused checks after their initial contract failures.
- Template knowledge and durable bootstrap rebase: GREEN 22/22.
- Image route/storage: GREEN 33/33; SKU/route behavior: GREEN 21/21; gateway
  mapping/upload/UI: GREEN 37/37; Electron transport: GREEN 12/12.
- Archive/restore UI: RED 2/14, then GREEN 14/14.
- Migration/template invariant: RED 4/28, then GREEN 28/28.
- Full client verification exposed one duplicate bootstrap notification; the
  focused bootstrap tests then passed 23/23 and the repeated full suite passed.

### Fresh fix-round verification

| Gate | Result |
| --- | --- |
| `npm --prefix server test` | PASS — 30 files; 206 passed, 1 intentional acceptance skip |
| `npm --prefix server run typecheck` | PASS, including guarded integration sources |
| `npm --prefix server run build` | PASS |
| `npm run verify` | PASS — 53 files, 397 tests |
| `npm run mobile:build` | PASS |
| `npm run package` | PASS — Electron arm64 package |
| Android `./gradlew test lint` with Android Studio JBR and local SDK | PASS — 469 tasks |
| `git diff --check` | PASS |

`CH_CORE_TEST_DATABASE_URL` remains unset. Therefore the new guarded MariaDB
tests were compiled but not executed, and no live database claim is made.

`npm run test:e2e` was also run and all eight legacy demo-path tests timed out
while waiting for mock business screens. The packaged client now correctly
starts behind CH Core connection/pairing instead of silently selecting demo
data; that existing E2E harness does not provision a Core service or identity.
This is recorded as a harness/environment blocker, not worked around by
weakening the production fail-closed boundary.

No NAS, DSM, SMB, QuickConnect, Tailscale, deployment setting, or
`/Users/hamlet/Documents/CH Nota` content was accessed or changed in this
fix round. Task 9 was not started.

## Fix round 2/5 — durable replay and image transaction closure

This round closes the three remaining Important findings without changing the
Task 8 boundary:

1. Restored outbox entries are immutable commands. Bootstrap no longer rewrites
   a restored template's row version or base, and the queue never coalesces into
   an item that may already have reached CH Core. A lost response therefore
   replays the identical idempotency key and payload. If a peer write made that
   payload stale, the unchanged retry becomes a typed conflict instead of a
   silently rewritten command.
2. Successful SKU and template acknowledgements apply the returned
   authoritative entity to canonical state before any following local command
   is prepared. Only a command created in the current process and proven not to
   have started transport may be rebased. Its row version and base are both
   rebuilt from the acknowledged entity and durably persisted before first
   send.
3. SKU image replacement is now one durable command:
   `POST /v1/skus/:id/image`. The outbox persists the UUID idempotency key,
   version/base, MIME type, and bounded base64 bytes before transport. CH Core
   validates MIME, magic bytes, dimensions, and size, then uses the shared
   idempotency and business-write transaction for the image asset row, SKU
   version, audit event, ordered change, and receipt. The former unaudited
   direct `POST /v1/images` write was removed.

Windows and Android native request policies allow the larger request envelope
only for the exact versioned UUID SKU-image route. Direct image mutation,
lookalike UUID paths, traversal, and unknown routes continue to fail closed.

Content bytes are written to a deterministic SHA-256 path before their database
reference. A storage failure leaves the SKU, audit, and change tables untouched.
A later database rollback can leave only an unreferenced content-addressed file;
it cannot publish a partial business transaction, and a retry safely reuses the
same path.

### Fix-round TDD evidence

- Restored outbox replay and sequential acknowledgement tests were RED 5/13,
  then the authoritative catalogue and concurrency suites passed 22/22.
- The combined image command first failed because the client still performed
  two requests and the exact native route was absent. After implementation,
  client/outbox/Electron focused tests passed 35/35.
- Server HTTP, validation, service, repository, storage-failure, stale-version,
  and direct-route rejection tests passed 52/52.
- A guarded `chu_test` case now verifies lost-response image replay keeps one
  receipt, one audit event, one asset row, and one SKU version increment.

### Fresh fix-round verification

| Gate | Result |
| --- | --- |
| `npm run verify` | PASS — 53 files, 400 tests |
| `npm run server:test` | PASS — 31 files, 211 passed, 1 intentional acceptance skip |
| `npm run server:typecheck` | PASS, including guarded integration sources |
| `npm run server:build` | PASS |
| `npm run mobile:build` | PASS |
| `npm run package` | PASS — Electron arm64 package |
| `npm run android:sync` | PASS |
| Android `./gradlew test lint` with JDK 21 and local SDK | PASS — 469 tasks |
| `git diff --check` | PASS |

`CH_CORE_TEST_DATABASE_URL` remains unset, so the destructive guarded MariaDB
suite was compiled but not executed. The eight legacy E2E tests were not rerun:
round 1 already established that they require the removed implicit demo startup
and do not provision CH Core or an identity. No production boundary was
weakened to make that obsolete harness pass.

No NAS, DSM, SMB, QuickConnect, Tailscale, deployment setting, or
`/Users/hamlet/Documents/CH Nota` content was accessed or changed. Task 9 was
not started.
