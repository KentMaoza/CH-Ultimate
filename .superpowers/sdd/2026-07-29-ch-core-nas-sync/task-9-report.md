# Task 9 Report: Synchronized Nota Lifecycle and Atomic Postings

## Status

`DONE_WITH_CONCERNS`

CH Core now owns Nota identity, editing versions, conflicts, lifecycle
transitions, stock effects, and omzet postings. Desktop and mobile clients use
the same authoritative Nota records and no production or mock contract retains
the former desktop-transfer concept.

The only remaining verification concern is environmental:
`CH_CORE_TEST_DATABASE_URL` is unset, so the guarded destructive lifecycle
suite was compiled but not executed against a real isolated `chu_test`
MariaDB schema. No MariaDB integration or NAS deployment success is claimed.

## Implemented behavior

- Added strict authenticated/idempotent routes for Nota creation, page
  add/cancel/restore, header edits, line upsert/delete, completion,
  reopen/cancel/restore, and Nota conflict resolution.
- Added WITA business numbering as `CHU-YYYYMMDD-NNNN` with a durable,
  concurrency-safe daily MariaDB sequence.
- Added migration `008_nota_authority.sql` for page/lifecycle authority, line
  unit and dual-price snapshots, completion metadata, posting snapshots,
  revenue postings, and durable conflicts linked to the originating device and
  operation.
- Server creation atomically creates page A and fifteen real UUID-backed blank
  rows. Creation and page addition publish the Nota, page, and every line to
  the ordered change log so peer clients receive usable authoritative IDs.
- Header fields retain independent decimal-string versions. Lines are
  whole-line versioned; pages retain structure and lifecycle versions; the
  Nota retains structure and lifecycle versions.
- Different fields/lines merge. Same-field, same-line, delete-versus-edit,
  structure-versus-edit, and lifecycle races commit typed durable 409 conflict
  material with base/mine/server context, audit, change, and idempotency
  receipt.
- Conflict resolution supports `server` discard and `mine` override. Overrides
  apply the original intent against current canonical state and append explicit
  audit/change records under a fresh resolution idempotency operation.
- Completion is serialized by the existing business lock and locks the Nota,
  pages, lines, affected SKUs, and tracked balances. One transaction records
  the immutable posting snapshot, additive stock movements/balances, revenue,
  lifecycle state, audit, changes, and receipt.
- Recompletion posts only the delta from the prior immutable snapshot.
  Cancellation appends stock/revenue reversals; restoration reapplies the
  snapshot. Historical rows are never deleted and idempotent replay cannot
  duplicate effects.
- Only SKUs with tracked balances affect stock. Negative balances remain
  allowed. Archived SKUs cannot be selected for new edits, while historical
  snapshots remain readable.
- Core gateway state now retains canonical field/line/page/lifecycle bases and
  versions from bootstrap, changes, and acknowledgements. Commands carry exact
  version/base/mine material.
- Rapid never-sent edits may coalesce only after their exact body is durably
  saved. Restored or possibly-sent outbox entries remain immutable.
- Desktop explicitly flushes pending Nota writes before completion and
  cancellation; the Core coordinator also flushes before every Nota lifecycle
  command. Conflicts block lifecycle sends while preserving recoverable queue
  state.
- Desktop and mobile show Indonesian base/mine/server conflict context with
  `Gunakan perubahan saya` and `Gunakan versi server`.
- Removed `transferNotaToDesktop`, `NotaDesktopTransferResult`,
  `desktopTransfer*`, and the Nota transfer route from production, domain,
  gateway, mock, UI, and test contracts. Mobile completion now says the Nota is
  available to all synchronized devices.

## TDD evidence by slice

1. Strict route and numbering tests were RED for missing Nota routes/modules,
   then GREEN with 15 focused tests.
2. Header merge/version tests were RED for missing merge/conflict decisions,
   then GREEN.
3. Page/line version, delete/edit, structure/edit, and archived-SKU tests were
   RED for missing authority, then GREEN; slices 2–3 finished with 6 focused
   tests passing.
4. Posting arithmetic was RED for missing completion effects, then GREEN with
   3 focused tests covering aggregation and exact deltas.
5. Recompletion/reversal/restoration arithmetic was GREEN in that focused
   suite; a real lifecycle integration source was added behind the exact
   `/chu_test` guard.
6. Durable conflict service/replay and `mine`/`server` UI tests were RED for
   missing typed material/actions, then GREEN.
7. Gateway mutation tests were RED for unversioned Nota bodies and missing
   flush ordering, then GREEN with 11 mutation tests plus the desktop lifecycle
   regression. The full suite later exposed one stale `patch` concurrency
   assertion; it was updated to assert the exact persisted
   `fields: {version, base, mine}` body and passed 9/9.
8. Mobile Nota/archive tests were RED for transfer-era actions/copy, then GREEN
   after the two bounded UI passes. The combined Nota/mobile/conflict/desktop
   focused run passed 53 tests.

## Exact MariaDB integration source

`server/test/nota-lifecycle.integration.test.ts` refuses every database except
exact `/chu_test`. It migrates the schema, creates an approved device and
tracked SKU, then exercises:

- create and authoritative line edit;
- first completion;
- replay of the original completion key;
- reopen and quantity edit;
- recompletion delta;
- cancellation reversal;
- restoration reapplication;
- final stock, revenue, posting-count, and movement-count assertions.

The source passes TypeScript compilation. It was not run because
`CH_CORE_TEST_DATABASE_URL` is absent.

## Fresh verification

| Gate | Result |
| --- | --- |
| `npm --prefix server test` | PASS — 36 files; 236 passed, 1 intentional workbook skip |
| `npm --prefix server run typecheck` | PASS — source plus test/integration sources |
| `npm --prefix server run build` | PASS |
| `npm run verify` | PASS — 54 files, 403 tests |
| `npm run test:mobile` | PASS — 9 files, 81 tests |
| `npm run mobile:build` | PASS — 587 modules |
| `npm run package` | PASS — Electron arm64 package |
| `npm run android:sync` | PASS |
| Android `test` with Android Studio JDK 21 and local SDK | PASS |
| Android `lint` with Android Studio JDK 21 and local SDK | PASS |
| `git diff --check` | PASS |
| `npm run server:test:integration` | NOT RUN — exact isolated MariaDB URL absent |

The builds retain the existing Vite CJS-deprecation, large-chunk, and Gradle
`flatDir` warnings.

## Boundaries

- No NAS, DSM, SMB, QuickConnect, Tailscale endpoint, certificate, database
  package, reverse proxy, or deployment setting was accessed or changed.
- `/Users/hamlet/Documents/CH Nota` was not accessed or modified.
- Task 10 offline creation/outbox policy and Task 11 deployment were not
  started.

## Fix round 1

The first review round closed all seven critical and six important findings.

- MariaDB `DATE` values now normalize to exact `YYYY-MM-DD` strings for
  bootstrap and ordered Nota changes, including driver-returned `Date`
  objects. Completion destination is a first-class Nota column in every
  server/client projection.
- Peer changes install Nota field, structure, lifecycle, page, page-lifecycle,
  and line versions even though a Nota row has no generic `rowVersion`.
- Every edit carries the Nota lifecycle version. Lifecycle-versus-edit and
  concurrent lifecycle races create durable typed conflict material before
  generic editability rejection.
- Conflict intent stores the full command. `mine` can reapply header, line,
  delete-line, add-page, page lifecycle, and Nota lifecycle commands against
  current versions; `server` discards the intent. Resolution acknowledgements
  return the real change revision, canonical entity, and complete version
  state, and repeated resolution returns the current real revision.
- Cancelling a reopened Nota reverses its active prior posting. Restoring it
  reapplies that posting, preserving additive history.
- Posting snapshots now contain the exact posted line fields, identifier/name
  snapshots, tracked-line decisions, and stock effects. Linked line edits
  snapshot the locked SKU primary identifier, so later SKU rename/archive
  cannot rewrite historical postings.
- Posting and revenue rows are available in consistent bootstrap and ordered
  changes. Core omzet reports use immutable revenue rows and posted-line
  snapshots rather than mutable Nota pages.
- Header validation is field-specific. Line multiplication and aggregate Nota
  totals reject values outside the renderer's safe integer range before a
  database bind.
- The former 1,739-line MariaDB repository is now a 42-line facade. Row/date
  mapping, shared queries/writes, page, header, line, conflict, lifecycle, and
  posting persistence are separate modules; every production module is below
  500 lines.

### Expanded guarded MariaDB evidence

The exact `/chu_test` source now also covers:

- cancellation and restoration while the Nota is reopened;
- immutable pre-rename and post-rename SKU identifier snapshots;
- ordered `nota_posting` and `revenue_posting` changes;
- durable multi-field `mine`, `server`, and repeated resolution;
- authoritative version-state acknowledgement;
- concurrent daily number allocation; and
- one successful posting under concurrent completion.

The source compiles, but these four integration tests were not executed because
`CH_CORE_TEST_DATABASE_URL` is absent. The integration command failed closed
before touching any database that was not explicitly named `chu_test`.

### Fix-round verification

| Gate | Result |
| --- | --- |
| `npm run verify` | PASS — 54 files, 408 tests |
| `npm run test:mobile` | PASS — 9 files, 81 tests |
| `npm run mobile:build` | PASS — 587 modules |
| `npm run package` | PASS — Electron arm64 package |
| `npm run server:test` | PASS — 36 files; 244 passed, 1 intentional workbook skip |
| server source/test typecheck | PASS |
| `npm run android:sync` | PASS |
| Android `test` with Android Studio JDK 21 and local SDK | PASS |
| Android `lint` with Android Studio JDK 21 and local SDK | PASS |
| `git diff --check` | PASS |
| `npm run server:test:integration` | BLOCKED — exact isolated `chu_test` URL absent |
| `npm run test:e2e` | BLOCKED — all eight legacy demo tests time out at fail-closed CH Core startup before a screen assertion; provisioning/pairing belongs to Task 11 |

The E2E startup guard was not weakened to restore the old silent demo fallback.
No NAS, DSM, MariaDB package, certificate, reverse proxy, or deployment setting
was accessed or changed during this fix round.
