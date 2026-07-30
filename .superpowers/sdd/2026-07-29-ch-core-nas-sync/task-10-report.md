# Task 10 Report: Bounded Offline Synchronization

## Status

`DONE_WITH_CONCERNS`

CH Ultimate now supports exactly two durable offline commands: one new local
Nota represented by a replaceable full snapshot before first send, and one
signed stock delta with a required reason and captured SKU snapshot. All other
shared writes fail closed while offline. A successful authenticated refresh is
required before either command can transmit.

The implementation and first reviewer fix rounds are complete. Reviewer fix
round 3 addresses its one reported finding and is pending re-review. The root,
server-unit, mobile, package, and Android gates pass. Two
environmental/inherited gates remain:

- `CH_CORE_TEST_DATABASE_URL` is unset, so the exact isolated `chu_test`
  integration source compiled but was not executed.
- The legacy Electron demo E2E harness still opens the intentional fail-closed
  CH Core connection state instead of an explicitly provisioned test mock. The
  bounded run repeated the previously documented timeout pattern and was
  stopped after five identical 30-second timeouts; the production guard was
  not weakened.

No MariaDB integration, physical-device, NAS, or deployment success is
claimed.

## Implemented behavior

- Added a strict cache-v3 local envelope containing the canonical snapshot,
  decimal cursor, existing online outbox, installation UUID, deferred offline
  outbox, a separately persisted quarantined online outbox, provisional Notas,
  retained offline conflicts, and installation-bound quarantine state.
- Clean cache-v1/v2 canonical read data migrates only when it contains no
  recoverable work. Because those legacy formats were not native-bound, any v1
  normal outbox or v2 normal/deferred outbox, provisional Nota, conflict, or
  active quarantine fails closed visibly without rewriting or transmitting.
  Retry remains inert in that upgrade-required state. Invalid v3 data and a
  native UUID mismatch also fail closed visibly without rewriting the caller's
  value.
- Added a FIFO deferred outbox that persists the operation UUID, exact payload,
  and send state before transport. A Nota snapshot may be replaced only before
  its first send while retaining the same operation UUID.
- Once sending begins, response loss and app restart replay the identical
  idempotency key and body. A conflicted head command stops later commands
  until the operator resolves or discards it.
- Permanent 4xx failures remain as typed actionable offline conflicts.
  `mine` requeues the immutable command and `server` discards it; discarding a
  provisional Nota also removes its local projection.
- Authenticated `401` from either queue atomically quarantines every deferred
  command and every pending normal Core mutation. Both pumps remain fail
  closed and expose the complete visible count. A successful bootstrap resumes
  work only when its native installation UUID matches the installation that
  was revoked.
- A deferred-command `401` uses one post-persistence callback to reset polling
  and restore the persisted quarantine into live gateway state. The normal
  mutation queue checks revocation before every iteration, so a concurrent
  in-flight A may acknowledge idempotently while queued B never transmits;
  both durable quarantine entries remain intact and no revoked post-ack refresh
  runs.
- Electron exposes that stable UUID from the existing encrypted
  `safeStorage` credential state through one authenticated IPC method. Android
  exposes the existing Keystore-backed installation UUID through one native
  Capacitor method. Neither renderer/WebView transport exposes a device token.
- Unknown, revoked, unpaired, and upgrade-required states fail closed for
  mutations. Only a definitely `offline` state enables the two local command
  paths.
- Offline Nota creation uses client UUIDs, page A, and fifteen UUID-backed
  lines. Header, page, and line edits replace one full local snapshot before
  first send.
- Offline completion keeps central stock and revenue unchanged and shows
  `Menunggu sinkronisasi — stok dan omzet pusat belum berubah.` until
  acknowledgement.
- Full bootstrap/resync applies the server canonical state and then overlays
  unsent provisional Notas. Server acknowledgement atomically removes the
  provisional UUID and installs the authoritative Nota entity.
- Offline stock requires a safe nonzero signed delta and a trimmed reason of
  at most 512 characters. It captures identifier, name, and price but never
  optimistically replaces the authoritative balance.
- Offline stock acknowledgement applies only the authoritative returned
  balance. It does not create a synthetic adjustment; the ordered server
  `stock_movement` change supplies the single visible movement identity and
  exact concurrent before/after quantities.
- A provisional Nota remains on local routing after polling publishes online.
  Once its command has `firstSentAt`, header, line, page, delete, and completion
  edits all retain the immutable payload and reject with the existing
  `Sedang sinkronisasi` guard. Completed local Notas also reject page restore.
  Provisional reopen, cancellation, and restoration follow the same guarded
  local route and never send a provisional UUID to server lifecycle endpoints.
- Added authenticated `/v1/offline/notas` and
  `/v1/offline/stock-adjustments` routes under the existing idempotency
  receipt, payload-hash, device identity, business-lock, and transaction
  boundary.
- Offline Nota replay allocates official UUIDs and WITA
  `CHU-YYYYMMDD-NNNN` numbering, inserts the bounded page/line snapshot, and
  optionally completes it in the same idempotent transaction.
- Archived Nota SKUs keep their live relation while recording a captured
  snapshot warning. Deleted Nota SKUs use a null relation and explicit warning
  instead of fabricating a live SKU.
- Offline stock replay locks the captured SKU and balance, applies one
  additive movement, records the exact reason, audit, and ordered changes, and
  returns the authoritative balance. Archived SKUs are accepted with a
  `stock_balance` warning; missing SKUs return retained `SKU_MISSING`.
- Migration `009_offline_operations.sql` widens immutable stock-movement
  reasons to 512 characters. The migration was registered as schema version 9;
  focused tests first proved that the unregistered migration was skipped.
- Desktop and mobile show pending, quarantined, revoked, conflict, and
  central-effects-pending copy without redesigning either interface. Desktop
  stock adjustment asks for the required offline reason.

## Bounded module layout

- `src/gateway/core-local-store.ts`: 470 lines
- `src/gateway/core-outbox.ts`: 355 lines
- `server/src/offline/validation.ts`: 167 lines
- `server/src/offline/service.ts`: 97 lines
- `server/src/offline/mariadb-stock-adjustment.ts`: 155 lines
- `server/src/offline/mariadb-repository.ts`: 389 lines

The existing Core gateway remains dense because it owns the public gateway
contract, but Task 10 edits were made in independent permission, local-Nota,
stock, acknowledgement, and lifecycle slices with focused verification between
them. Server stock replay was split from Nota import so each persistence module
stays below 500 lines.

## TDD evidence by slice

1. Cache-v2 migration, corrupt-cache rejection, and app-kill recovery tests
   were RED before the local store existed, then GREEN.
2. Editable-before-send, immutable-after-send, lost-response replay, FIFO,
   and quarantine tests were RED before the deferred outbox, then GREEN.
3. The offline permission matrix was RED for unrestricted shared mutations,
   then GREEN with Indonesian read-only copy and safe stock validation.
4. Local Nota projection, full snapshot replacement, pending completion copy,
   resync survival, and official-ID replacement were RED, then GREEN.
5. Server Nota route/repository tests were RED before strict validation and
   snapshot-safe import, then GREEN for archived and missing SKU behavior.
6. Offline stock repository tests were RED before additive replay and retained
   missing-SKU errors, then GREEN. Stock persistence was then split into its
   own module without changing focused results.
7. Revocation tests were RED before full-queue quarantine and reapproval
   resume, then GREEN. Permanent rejection now also persists a typed conflict.
8. Desktop/mobile status and pending-effects tests were RED before lifecycle
   copy, then GREEN.
9. Migration tests were intentionally changed to expect v9 and failed while
   the migration registry still stopped at v8. Registering migration 009 made
   all 24 focused migration tests pass.
10. The first full root run exposed five cache/timing compatibility
    regressions. Surgical cache priming, fail-closed error discrimination, and
    projection fixes restored all legacy behavior; the combined focused
    regression set passed 63 tests before the full suite.
11. Reviewer fix round 1 added RED regressions for full normal/deferred queue
    quarantine, matching and mismatching native installation reapproval,
    authoritative stock movement identity, every first-sent provisional Nota
    edit path, and completed-Nota page restore. The four-file focused set then
    passed 31 tests. A full run exposed six optimistic timing/cached-publication
    regressions; a synchronous provisional-ID projection and bounded legacy
    cache publication restored them before the final full gate.
12. Reviewer fix round 2 added a deterministic RED interleaving for deferred
    401 versus normal A/B, three provisional lifecycle RED cases, five v2
    recoverable-ownership cases, and visible v2/v3 initialization refusal.
    The focused regression set passed 48 tests and the final root suite passed
    442 tests. All three findings are addressed pending re-review.
13. Reviewer fix round 3 added RED coverage for an ownership-less v1 pending
    outbox. It proves visible initialization refusal, byte-identical retained
    storage, zero saves/requests, and an inert retry. The shared legacy-work
    guard made the two-file slice pass 30 tests; updating the prior clean-cache
    publication fixture made the three-file focused set pass 42 tests. The
    final root suite passed 444 tests. The one finding is addressed pending
    re-review.

## Exact MariaDB integration source

`server/test/offline-operations.integration.test.ts` refuses every database
except exact `/chu_test`. It migrates the schema and covers:

- completed offline Nota replay with an archived SKU;
- one Nota, one posting, one revenue effect, and one sale movement despite
  duplicate idempotency replay;
- captured snapshot warning audit;
- additive offline stock replay with the identical operation key;
- exact final balance, posting, movement, revenue, and warning counts; and
- retained `SKU_MISSING` for a deleted captured stock SKU.

The source passes source/test TypeScript compilation. It was not executed
because `CH_CORE_TEST_DATABASE_URL` is absent.

## Fresh verification

| Gate | Result |
| --- | --- |
| `npm run verify` | PASS — 56 files, 444 tests |
| `npm run test:mobile` | PASS — 9 files, 84 tests |
| `npm run mobile:build` | PASS — 589 modules |
| `npm run package` | PASS — Electron arm64 package |
| `npm run server:typecheck` | PASS — source plus unit/integration sources |
| `npm run server:test` | PASS — 41 files; 273 passed, 1 intentional workbook skip |
| `npm run server:build` | PASS |
| `npm run android:sync` with Android Studio JDK 21 | PASS |
| Android `test` with JDK 21 and local SDK | PASS |
| Android `lint` with JDK 21 and local SDK | PASS |
| `git diff --check` | PASS |
| `npm run server:test:integration` | BLOCKED/FAIL-CLOSED — 3 suites reject the absent exact isolated `chu_test` URL; 10 tests skipped |
| `npm run test:e2e` | BLOCKED — five repeated legacy demo timeouts at fail-closed CH Core startup; run stopped, one interrupted and two not run |

The builds retain the existing Vite CJS-deprecation, large-chunk, Gradle
`flatDir`, and unconfigured-E2E warnings/boundaries.

## Boundaries

- No NAS, DSM, SMB, QuickConnect, Tailscale endpoint, certificate, database
  package, firewall, reverse proxy, router, or deployment setting was accessed
  or changed.
- `/Users/hamlet/Documents/CH Nota` was not accessed or modified.
- No general offline editing, existing-record offline edits, automatic client
  updates, production printing, or Task 11 deployment work was started.
