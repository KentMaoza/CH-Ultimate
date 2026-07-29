# CH Core NAS Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Every behavior change follows superpowers:test-driven-development and every completion claim follows superpowers:verification-before-completion.

**Goal:** Replace CH Ultimate's separate desktop/mobile mock sessions with installed Windows and Android clients that synchronize through one LAN-only CH Core API and MariaDB database on the user's Synology DS223j.

**Architecture:** Existing React screens remain behind `OperationsGateway`. A small Node 24/Fastify 5 service owns validation, transactions, versions, idempotency, audit history, and an ordered change feed in native MariaDB 10. Electron and Android use narrow native transports so device tokens never enter renderer/WebView JavaScript; foreground clients poll deltas every two seconds.

**Tech Stack:** TypeScript, React 19, Electron 41, Capacitor 8/Android, Vitest, Playwright, Node 24 LTS, Fastify 5, Zod 4, MariaDB 10.11, SQL migrations, DSM Container Manager/reverse proxy.

## Global Constraints

- Preserve the current Windows desktop interface and current touch-first Android interface; do not copy desktop-only screens onto the phone.
- Use Indonesian UI copy, integer rupiah, WITA business dates, and the current monochrome CH Nota design.
- Keep `/Users/hamlet/Documents/CH Nota` read-only.
- Preserve the existing user-owned deletion in the main checkout; never stage or restore it.
- Keep `MockOperationsGateway` only for explicit tests/development. Packaged applications must never silently fall back to mock data.
- CH Core is available only from the business LAN. Tailscale remains only for the owner's DSM HTTPS and Finder/SMB administration.
- No public port forwarding, UPnP, QuickConnect dependency, Tailscale Serve/Funnel, or Internet-facing API.
- No production reset endpoint and no recurring full-catalogue replacement after live transactions exist.
- Device authentication identifies the installation, not a human operator; there is no daily staff login.
- Offline mutations are limited to a new Nota created on that device and nonzero signed stock-adjustment deltas. Existing shared records are read-only offline.
- Different Nota header fields and different lines merge. The same field, same line, delete/edit, and completion/edit races require explicit `mine` or `server` resolution.
- One LSN equals 12 PCS. Negative stock remains allowed and auditable.
- Acknowledged Nota completion, stock movements, omzet, audit event, change event, and idempotency receipt commit in one database transaction.
- The supplied workbook is the only initial production import:
  `/Users/hamlet/Downloads/SKU_Gudang20260728053648037.xlsx`
  with SHA-256
  `d9dc0d6f3b85a948f362369de9633b8b23bd516ef375878bbf700fbbae24da61`.
- Import mapping is fixed: `Nomor SKU` primary identifier, `Kode Produk` scan/search alias, `Judul` name, positive `Harga Jual Referensi` else `Modal Referensi` price, `Semua Total Stok` stock, and the corresponding note/image/created columns.
- Import acceptance is exactly 3,144 products, zero duplicate primary identifiers, 2,786 image jobs, 358 missing images, and three rows where positive sale price differs from positive modal price.
- Image fetches allow only HTTPS `res.bigseller.pro`, public resolved destinations, at most three validated redirects, image MIME/magic bytes, bounded dimensions, 5 MiB, and ten seconds. Store content-hash filenames and preserve the source URL.
- Do not deploy or upgrade DSM/packages without authenticated preflight. Do not call the system production until independent Hyper Backup plus a clean restore drill passes.
- Current baseline is 29 Vitest files/235 tests and a successful mobile production build.

---

### Task 1: Extract the gateway contract without changing mock behavior

**Files:**
- Create: `src/gateway/operations-gateway-contract.ts`
- Create: `src/gateway/mock-operations-gateway.ts`
- Modify: `src/gateway/operations-gateway.ts`
- Test: `tests/unit/operations-sync-contract.test.ts`

**Interfaces:**
- Produces `SyncPhase`, `SyncSnapshot`, `OperationsGatewayCapabilities`, and the extended `OperationsGateway`.
- Keeps `src/gateway/operations-gateway.ts` as a compatibility re-export so existing imports remain valid.

**Behavior:**
- Add sync phases `demo | unpaired | connecting | online | offline | syncing | conflict | revoked | upgrade-required`.
- Add `getSyncSnapshot`, `subscribeSync`, `initialize`, `flushNota`, `retryPending`, and `resolveConflict`.
- The mock reports `demo`, revision `"0"`, zero pending/conflicts, and implements new methods without changing current business behavior.
- Add capabilities for demo reset and initial catalogue import.
- Do not remove transfer metadata yet; removal happens with the mobile central-Nota slice.

**TDD and verification:**
- First test listener subscription/unsubscription, stable mock sync snapshot, and initialization.
- Verify the new test fails because the contract/mock methods do not exist.
- Implement the split and minimal mock behavior.
- Run:
  `npx vitest run tests/unit/operations-sync-contract.test.ts tests/unit/operations.test.ts tests/unit/nota-transactions.test.ts`
- Run `npm run typecheck`.
- Commit `refactor: extract operations gateway contract`.

### Task 2: Add the CH Core server foundation and MariaDB migrations

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/src/app.ts`, `server/src/config.ts`
- Create: `server/src/db/pool.ts`, `server/src/db/migrate.ts`, `server/migrations/001_initial.sql`
- Create: `server/Dockerfile`, `server/compose.yaml`, `server/.env.example`
- Test: `server/test/config.test.ts`, `server/test/migrations.test.ts`, `server/test/health.test.ts`
- Modify: root `package.json` and lockfile

**Interfaces:**
- Produces `buildApp(deps)`, `loadServerConfig(env)`, `createPool(config)`, and `runMigrations(pool)`.
- Root scripts: `server:test`, `server:test:integration`, `server:typecheck`, and `server:build`.

**Behavior:**
- Use Node 24 LTS, Fastify 5, Zod validation, and the official `mariadb` connector without an ORM.
- `GET /health/live` returns process liveness without secrets.
- `GET /health/ready` verifies schema compatibility and database availability without exposing credentials.
- Apply ordered SQL migrations under an advisory lock; refuse a database schema newer than the binary.
- Initial schema contains migrations, devices, pairings, owner recovery, SKUs/identifiers, stock movements/balances, price history, Nota/page/line/posting tables, templates, imports, idempotency receipts, audit events, client cursor acknowledgements, and ordered change log.
- Store all timestamps in UTC and global change sequence as MariaDB `BIGINT`.
- Container is ARM64-compatible, non-root, read-only, no-new-privileges, all capabilities dropped, 256 MiB memory, 0.75 CPU, 128 PIDs, 160 MiB Node heap, four DB connections, bounded logs, and one tmpfs.
- Bind the service to loopback port 18080 when using host networking; do not publish MariaDB.

**TDD and verification:**
- Write failing config/health tests before server implementation.
- Run server unit tests and typecheck.
- Run migrations twice against isolated `chu_test`; the second run is a no-op.
- Roll back a deliberately failing test transaction and verify no partial rows.
- Commit `feat: add CH Core server foundation`.

### Task 3: Implement pairing, device authentication, idempotency, audit, and change feed

**Files:**
- Create focused modules under `server/src/auth/`, `server/src/sync/`, and `server/src/http/`
- Test: `server/test/pairing.test.ts`, `server/test/idempotency.test.ts`, `server/test/sync.test.ts`

**Interfaces:**
- `POST /v1/owner/bootstrap`
- `POST /v1/pairings`, `POST /v1/pairings/redeem`, `POST /v1/pairings/:id/approve`
- `GET /v1/devices`, `POST /v1/devices/:id/revoke`
- `GET /v1/bootstrap`, `GET /v1/changes?after=<decimal>&limit=<1..500>`

**Behavior:**
- Pairing is closed by default. Owner-created codes are one-use, expire in ten minutes, are rate-limited, and require explicit approval.
- Issue opaque 32-byte device tokens. Store only SHA-256 token hashes, rotate at 180 days, keep a seven-day overlap, and revoke immediately.
- Generate one sealed owner recovery credential; store only its hash and rotate it after recovery use.
- Mutations use `(device_id, idempotency_key)` uniqueness, SHA-256 payload hash, and stored canonical response. Same key/same payload returns the original response; different payload returns 409.
- Every accepted transaction writes its business changes, audit row, change rows, and idempotency receipt atomically.
- Bootstrap uses a consistent transaction and returns a watermark. Changes are ordered, paged to 500, duplicate-safe, and use decimal-string revisions.
- Retain at least 180 days and 250,000 newest change rows. An expired cursor returns 410 with `CURSOR_EXPIRED`.

**TDD and verification:**
- Test expired/reused pairing codes, approval, token hashing, revocation, rotation overlap, recovery rotation, idempotent replay, payload mismatch, duplicate change delivery, cursor gaps, and consistent snapshot watermark.
- Run `npm run server:test` and integration tests against `chu_test`.
- Commit `feat: add CH Core identity and sync protocol`.

### Task 4: Implement the shared Core operations gateway

**Files:**
- Create: `src/gateway/core-api-types.ts`, `src/gateway/core-api-transport.ts`, `src/gateway/core-operations-gateway.ts`
- Test: `tests/unit/core-api-types.test.ts`, `tests/unit/core-operations-gateway.test.ts`

**Interfaces:**
- `CoreApiTransport.request({ method, path, body, idempotencyKey })`
- `createCoreOperationsGateway(transport, storage, clock)`

**Behavior:**
- Validate all API envelopes with Zod.
- Load the cached snapshot, preserve any outbox, fetch canonical bootstrap, then start foreground polling every two seconds.
- Poll immediately after a write, app resume, and manual retry; use exponential retry up to 30 seconds while offline.
- Apply a complete change page before advancing its cursor; ignore duplicates and full-resync on a gap/410 while preserving outbox.
- Optimistically publish controlled Nota/template fields, coalesce rapid updates per target, and reconcile canonical responses.
- `flushNota(id)` waits for every pending header/line/page write for that Nota.
- Production gateway never uses mock fixtures or implements a server reset.

**TDD and verification:**
- Test bootstrap, cache restore, remote delta, duplicate delta, revision gap, cursor expiry, foreground polling, rapid patch coalescing, flush, retry, revoked device, and schema upgrade required.
- Verify red tests before implementation.
- Run focused tests and `npm run typecheck`.
- Commit `feat: add synchronized CH Core gateway`.

### Task 5: Add the secure Electron transport and desktop connection UI

**Files:**
- Create: `src/preload.ts`, `src/electron/core-api-main.ts`, `src/renderer/core-api-bootstrap.ts`
- Create: `src/renderer/CoreConnectionScreen.tsx`, `src/renderer/OperationsSyncStatus.tsx`
- Modify: `src/main.ts`, `forge.config.ts`, `src/types.d.ts`, `src/renderer/main.tsx`
- Modify only shell/status portions of `src/renderer/App.tsx` and `src/renderer/styles.css`
- Test: `tests/unit/electron-core-api-main.test.ts`, focused shell tests

**Behavior:**
- Keep `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Expose only relative CH Core operations, pairing, and credential-status methods through `contextBridge`; never arbitrary IPC, origins, headers, or tokens.
- Main process owns the fixed HTTPS endpoint, private CA trust, and token.
- Store token with Electron `safeStorage`; if encryption is unavailable, pairing fails with Indonesian copy and no plaintext fallback.
- Packaged startup shows pairing/connection status and cannot instantiate the mock.
- Desktop statuses: `Menghubungkan`, `Terhubung`, `Menyinkronkan`, `Tidak terhubung`, `Konflik data`, `Akses dicabut`, and `Perlu pembaruan`.

**TDD and verification:**
- Test origin/path rejection, token non-exposure, safeStorage failure, CA failure, pairing, production bootstrap, and explicit test-only mock path.
- Run focused tests, `npm run typecheck`, and `npm run package`.
- Commit `feat: connect desktop client to CH Core`.

### Task 6: Add the secure Android transport and mobile connection UI

**Files:**
- Create: `mobile/core-api-bootstrap.ts`, `mobile/core-api-native.ts`
- Create: `mobile/components/CoreConnectionScreen.tsx`, `mobile/components/OperationsSyncStatus.tsx`
- Create a narrow native plugin under `android/app/src/main/java/com/tokoch/chucompanion/`
- Create: `android/app/src/main/res/xml/network_security_config.xml`
- Add the private CA public certificate under Android resources at deployment time
- Modify: `MainActivity.java`, `mobile/bootstrap.ts`, `mobile/main.tsx`, Android manifest
- Modify only the root/status portion of `mobile/MobileApp.tsx` and append scoped status styles
- Test: `tests/unit/mobile-core-api-adapter.test.ts` plus focused bootstrap/config tests

**Behavior:**
- Native code owns the endpoint and Keystore-backed device token and injects authentication internally.
- JavaScript may request only approved relative methods/paths and never receives the raw token.
- Trust only HTTPS with the bundled private CA; no global cleartext or certificate bypass.
- Set `android:allowBackup="false"` before credentials/cache/outbox exist.
- Show full-screen pairing/connection states without redesigning existing phone features.

**TDD and verification:**
- Test TypeScript adapter behavior first.
- Add JVM tests for Keystore-unavailable failure, path allowlist, token non-exposure, and HTTPS-only endpoint.
- Run mobile focused tests, mobile build, typecheck, Android sync/test/lint with JDK 21.
- Commit `feat: connect Android client to CH Core`.

### Task 7: Implement staged catalogue import and bounded image caching

**Files:**
- Create server import/image modules and routes
- Modify: `src/domain/workbook.ts`, gateway contract/Core adapter, desktop inventory import UI
- Test: server import/image tests and `tests/unit/operations.test.ts`

**Interfaces:**
- `POST /v1/imports/validate`
- `POST /v1/imports/:id/commit`
- `GET /v1/images/:hash`

**Behavior:**
- Only owner devices can validate/commit.
- Limit XLSX size to 5 MiB, rows to 10,000, cell text to 16 KiB, and reject formulas, macros, external links, malformed ZIP expansion, and required-column omissions.
- Stage the exact workbook on a private NAS volume with 24-hour expiry.
- Preview counts, warnings, and the three price mismatches before commit.
- First commit is atomic. Same hash is idempotent; another full import is blocked once live transactions exist.
- Preserve full long SKU text, original workbook, hash, source URL, and product-code aliases.
- Enqueue one image job per valid URL; run one worker with the global constraints above.
- Serve authenticated, read-only, content-addressed media through the native transports.

**TDD and verification:**
- Test the real supplied workbook and malicious bounded fixtures.
- Assert exact 3,144/2,786/358/3 results and price fallback behavior.
- Test redirects to private/link-local IP, false MIME, oversize, timeout, path traversal, and content deduplication.
- Commit `feat: import catalogue into CH Core`.

### Task 8: Move SKU, stock, and templates to server-authoritative writes

**Files:**
- Create focused server route/service/repository modules
- Modify Core gateway command implementations
- Modify only error/status handling in inventory, SKU, label, and invoice screens
- Test server services, gateway behavior, and existing focused UI suites

**Behavior:**
- Server generates UUIDs and UTC audit timestamps.
- SKU identifier uniqueness uses normalized hashed lookup while preserving original long text.
- SKU/price/template writes use optimistic row versions and 409 typed conflicts.
- Stock writes accept only nonzero integer deltas, append immutable movements, and atomically update balance; concurrent deltas both survive.
- Archived SKUs remain in history but are unavailable to new online selections.
- There is no production reset or absolute-stock client write.

**TDD and verification:**
- Test concurrent stock deltas, negative result, price conflict, alias uniqueness, archived selection, template conflict, lost response, and replay.
- Run server integration tests and focused inventory/label UI tests.
- Commit `feat: make catalogue operations authoritative`.

### Task 9: Move Nota lifecycle and concurrency to CH Core

**Files:**
- Create focused server Nota modules/routes
- Modify only save/coordinator section of `src/renderer/nota/NotaWorkspace.tsx`
- Modify `mobile/components/MobileNotaView.tsx` in separate lifecycle and completion slices
- Modify `mobile/components/MobileArchiveView.tsx`
- Remove transfer fields from domain types and transfer method from gateway
- Add new focused server/gateway/Nota tests; update existing Nota tests only where behavior changed

**Behavior:**
- Server assigns UUIDs and WITA `CHU-YYYYMMDD-NNNN` numbers.
- Each header field has an independent version, each line is a whole-line version, and page structure/lifecycle have separate versions.
- Different fields/lines merge. Same field/line, delete/edit, structure/edit, and completion/edit return typed conflict with base/mine/server.
- Client presents `Gunakan perubahan saya` and `Gunakan versi server`.
- Completion flushes client writes then locks/validates Nota and affected SKU rows.
- Completion/recompletion/cancel/restore append stock and omzet movements and never delete posting history.
- Mobile completion no longer says “send to desktop”; completed Nota appears to every client through normal sync.

**TDD and verification:**
- Test field merge, line merge, every conflict class, concurrent completion, lost response, exact-once postings, reopen delta, cancel reversal, restore reapplication, and rapid typing flush.
- Run all Nota domain/UI tests plus server integration tests.
- Commit `feat: synchronize Nota lifecycle through CH Core`.

### Task 10: Add the bounded offline snapshot and outbox

**Files:**
- Create: `src/gateway/core-local-store.ts`, `src/gateway/core-outbox.ts`
- Add platform lifecycle wiring without expanding feature screens
- Test: `tests/unit/core-outbox.test.ts`, `tests/unit/core-offline-gateway.test.ts`

**Behavior:**
- Persist canonical snapshot, decimal cursor, conflicts, and immutable outbox operations in IndexedDB.
- Persist an operation UUID before first transmission.
- Permit offline creation/edit/completion only for a new local Nota; submit its latest full snapshot and assign official server ID/number on acknowledgement.
- Permit offline signed stock delta with reason.
- Existing shared records and every other mutation are visibly read-only offline.
- Queued completion says central stock/omzet has not changed.
- Full resync preserves outbox. Revocation quarantines it; owner reapproval of the same installation can resume it.
- A SKU archived after offline capture does not erase the sale: accept the captured name/price snapshot and add an audit warning.

**TDD and verification:**
- Test app kill, pre-send loss, post-commit/pre-response loss, duplicates, queue ordering, resync, revocation, reapproval, archived SKU, and blocked commands.
- Run focused gateway/offline tests and all existing suites.
- Commit `feat: add bounded offline synchronization`.

### Task 11: Package NAS deployment, operational runbook, truthful copy, and final verification

**Files:**
- Create: `docs/ch-core-nas-deployment.md`, `docs/ch-core-backup-restore.md`
- Modify: `README.md`, Settings/status copy, stale demo labels
- Finalize: server container/compose, migration/dump/restore scripts

**Behavior:**
- Document authenticated DSM preflight: exact DSM/build, SHR-1/RAID1, Btrfs, disk health/SMART, volume below 80%, RAM/swap baseline, supported Container Manager, MariaDB consumers, UPS, reserved LAN IP.
- Create private CA off-NAS; NAS receives only leaf key/certificate with reserved IP SAN.
- DSM reverse proxy: LAN HTTPS 8443 to loopback API 18080. Firewall allows only business LAN IPv4/IPv6 and denies Tailscale/WAN/guest.
- Preserve Tailscale admin access to DSM 5001 and SMB 445 while denying CH Core, MariaDB, raw API, HTTP DSM, Serve/Funnel/SSH.
- No DSM/package upgrade until independent backup succeeds.
- Before production: encrypted Hyper Backup, integrity check, logical pre-migration dump, and clean restore rehearsal.
- Replace `DEMO DATA`, `SESSION ONLY`, “reload = data hilang”, and “kirim ke desktop” only in production runtime copy; explicit test/demo mode may retain honest labels.
- Document owner pairing, recovery credential, device revocation, certificate renewal, upgrade/rollback, and seven-client soak.

**Final verification:**
- Run every command from the approved plan:
  `npm run verify`
  `npm run test:mobile`
  `npm run mobile:build`
  `npm run package`
  `npm run test:e2e`
  `npm run server:test`
  `npm run server:test:integration`
  `npm run android:sync`
  `npm run android:test`
  `npm run android:lint`
  `git diff --check`
- Verify exact workbook import, idempotency, conflicts, offline recovery, certificate failures, LAN-only reachability, NAS restart, UPS restart, one-hour seven-client load, p95 read under 500 ms, p95 write under one second, no sustained swap, and clean backup restore.
- Production remains blocked if DSM authentication/preflight, JDK 21 native gates, physical Windows/Android gates, independent backup, or restore rehearsal is unavailable.
- Commit `docs: add CH Core deployment and operations runbook`.
