# SDD ledger — plan: docs/superpowers/plans/2026-07-29-ch-core-nas-sync.md

Baseline: branch `codex/ch-core-nas-sync` at `3a2ad2c`.
Baseline: `npm run verify` passed 29 files / 235 tests.
Baseline: `npm run mobile:build` passed.
Environment: Android Studio bundles OpenJDK 21.0.10 at `/Applications/Android Studio.app/Contents/jbr/Contents/Home`; use that `JAVA_HOME` for native Android verification.
Environment: NAS DSM is reachable over Tailscale, but authenticated DSM preflight and LAN IP remain pending.
Environment resumed 2026-07-30: business LAN is `192.168.1.0/24`; Mac is `192.168.1.18`; mounted SMB 3.1.1 session identifies `Maoza_NAS` at reachable candidate `192.168.1.14`. DSM 5000/5001 and SMB 445 are open; CH Core 8443, raw API 18080, and MariaDB 3306 are closed/filtered. Tailscale backend was stopped, confirming the observation is LAN-local. Authenticated DSM preflight is still pending.
Environment refreshed 2026-07-30 after resume: Mac remains `192.168.1.18` on `192.168.1.0/24`, SMB 3.1.1 remains mounted from `Maoza_NAS`, and `192.168.1.14` still exposes only SMB 445 and DSM 5000/5001 among checked ports; CH Core 8443, raw API 18080, and MariaDB 3306 remain closed/filtered. DSM certificate fingerprint remains `CE:BD:A5:6C:5F:86:BC:8A:CF:49:4B:A8:D0:C1:D3:79:09:DF:58:81:93:7D:B4:39:3A:84:0B:0C:17:D6:14:10`, subject/SAN `synology`; authenticated DSM state is not yet verified.
Environment manual-access note: Finder shows `docker`, `home`, `homes`, and `Seagate Slim 1TB`, but only `home` is mounted at `/Volumes/home` as user `kentmaoza` (about 1.7 TiB available, 6.7 GiB used). Do not infer the other shares are mounted; avoid `homes`. SMB is eligible only for bounded staging after preflight and cannot prove or configure DSM storage, packages, reverse proxy, or firewall state.
Authenticated DSM preflight 2026-07-30 (read-only, via QuickConnect/Safari; no NAS changes): DS223j, DSM 7.4.1-90080, RTD1619B 4-core 1.7 GHz, 1 GB RAM; DHCP `192.168.1.14/24`, 1 Gbps full duplex, MAC `90:09:D0:9F:7C:1F`. Storage Pool 1 healthy RAID1; Volume 1 healthy Btrfs, 1.7 TB total/~6.7 GB used; both ST2000VN003 2 TB disks healthy at 38C/40C with ~70 power-on hours; scrub completed 2026-07-27 14:58. No SMART self-test logs. Resource sample CPU ~22%, memory ~39%, swap 532.4 MB/2 GB (26%) with 0 KB/s current swap I/O. Container Manager 24.0.2-1606 current/running with zero projects/containers/images; Tailscale installed; MariaDB 10 and Hyper Backup absent. One USB Seagate Ultra Slim connected but no backup configuration assumed. UPS disabled/no UPS. DSM firewall disabled; reverse proxy empty; DSM 5000/5001 with HTTP-to-HTTPS redirect.
NAS deployment gate: DO NOT DEPLOY until router reservation `90:09:D0:9F:7C:1F -> 192.168.1.14`, explicit SMART tests, independent backup/integrity/clean restore, UPS, firewall and reverse-proxy configuration, MariaDB/package decision, private CA/IP-SAN certificate, and resource/load gates are completed. QuickConnect/Tailscale remain DSM/SMB administration only and must not expose CH Core.
Catalogue source replaced by user 2026-07-30: `/Users/hamlet/Downloads/SKU_Gudang20260730092414031.xlsx`, SHA-256 `64fcb734d84462060f76fa7f27495ee1e2dff6201ad2d7a2d13d5c6c27923817`. Artifact-tool inspection confirms `SKU!A1:T3145`, 3,144 data rows, zero empty/duplicate primary SKUs or product codes, 2,786 HTTPS `res.bigseller.pro` image jobs, 358 missing images, three positive sale/modal price mismatches, selected-price total Rp276,267,011, stock total 4,115 PCS, no formulas, integer stock, and maximum identifier/cell length 168. Replacement source identity committed in `70e7ef4`.

Task 1 complete: `8484e95 refactor: extract operations gateway contract`.
Task 1 gate: 3 focused files / 26 tests passed; root typecheck passed.
Task 1 review: Approved. Minor final-review item: make the mock sync snapshot immutable or return a copy before sync consumers rely on it.

Task 2 complete: `1771fb1 feat: add CH Core server foundation`, `84ec0af fix: harden CH Core migrations`, `0b537af fix: preserve applied migration history`.
Task 2 gate: 27 server unit tests and 236 root tests passed; server/root typecheck, server build, audit, and diff checks passed.
Task 2 review: Approved after two fix rounds. Published migration 001 remains byte-identical; Nota ownership is additive migration 002.
Task 2 environmental gate still pending: real `chu_test` MariaDB integration, Node 24 container build, and ARM64/Compose startup were not runnable because no database/container runtime is available locally.

Task 3 complete: `2b0c57d feat: add CH Core identity and sync protocol`, `13f4f3b fix: make CH Core protocol replay safe`.
Task 3 gate: 92 server tests and 236 root tests passed; server/root typecheck, server build, migration checksum guards, and diff checks passed.
Task 3 review: Approved after one fix round. Caller-held credential replay, reserved idempotency keys, fixed receipt TTL, strict HTTP validation, transactional audit/change, and lifecycle-managed retention are verified locally.
Task 3 environmental gate still pending: live MariaDB migration 004, concurrent idempotency, identity event SQL, and consistent snapshot integration under exact `/chu_test`.

Task 4 complete: `93ce4de feat: add synchronized CH Core gateway`, `7fcf886 fix: serialize CH Core client synchronization`, `57a8d39 fix: make Core gateway disposal terminal`.
Task 4 gate: 63 focused gateway tests and 299 full root tests passed; root typecheck and diff checks passed.
Task 4 review: Approved after two fix rounds. Polling/cache/outbox are serialized, sparse revisions are accepted, post-ack replay is durable, relations/templates fail closed, optimistic overlays reproject, and disposal is terminal.
Task 4 forward-contract gate: Task 8/9 server business routes and acknowledgement envelopes must be aligned with the centralized client route constants before production.

Task 5 fix round 1/5: 7 addressed, 0 open; commits `a845cf8..bed631e`.
Task 5 complete: commits `57a8d39..bed631e`, scoped re-review clean.
Task 5 gate resumed 2026-07-30: 49 files / 355 tests passed; root typecheck, Electron darwin-arm64 package, and diff-check passed.
Task 5 boundary still pending at final acceptance: Windows packaging/install, real Windows `safeStorage`, live private-CA TLS, and physical desktop verification.

Task 6 fix round 1/5: 1 addressed, 0 open; commits `8d871b5..166b973`.
Task 6 complete: commits `bed631e..166b973`, scoped re-review clean.
Task 6 gate: 9 mobile files / 82 tests; mobile build and typecheck; Android sync; 6 debug + 6 release app tests; Android lint 0 errors; diff-check passed on JDK 21.
Task 6 minor (deferred): final review should triage pre-existing Vite CJS/large-chunk warnings, two intentional deployment-resource reflection warnings, and generated/pre-existing Android resource/Gradle warnings.
Task 6 boundary still pending at final acceptance: production endpoint/private CA resources, live TLS, signed release, physical Android Keystore/pairing, and device installation.

Task 7 minor (deferred): add MariaDB-version-compatible CHECK constraints for image-job lifecycle/status combinations.
Task 7 minor (deferred): final review must re-evaluate SQL-heavy mocked repository coverage and the still-pending isolated MariaDB integration gate after the Task 7 fix loop.
Task 7 fix round 1/5: 8 Critical/Important groups addressed, 2 open; commits `698de92..2773f32`.
Task 7 open: preflight `xl/sharedStrings.xml` and enforce the 16 KiB cell-text limit before ExcelJS loads the workbook.
Task 7 open: expiry maintenance must select only uncommitted staged imports so the committed original XLSX is preserved.
Task 7 fix round 2/5: 2 addressed, 0 open; commits `2773f32..efd6cd9`.
Task 7 complete: commits `70e7ef4..efd6cd9`, scoped re-review approved.
Task 7 gate: 381 root tests; 172 server tests including the exact approved workbook; server typecheck/build; Android test/lint; mobile build; Electron package; diff checks passed.
Task 7 environmental gate still pending: isolated MariaDB integration under exact `chu_test` remains unrun because `CH_CORE_TEST_DATABASE_URL` is unset.

Task 8 fix round 1/5: 0 Critical, 7 Important open after initial commit `3102abf`.
Task 8 minor (deferred): reject whitespace-only manual identifiers, duplicate label fields, and duplicate invoice element IDs.
Task 8 minor (deferred): update stale bootstrap-mapping comments and re-evaluate the 533-line SKU repository split during the fix loop.
Task 8 fix round 1/5 result: 7 prior Important findings addressed, 3 new Important findings open; commits `3102abf..ef0939e`.
Task 8 open: never rewrite a restored/potentially-sent outbox payload under its existing idempotency key.
Task 8 open: apply acknowledgement entities to canonical state and rebase both version and base only for provably never-sent queued writes.
Task 8 open: make image replacement one durable idempotent queued operation rather than a direct upload followed by a separate SKU patch.
Task 8 fix round 2/5: 3 addressed, 0 open; commits `ef0939e..e1fbd49`.
Task 8 complete: commits `efd6cd9..e1fbd49`, scoped re-review approved.
Task 8 gate: 400 root tests; 211 server tests plus 1 intentional workbook skip; server typecheck/build; mobile build; Electron package; Android sync/test/lint; diff checks passed.
Task 8 environmental gate still pending: the guarded exact-`chu_test` MariaDB concurrency/replay/migration suite is compiled but unrun because `CH_CORE_TEST_DATABASE_URL` is unset.
Task 8 harness gate deferred to Task 11: legacy Playwright demo-path tests do not provision CH Core or identity and time out behind the packaged fail-closed connection screen.

Task 9 fix round 1/5: 7 Critical and 6 Important findings open after initial commit `4b4e137`.
Task 9 minor (deferred): add MariaDB-compatible lifecycle/status/kind constraints and explicit daily-sequence exhaustion behavior after correctness fixes.
Task 9 fix round 1/5 result: 6 Critical and 6 Important addressed; 1 Critical and 2 Important remain; commits `4b4e137..5ff953c`.
Task 9 fix round 2/5 result: aggregate arithmetic and ranged revenue addressed; 1 Critical lifecycle override remained; commits `5ff953c..7d58a44`.
Task 9 fix round 3/5: final lifecycle override addressed, 0 Critical/Important open; commits `7d58a44..1c67e68`.
Task 9 complete: commits `e1fbd49..1c67e68`, scoped final re-review approved.
Task 9 gate: 409 root tests; 81 mobile tests; 265 server tests plus 1 intentional workbook skip; server typecheck/build; mobile build; Electron package; Android sync/test/lint; diff checks passed.
Task 9 environmental gate still pending: guarded exact-`chu_test` concurrency/conflict/lifecycle/posting/replay suites compile but remain unrun because `CH_CORE_TEST_DATABASE_URL` is unset.

Task 10 initial complete: `a0cb7ca feat: add bounded offline synchronization`.
Task 10 fix round 1/5: all 5 initial Important findings addressed; the next
re-review identified three additional findings handled in round 2 below.
Task 10 fix round 1 behavior: one persisted installation-bound quarantine now
holds normal and deferred work after any authenticated 401; only the same
safeStorage/Keystore installation UUID can resume it. Offline stock
acknowledgement no longer creates a synthetic movement. First-sent
provisional Nota mutations remain locally guarded after online publication,
and completed offline Notas reject page restore.
Task 10 fix round 1 focused gate: 4 files / 31 tests; root typecheck; 56 files /
433 root tests; 9 files / 84 mobile tests; 273 server tests plus 1 intentional
workbook skip; mobile build/Android sync; Electron arm64 package; Android
debug/release unit tests and lint with Android Studio JDK 21; diff check.
Task 10 environmental gate still pending: `server:test:integration` fails
closed because `CH_CORE_TEST_DATABASE_URL` is unset/not exact `chu_test`
(3 suites blocked, 10 tests skipped). Legacy Electron E2E remains the inherited
Task 11 fail-closed startup harness boundary. No NAS/DSM/CH Nota access or
deployment occurred.

Task 10 fix round 2/5: 3 Important findings addressed, pending re-review.
Task 10 fix round 2 behavior: a deferred 401 now restores persisted quarantine
into live gateway state and stops a concurrently running normal mutation queue
before queued B can transmit; an acknowledged in-flight A does not erase or
resurrect quarantined A/B and does not trigger a revoked refresh. Provisional
reopen/cancel/restore remain locally guarded after first send. Clean v2
canonical data may bind to the native UUID, but any v2 recoverable work and any
v3 native-ID mismatch fail closed visibly without cache rewrite or transport.
Task 10 fix round 2 gate: 5 focused files / 48 tests; root typecheck and 56
files / 442 tests; 9 mobile files / 84 tests; 273 server tests plus 1
intentional workbook skip; server typecheck/build; mobile build/Android sync;
Electron arm64 package; Android debug/release unit tests and lint with Android
Studio JDK 21; diff check. Exact-`chu_test` integration and inherited E2E
boundaries remain unchanged. No NAS/DSM/CH Nota/Task 11 access occurred.

Task 10 fix round 3/5: 1 Important finding addressed, pending re-review.
Task 10 fix round 3 behavior: ownership-less v1 caches may rebind only when
their canonical snapshot is clean. A non-empty v1 normal outbox now fails
closed visibly with byte-identical retained storage, zero saves/requests, and
an inert retry. The same small legacy recoverable-work guard covers v1 and v2.
Task 10 fix round 3 gate: RED was 2 failures / 28 passes; GREEN was 2 focused
files / 30 tests and then 3 focused files / 42 tests after updating the prior
clean-cache publication fixture. Root typecheck and 56 files / 444 tests pass;
9 mobile files / 84 tests and the 589-module mobile production build pass.
Electron arm64 packaging, Android sync, and Android debug/release unit tests
plus lint with Android Studio JDK 21 pass. Exact-`chu_test` integration and
inherited E2E boundaries remain unchanged. No NAS/DSM/CH Nota/Task 11 access
occurred.

Task 10 fix round 4/5: 1 Important finding addressed, pending re-review.
Task 10 fix round 4 behavior: the `upgrade-required` ownership-refusal state
now blocks every audited public network bypass with a visible typed
`UPGRADE_REQUIRED` error. Pending Nota flush, retry, and authenticated cached
image fetch issue zero network requests and preserve the original cache bytes.
Normal initialization/bootstrap and revoked-device reapproval remain intact.
Task 10 fix round 4 gate: RED was 2 failures / 14 passes; GREEN was 3 focused
files / 40 tests. Root typecheck and 56 files / 445 tests pass; 9 mobile files
/ 84 tests and the 589-module mobile build pass; Electron arm64 packaging,
Android sync, and Android debug/release unit tests plus lint with Android
Studio JDK 21 pass. Exact-`chu_test` integration and inherited E2E boundaries
remain unchanged. No NAS/DSM/CH Nota/Task 11 access occurred.
Task 10 complete: commits `1c67e68..ed558fe`, final scoped re-review approved
with 0 Critical/Important findings. Controller rerun passed 43 focused tests;
the environmental exact-`chu_test` and Task 11 E2E harness gates remain open.

Task 11 initial complete: local E2E provisioning, truthful Core/demo copy,
host-network/loopback container artifacts, bounded dump/checksum/scratch
restore scripts, guarded NAS deployment and backup/restore runbooks, and
truthful README are implemented pending scoped review.
Task 11 gate: 56 root files / 449 tests; 9 mobile files / 85 tests; 43 server
files / 284 tests plus 1 intentional workbook skip; exact approved workbook
1/1; Playwright 8/8; root/server typecheck and server/mobile builds; Electron
darwin-arm64 package; Android sync/debug+release unit tests/lint with Android
Studio JDK 21; script syntax and diff checks passed.
Task 11 environmental gates: exact isolated `/chu_test` integration fails
closed with 3 suites rejecting absent configuration and 10 tests skipped;
Docker Compose config and ARM64 image build are unrun because local `docker`
is unavailable. All physical/NAS gates remain blocked and unchanged.
Task 11 boundary: no NAS, DSM, SMB, router, Tailscale, certificate, physical
client, MariaDB instance, or CH Nota access/change/deployment occurred.

Task 11 fix round 1/5: all 6 Important findings addressed, pending scoped
re-review. Core mobile no longer exposes or invokes demo price simulation.
Core/demo invoice, price-history, SKU-detail, and archive copy is truthful.
Database operations now use an opt-in, bounded `ch-core-ops` profile and
separate Node 24 ops image with MariaDB clients; the normal runtime retains
only its private writable bind and no backup client/scripts. Both services use
the same explicit nonzero numeric DSM service UID/GID, validated before any
app/client command. Dump output is a mkdir-reserved completed bundle; verify
rejects incomplete/extra/symlink/mismatch state. Restore derives only an
existing empty `chu_restore_[a-z0-9_]+` schema from its separate scratch-only
URL, rejects broad grants, never creates/drops schemas, and requires a NEW name
after a partial import.
Task 11 fix round 1 gate: UI RED 3 then GREEN 2 files / 39 tests; operations
RED 10/11 then GREEN deployment/runbook 2 files / 20 tests. Full gate passes:
56 root files / 452 tests; 9 mobile files / 87 tests; 43 server files / 293
tests plus 1 intentional workbook skip; exact workbook 1/1; Playwright 8/8;
root/server typecheck and server/mobile builds; Electron darwin-arm64 package;
Android sync/debug+release unit tests/lint with Android Studio JDK 21; shell
syntax and diff checks. Exact `/chu_test` remains fail-closed (3 suites, 10
skips) and Docker Compose/ARM64 remains unrun because `docker` is unavailable.
No NAS/DSM/SMB/router/Tailscale/certificate/physical client/MariaDB instance/
CH Nota access, change, or deployment occurred.

Task 11 fix round 2/5: 4 Important findings addressed, pending scoped
re-review. Demo Nota completion is explicitly local-session-only while Core
completion retains shared/pending-sync copy; Empty Stock distinguishes Core
data from Demo preview. Compose now uses separate explicit runtime and ops
credential allowlists with no shared `env_file`. All database bundle entry
points require exactly one safe direct `/backup/<name>.bundle` child under a
canonical non-symlink root and reject root/outside/traversal/nested/unsafe
names plus symlink roots/targets.
Task 11 fix round 2 gate: UI RED 2/24 then GREEN 3 files / 24 tests;
deployment RED 2/15 then GREEN 1 file / 15 tests. No NAS, DSM, SMB, router,
Tailscale, certificate, physical client, MariaDB instance, CH Nota, or
replacement workbook access/change/deployment occurred.
Task 11 complete: commits `f2d268e..3b01276`; final scoped re-review approved
with 0 Critical/Important findings.
Task 11 approval gate: reviewer reran UI 24/24, deployment artifacts 15/15,
root typecheck, all shell syntax checks, and the full Task 11 diff check.
Docker/Compose, exact isolated `/chu_test`, NAS, certificate, and physical
client gates remain environmental and no deployment occurred.
Task 11 controller final gate after approval: 56 root files / 453 tests;
9 mobile files / 88 tests; 43 server files / 295 tests plus 1 intentional
workbook skip; exact approved workbook 1/1; mobile build; Electron package;
Playwright 8/8; Android sync/debug+release unit tests/lint with Android Studio
JDK 21; diff check; clean worktree before this receipt.
Post-Task 11 acceptance audit 2026-07-31: local Mac has no Docker/Compose,
Podman, OrbStack, MariaDB server, or equivalent runtime. Windows x64
cross-package and ZIP succeed; Squirrel installer creation remains blocked
without Mono/Wine or a Windows build host and is not physically tested.
Android release creation fails closed on the four intentionally absent
signing variables and no unsigned artifact is accepted. Requirement-by-
requirement evidence and owner decisions are recorded in
`docs/ch-core-acceptance-status.md`; focused runbook gate passes 8/8.
