# Task 11 report: local deployment package, E2E harness, and runbooks

## Status

DONE_WITH_ENVIRONMENTAL_GATES

Local-only implementation and verification are complete. No NAS, DSM, SMB,
router, Tailscale, certificate, physical client, MariaDB instance, or CH Nota
path was accessed or changed. Nothing was deployed.

## Slice 1: explicit test-only Electron E2E provisioning

RED:

- Unpackaged explicit E2E launch did not add the locked renderer marker.
- Renderer with the exact marker still selected development/Core startup.

GREEN:

- `CH_ULTIMATE_E2E_TEST_MOCK=1` is honored only when
  `app.isPackaged === false`.
- Main adds `?ch-ultimate-e2e-test-mock=1` to the locked full renderer URL.
  IPC sender and navigation checks use that exact URL.
- Renderer selects `mode: 'test'`, `allowTestMock: true`, and an explicit
  `MockOperationsGateway` only on the marked URL. It omits the real preload
  bridge only there.
- Packaged-with-flag startup retains production Core mode with no marker/mock.
- Browser/test mock keeps the demo badge.
- Focused result: 3 files / 10 tests; root typecheck; Electron arm64 package;
  Playwright 8/8.

## Slice 2: truthful runtime copy

RED:

- Core desktop still claimed session-only/frontend-only/no storage/reset.
- Core mobile still claimed Mode Demo/FRONTEND DEMO/SESSION ONLY.
- Native recommendation sharing ignored requested Core metadata.

GREEN:

- Core desktop labels central CH Core/NAS storage, Node API/MariaDB,
  synchronized SKU/Nota, and central stock/omzet. Reset is hidden in Core
  mode.
- Local revenue password is described as local access control without saying
  central business data disappears.
- Core mobile labels dashboard, Nota, archive, history, and recommendation
  sharing as CH Core/synchronized.
- Demo/browser/test paths preserve visible demo/session warnings.
- Printing remains explicitly unavailable.
- Focused result: 5 files / 59 tests, then 8 files / 81 tests.
- Full root: 56 files / 449 tests. Mobile: 9 files / 85 tests. Typecheck and
  589-module mobile production build passed.

## Slice 3: container and offline operations artifacts

RED:

- Existing Compose published a bridge port, lacked host networking/private
  bind, and used non-loopback defaults.
- Dockerfile had no local Node healthcheck.
- No bounded dump, checksum, scratch restore, or health scripts existed.
- Added safety regressions caught a scratch-name metacharacter bypass and a
  decoded-control-character credential path before database invocation.

GREEN:

- Compose uses host networking; CH Core is fixed to
  `127.0.0.1:18080`, publishes no port, and can reach host-loopback MariaDB.
- Root filesystem is read-only. `/var/lib/ch-core/private` is the only
  persistent writable application bind; `/tmp` remains bounded tmpfs.
- Non-root Node 24 runtime retains 256 MiB memory, 160 MiB heap, 0.75 CPU,
  four DB connections, bounded logs, no-new-privileges, and all capabilities
  dropped.
- Node performs the local readiness healthcheck without curl.
- Compose passes an explicit credential allowlist: runtime receives only its
  application URL/bootstrap secret, while the opt-in ops service receives only
  backup/restore URLs. The services do not share an `env_file`.
- Dump accepts exactly one safe direct `/backup/<name>.bundle` child under a
  canonical non-symlink `/backup` root. It reserves that directory with
  `mkdir`, never supplies passwords as arguments/output, uses a mode-0600
  temporary defaults file, writes the dump and SHA-256 sidecar, then publishes
  `COMPLETE` last without replacement or recursive cleanup.
- Restore verifies the completed bundle first, accepts only an already
  existing empty URL-derived lowercase `chu_restore_*` schema with constrained
  grants, and never creates, drops, or overwrites a schema.
- Deployment artifact result: 15/15. All scripts pass `sh -n`.
- Server source/test typecheck, 284 unit tests plus one intentional workbook
  skip, and server build passed.
- Docker/Compose/ARM64 runtime verification was not run because `docker` is
  not installed locally (`command not found`).

## Slice 4: deployment and restore documentation

RED:

- Both runbooks were absent and README still described a frontend-only demo.

GREEN:

- Deployment runbook records all authenticated DS223j/DSM/storage/disk/
  package/power/firewall/reverse-proxy/resource facts.
- It blocks deployment on reservation, SMART, independent backup and clean
  restore, UPS, MariaDB loopback, off-NAS private CA/IP SAN leaf, DSM
  firewall/reverse proxy, and resource/load gates.
- Security procedure permits LAN HTTPS 8443 only, keeps 18080/3306 loopback,
  and denies guest/WAN/QuickConnect/Tailscale/Serve-Funnel/forwarding/UPnP.
- Backup runbook requires an independent encrypted Hyper Backup destination,
  logical dump, private files/hashes/config/leaf material/versioned artifact,
  and clean scratch comparisons for SKU, stock ledger, completed Nota, omzet,
  audit, change cursor, and image references.
- Private CA signing key is explicitly excluded from the NAS backup.
- README states current Core architecture, explicit test-only demo boundary,
  approved workbook identity, verification commands, and unfinished
  physical/NAS gates.
- Static result: 4/4.

## Review fix round 1/5

Six Important findings were addressed, pending scoped re-review:

1. Core-backed Android no longer renders the demo-only price simulation
   control. It passes no simulation handler, and the internal function returns
   before `updateSku` when `coreBacked` is true. Browser/test demo retains the
   simulation.
2. Database operations now run only in a dedicated Node 24 `ops` image target
   containing `mariadb-client` and the committed scripts. The normal runtime
   does not include the client or backup scripts.
3. `ch-core-ops` is an opt-in Compose profile with host networking, no
   published ports, read-only root, dropped capabilities,
   no-new-privileges, bounded resources/tmpfs/logs, and one explicit backup
   bind. It does not run by default.
4. Dump and restore credentials are separate. Backup accepts only a read-only
   URL targeting `/chu`. Restore accepts only a scratch-only URL whose path
   matches `chu_restore_[a-z0-9_]+`; it verifies the schema already exists,
   is empty, and has no global/other-schema/role/proxy grants. The scripts
   contain no production/scratch `CREATE DATABASE` or `DROP DATABASE` path.
5. Dump output is a `mkdir`-reserved new bundle containing mode-0600
   `dump.sql`, `dump.sql.sha256`, and `COMPLETE` published last. Verification
   rejects incomplete, extra, symlinked, invalid-marker, or checksum-mismatch
   bundles. A partial restore explicitly requires reviewed DBA cleanup and a
   NEW scratch name.
6. Runtime and ops use the same explicit nonzero numeric DSM service UID/GID.
   The entrypoint rejects zero, nonnumeric, missing, or mismatched identity
   before app/client commands. The runbook requires one restricted DSM service
   user, bounded Task Scheduler UID/GID receipt, exact private/backup ACLs, and
   create/write/delete mount probes while keeping both roots read-only.

Truthful copy was also corrected for Core invoice templates, mobile price
history/SKU detail, and Core-versus-demo archive scope.

RED evidence:

- UI matrix: 3 expected failures for Core simulation, Core price scope, and
  Core invoice copy.
- Operations artifacts: 10 expected failures / 1 existing invariant pass.
- Runbook matrix: 3 expected failures, followed by one exact-command
  preflight failure after tightening the specification.

GREEN focused evidence:

- UI: 2 files / 39 tests.
- Deployment artifacts and runbooks: 2 files / 20 tests.
- Shell syntax and root typecheck pass.

## Review fix round 2/5

Four Important findings were addressed, pending scoped re-review:

1. Demo/browser Nota completion now says it is stored only in the local demo
   session. Only Core-backed completion claims shared-device availability or
   pending central synchronization.
2. Empty Stock labels `Demo preview` only in demo mode; Core mode identifies
   CH Core data and does not claim that PDF export exists.
3. Compose no longer shares one `env_file`. Runtime and opt-in ops services
   receive separate explicit credential allowlists.
4. Dump, verification, and restore scripts all require exactly one safe direct
   `/backup/<name>.bundle` child, reject root/outside/traversal/nested/unsafe
   names, and reject symlink roots or targets.

RED evidence:

- UI: 2 expected failures / 22 passes for stale demo Nota and Core Empty Stock
  copy.
- Deployment artifacts: 2 expected failures / 13 passes for shared Compose
  environment and missing strict backup-path policy.

GREEN focused evidence:

- UI: 3 files / 24 tests.
- Deployment artifacts: 1 file / 15 tests.

## Final local verification

| Gate | Result |
| --- | --- |
| Exact approved workbook acceptance | PASS — 1/1; SHA-256 and exact 3,144 / 2,786 / 358 / 3 / Rp276,267,011 / 4,115 PCS |
| `npm run verify` | PASS — 56 files / 452 tests |
| `npm run test:mobile` | PASS — 9 files / 87 tests |
| `npm run mobile:build` | PASS — 589 modules |
| `npm run package` | PASS — Electron darwin-arm64 package |
| `npm run test:e2e` | PASS — 8/8 |
| `npm run server:test` | PASS — 43 files / 293 tests, 1 intentional workbook skip |
| `npm run server:test:integration` | FAIL-CLOSED — no exact isolated `/chu_test`; 3 suites rejected configuration and 10 tests skipped |
| `npm run android:sync` | PASS with Android Studio JDK 21 and local SDK |
| `npm run android:test` | PASS — debug and release JVM tests |
| `npm run android:lint` | PASS — BUILD SUCCESSFUL |
| `git diff --check` | PASS |
| Secret/private artifact scan | PASS — no tracked live `.env`, private key, certificate, dump, or dump checksum |
| Docker Compose config / ARM64 image | NOT RUN — local `docker` command unavailable |

Known non-failing warnings remain the existing Vite CJS deprecation/large
chunk and Gradle `flatDir` warnings.

## Remaining guarded deployment gates

- Exact isolated `chu_test` MariaDB integration.
- Docker Compose config and ARM64 image/runtime verification.
- Router reservation, SMART tests, independent encrypted backup/integrity/
  clean restore, UPS, MariaDB package/loopback setup, private CA/IP-SAN leaf,
  DSM firewall, and reverse proxy.
- Windows installers on both laptops.
- Signed Android release on physical phones.
- Owner/recovery/device enrollment and revocation.
- LAN-only isolation, wrong/expired certificate, reboot, UPS, and restore
  acceptance.
- 24-hour two-device pilot, one-hour seven-client soak, and p95/resource
  thresholds.

The full project plan is not production-complete until those physical/NAS
gates pass.
