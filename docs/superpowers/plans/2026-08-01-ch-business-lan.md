# CH Business LAN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` to implement this plan task-by-task.

**Goal:** Move the copied-data CH Ultimate pilot from the conflicted household
address `https://192.168.1.14:8443` to the isolated CH Business LAN endpoint
`https://192.168.50.14:8443`, while preserving fail-closed client trust and the
existing private CA.

**Architecture:** FiberHome remains the household/upstream router. The
EW3000GX-PRO becomes the CH router with LAN `192.168.50.1/24`, dynamic clients
in `192.168.50.100-199`, and the wired NAS manually fixed at
`192.168.50.14`. Windows and Android accept only the exact CH Core origin.
The CA stays unchanged; a new off-repository leaf certificate covers the new
IP. No database schema or CH Core API changes are allowed.

**Tech Stack:** Electron/TypeScript/Vitest, Android/Java/JUnit, GitHub Actions,
Synology DSM reverse proxy/firewall, Reyee EW3000GX-PRO.

## Global Constraints

- Work only in an isolated branch based on current `origin/main`.
- Exact public client origin: `https://192.168.50.14:8443`.
- Exact old origin eligible for one-time desktop migration:
  `https://192.168.1.14:8443`.
- Client endpoint policies accept only host `192.168.50.14`, HTTPS, port 8443,
  no credentials, path, query, or fragment.
- The existing public CA remains byte-for-byte unchanged. Never commit any CA
  private key, leaf private key, database credentials, device token, router
  password, or recovery credential.
- Desktop migration may rewrite only the exact old canonical two-key config
  whose `caFile` equals the expected user-data CA path. Unknown, custom,
  malformed, or extra-key configs remain untouched and fail closed.
- No API route, schema, database migration, Internet access, QuickConnect,
  Tailscale access, UPnP, port forward, or production-readiness claim.
- Historical release notes and historical Superpowers/SDD evidence are
  immutable. Add v0.1.2 evidence instead of rewriting v0.1.0/v0.1.1 history.
- Dense runbooks are edited in section-scoped slices with focused verification
  after each slice.
- Do not run MariaDB integration tests against the NAS or any schema other than
  exact isolated `/chu_test`.

---

### Task 1: Move client trust to the exact CH Business endpoint

**Files:**
- Modify: `src/electron/core-api-main.ts`
- Modify: `src/electron/core-packaged-deployment.ts`
- Modify: `resources/ch-core-deployment.json`
- Modify: `android/app/src/main/java/com/tokoch/chucompanion/CoreEndpointPolicy.java`
- Modify: `android/app/src/main/res/values/ch_core_config.xml`
- Modify focused endpoint, deployment, HTTPS, desktop service, mobile adapter,
  and Android security tests.

**Interfaces:**
- `parseCoreEndpointConfig(input)` keeps its shape but accepts only
  `https://192.168.50.14:8443`.
- `ensurePackagedCoreDeployment(input)` keeps its signature and adds a guarded,
  idempotent one-time migration of the exact old canonical config.

- [ ] Write failing tests that accept only `192.168.50.14:8443` and reject the
  old origin, other `192.168.50.x` hosts, other private ranges, malformed
  origins, redirects, paths, and credentials.
- [ ] Write failing packaged-deployment tests for a new install, exact old
  config migration, idempotence, and preservation of custom/malformed/extra-key
  configs and the existing CA.
- [ ] Replace the broad Electron and Android subnet rules with exact host
  equality and update immutable deployment resources.
- [ ] Implement migration with bounded reads and atomic replacement. Preserve
  mode `0o600`; never modify the CA file during migration.
- [ ] Run focused Vitest, Java unit tests, TypeScript checks, and
  `git diff --check`.
- [ ] Commit the task.

### Task 2: Prepare the private v0.1.2 pilot release

**Files:**
- Modify: `package.json`, lockfile, Android version metadata, and the visible
  application version.
- Modify: `.github/workflows/pilot-release.yml`
- Create: `docs/releases/pilot-0.1.2.md`
- Modify: `README.md` and focused release/deployment asset tests.

**Interfaces:**
- Release tag: `pilot-v0.1.2`.
- Windows artifact: `CH-Ultimate-0.1.2-Setup.exe`.
- Android artifact: `CHU-Companion-Mobile-0.1.2-pilot-debug.apk`.

- [ ] Write failing workflow and asset tests for v0.1.2 and the new exact
  endpoint.
- [ ] Bump client/release metadata consistently to 0.1.2.
- [ ] Add installation notes that require `CH-Business`, identify v0.1.0 and
  v0.1.1 as superseded without editing them, preserve fail-closed behavior,
  and retain the Android debug-signer/offline-queue warning.
- [ ] Keep publication manual, private-prerelease, and gated by all source,
  Windows, and Android jobs.
- [ ] Run focused workflow/assets tests, mobile build, Android sync/test/lint,
  TypeScript checks, and `git diff --check`.
- [ ] Commit the task.

### Task 3: Add the cutover, rollback, and acceptance runbooks

**Files:**
- Create: `docs/ch-core-business-lan.md`
- Modify: `docs/ch-core-nas-deployment.md`
- Modify: `docs/ch-core-acceptance-status.md`
- Modify: focused server runbook tests.

**Interfaces:**
- FiberHome LAN: `192.168.1.1/24`.
- EW WAN: DHCP from FiberHome; EW LAN: `192.168.50.1/24`.
- EW DHCP pool: `192.168.50.100-192.168.50.199`.
- NAS: manual IPv4 `192.168.50.14/24`, gateway/DNS `192.168.50.1`, Ethernet
  MAC `90:09:D0:9F:7C:1F`.
- DSM firewall: allow TCP 8443 from `192.168.50.0/24`, then deny TCP 8443 from
  every other source. Internal API remains `127.0.0.1:18080`; MariaDB TCP stays
  disabled.

- [ ] Add a focused runbook test that locks the exact topology, pool, endpoint,
  MAC, firewall order, certificate SAN, disabled exposure paths, reboot test,
  rollback boundary, and seven-client acceptance gate.
- [ ] Write the new runbook with preflight evidence capture, off-NAS verified
  backup, certificate staging, the exact 30-minute cutover order, reconnect
  instructions, isolation checks, and rollback.
- [ ] Surgically update only current-state/forward-looking sections in the two
  dense existing documents. Preserve historical v0.1.0/v0.1.1 evidence.
- [ ] Record the current conflict as unresolved until live cutover evidence
  proves one NAS MAC at `.50.14` across EW and NAS reboots.
- [ ] Run focused server runbook tests, full server tests/typecheck, and
  `git diff --check`.
- [ ] Commit the task.

### Task 4: Stage the new TLS leaf and perform the live network cutover

**Tracked files:** None. Store credentials/private keys outside the repository.

- [ ] Verify an off-NAS backup and checksum before changing the network.
- [ ] Generate a new leaf from the existing private CA with SAN
  `IP:192.168.50.14`; verify the public CA fingerprint is unchanged.
- [ ] Export EW3000 and DSM network/firewall/reverse-proxy/certificate state.
- [ ] Configure EW3000 Router mode, WAN DHCP, LAN `192.168.50.1/24`, pool
  `.100-.199`, `CH-Business`, WPA2/WPA3, no guest LAN access, no UPnP/port
  forwards/WAN administration, and no CH-LAN IPv6 during the pilot.
- [ ] Connect FiberHome LAN to EW WAN; keep NAS on EW LAN. Set the NAS manual
  IPv4 to `.50.14/24` with gateway/DNS `.50.1`.
- [ ] Assign the new leaf to `*:8443`, update the ordered DSM firewall, and keep
  the reverse proxy at `127.0.0.1:18080`.
- [ ] Verify CH Core from `CH-Business`; verify it is unreachable from
  IndiHome, guest/mobile/WAN, QuickConnect, and Tailscale.
- [ ] Reboot EW then NAS and prove `.50.14` remains owned only by
  `90:09:D0:9F:7C:1F`. Roll back exported network settings if the new endpoint
  cannot pass CA-validated health during the maintenance window.

### Task 5: Complete verification and release evidence

- [ ] Run `npm run verify`, `npm run test:mobile`, `npm run mobile:build`,
  `npm run server:test`, `npm run server:typecheck`, `npm run package`,
  `npm run test:e2e`, Android test/lint, and `git diff --check`.
- [ ] Record the new live leaf fingerprint and cutover evidence without
  including secrets.
- [ ] Publish v0.1.2 only after live endpoint acceptance and all source gates
  pass; mark prior private prereleases superseded without deleting evidence.
- [ ] Pilot one Windows and one Android device for 24 hours, then run the
  existing seven-client one-hour soak. Do not call the system production-ready
  while backup/restore, UPS, NAS health, signing, or other recorded gates remain
  open.
