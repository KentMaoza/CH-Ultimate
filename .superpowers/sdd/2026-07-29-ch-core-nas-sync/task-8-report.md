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
