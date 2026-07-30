# Task 11 Brief: Local Deployment Package, E2E Harness, and Runbooks

## Scope and hard boundary

Implement the final local-only packaging and operations slice from
`docs/superpowers/plans/2026-07-29-ch-core-nas-sync.md`.

Do not access or change DSM, SMB, the router, Tailscale, MariaDB on the NAS,
certificates on the NAS, or any physical client. Do not claim deployment,
Windows installation, Android signing/physical verification, backup, restore,
UPS, SMART, load, or LAN-isolation success. Those remain physical/NAS gates.

The approved replacement workbook remains:

`/Users/hamlet/Downloads/SKU_Gudang20260730092414031.xlsx`

SHA-256:

`64fcb734d84462060f76fa7f27495ee1e2dff6201ad2d7a2d13d5c6c27923817`

## Slice 1: Explicit test-only Electron E2E provisioning

Touch only:

- `src/main.ts`
- `src/renderer/main.tsx`
- existing desktop bootstrap/startup tests
- `tests/e2e/app.spec.ts`
- `tests/e2e/share-recommendations.spec.ts`
- a small E2E helper if it removes duplicate launch logic

Behavior:

- The existing Playwright UI scenarios must run against an explicit mock
  gateway only when the unpackaged Electron process is launched with a
  dedicated E2E environment flag.
- `app.isPackaged === true` must ignore/refuse that flag. A packaged app must
  never silently enter mock/demo mode.
- The renderer may accept the test mock only when the main process added an
  unforgeable-by-normal-navigation marker to its locked renderer URL and the
  renderer selects `mode: 'test'`, `allowTestMock: true`, and an explicit
  `MockOperationsGateway`.
- Keep the demo badge visible in E2E mode.
- Production/unpaired startup must remain fail closed.
- Do not weaken context isolation, sandboxing, navigation blocking, IPC sender
  checks, certificate checks, or token boundaries.

TDD:

- RED packaged-with-flag test proves no test marker/mock path.
- RED unpackaged-with-explicit-flag test proves the marker is added.
- RED renderer bootstrap test proves only that exact marker selects the test
  mock; ordinary development and production paths remain Core/connection
  paths.
- Run focused startup/bootstrap tests, package, then `npm run test:e2e`.

## Slice 2: Truthful production/runtime copy without redesign

Touch only the smallest components containing stale demo/session claims.
Prefer existing `coreBacked` props or `gateway.capabilities.canResetDemoData`
instead of a new global runtime abstraction.

Desktop targets:

- `src/renderer/App.tsx`
- `src/renderer/pages/SettingsPage.tsx`
- `src/renderer/pages/CreateSkuPage.tsx`
- `src/renderer/pages/RevenuePage.tsx`
- `src/renderer/pages/SkuChangesPage.tsx`
- `src/renderer/nota/NotaWorkspace.tsx`
- `src/renderer/nota/CompleteNotaDialog.tsx`
- other exact stale labels found by focused search

Mobile targets:

- pass the existing `coreBacked` signal into Nota/archive/dashboard/more and
  recommendation sharing where necessary
- remove `FRONTEND DEMO`, `SESSION ONLY`, and demo PDF/share metadata only in
  Core-backed native runtime
- retain honest demo labels in browser/test mock mode

Behavior:

- Core-backed desktop/mobile says CH Core/NAS, synchronized devices, and
  central stock/omzet where true.
- Demo/test mode remains clearly marked and keeps its session-only warnings.
- The local revenue-view password may still be described as local/session
  access control, but Core-backed business data must not be described as
  disappearing on reload.
- Printing remains explicitly unavailable; do not claim it.
- Settings must not offer demo reset in Core mode.
- Do not copy the desktop layout onto mobile.

TDD:

- Extend existing core/demo UI tests rather than creating broad snapshots.
- Search the production Core-backed paths for stale demo/session claims.
- Run focused desktop/mobile UI tests, full root/mobile tests, and builds.

## Slice 3: Container and offline operations artifacts

Touch/create:

- `server/Dockerfile`
- `server/compose.yaml`
- `server/.env.example`
- `server/scripts/` for bounded dump, checksum verification, scratch restore,
  and health checks
- focused static/script tests under `server/test/`

Behavior:

- Preserve Node 24 multi-arch build, non-root runtime, read-only root FS,
  256 MiB memory, 160 MiB Node heap, 0.75 CPU, four DB connections, bounded
  logs, dropped capabilities, no privileged mode.
- Give `/var/lib/ch-core/private` one explicit writable host bind mount; no
  other writable application path.
- The raw API must bind only to NAS loopback on port 18080.
- Because the Synology MariaDB package is required to remain loopback-only,
  use/document the one network mode that lets the non-root container reach
  host loopback without exposing the raw API. Do not publish a bridge port in
  that mode.
- Add a local healthcheck without adding curl solely for health checks.
- `.env.example` contains placeholders only, no secrets or live credentials.
- Dump scripts never put passwords in arguments/output, require explicit
  destination paths, write SHA-256 sidecars atomically, and never overwrite an
  existing dump.
- Restore rehearsal targets only an explicitly named scratch database and
  refuses production-like names. It verifies checksum first and never drops or
  overwrites the production schema.
- Migration remains startup-serialized by the existing advisory lock. Provide
  a bounded pre-migration dump/rollback procedure; do not invent down
  migrations.
- Scripts are shellchecked by careful construction even if shellcheck is not
  installed; add executable bits and deterministic static tests.

Smallest verification:

- server config/static tests
- server typecheck/test/build
- `docker compose config` and ARM64 image build only if a local Docker daemon
  is actually available; otherwise record the environmental gate truthfully.

## Slice 4: Deployment and backup/restore runbooks

Create:

- `docs/ch-core-nas-deployment.md`
- `docs/ch-core-backup-restore.md`

Rewrite the stale top-level boundary in:

- `README.md`

Deployment runbook must record the authenticated read-only preflight already
confirmed:

- DS223j, DSM 7.4.1-90080, RTD1619B 4-core 1.7 GHz, 1 GB RAM
- DHCP `192.168.1.14/24`, MAC `90:09:D0:9F:7C:1F`
- healthy RAID1, healthy Btrfs Volume 1, approximately 1.7 TB total / 6.7 GB
  used
- both ST2000VN003 drives healthy at 38C/40C, but no SMART self-test logs
- Container Manager 24.0.2-1606 installed/current, no containers
- MariaDB 10 absent, Hyper Backup absent, UPS absent/disabled
- firewall disabled, reverse proxy empty
- sample swap 532.4 MB / 2 GB (26%), current swap I/O 0 KB/s

It must prominently block deployment until:

- router reservation `90:09:D0:9F:7C:1F -> 192.168.1.14`
- explicit SMART tests
- independent encrypted backup, integrity check, and clean scratch restore
- UPS
- MariaDB/package/loopback decision
- private CA and leaf certificate with `192.168.1.14` IP SAN
- DSM firewall and reverse proxy
- resource/load gates

Security procedure:

- private CA signing key generated/stored off-NAS; NAS gets leaf key/cert only
- DSM reverse proxy LAN HTTPS 8443 -> loopback 18080
- allow business LAN IPv4/IPv6 only; deny guest/WAN/Tailscale for 8443
- preserve Tailscale administration for DSM 5001 and SMB 445 only
- no QuickConnect dependency, Serve/Funnel, router forwarding, UPnP, SSH
  dependency, raw API exposure, or MariaDB exposure
- owner pairing, recovery credential, device approval/revocation, token
  rotation, certificate renewal, upgrade/rollback, seven-client soak

Backup/restore runbook:

- Hyper Backup target must be independent from the RAID1 pool
- include database logical dump plus private files, hashes, configuration,
  certificate leaf material, and versioned deployment artifacts
- never back up the private CA signing key to the NAS
- clean restore to scratch schema/path first; compare SKU count, stock ledger,
  completed Nota, omzet, audit rows, change cursor, and image references
- production remains blocked until the drill passes

README:

- describe the current Core-backed architecture and explicit test/demo mode
- keep unfinished physical/deployment gates truthful
- retain developer verification commands and workbook identity

## Slice 5: Final local verification and report

Run:

```bash
npm run verify
npm run test:mobile
npm run mobile:build
npm run package
npm run test:e2e
npm run server:test
npm run server:test:integration
npm run android:sync
npm run android:test
npm run android:lint
git diff --check
```

Use Android Studio JDK 21:

`/Applications/Android Studio.app/Contents/jbr/Contents/Home`

and SDK:

`/Users/hamlet/Library/Android/sdk`

`server:test:integration` must remain fail closed unless
`CH_CORE_TEST_DATABASE_URL` points to exact isolated `/chu_test`. Never point
it at production or an arbitrary schema.

Also:

- run the exact approved workbook acceptance test
- verify no secrets/private keys/dumps/certificates are tracked
- verify packaged/test-only mock boundary
- create `task-11-report.md`
- update `progress.md`
- commit local Task 11 implementation as
  `docs: add CH Core deployment and operations runbook`

Do not claim the plan fully complete. Physical Windows/Android, signed release,
NAS changes, backup/restore, UPS/SMART, LAN isolation, reboot, one-hour
seven-client soak, and p95/resource gates remain for the guarded deployment
phase.
