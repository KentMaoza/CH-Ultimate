# CH Ultimate

CH Ultimate contains the Windows Electron client, Android/Capacitor client,
and CH Core service for Toko CH operations.

```text
Windows/Android → LAN HTTPS → Node API → MariaDB 10
```

CH Core is authoritative for SKU, stock movements, templates, Nota,
posting/omzet, device identity, audit, and ordered synchronization. Windows
and Android keep their own platform-appropriate interfaces. Foreground clients
poll every two seconds and after writes/resume. Limited offline support is
restricted to a new local Nota and signed stock deltas; existing shared data
is read-only offline.

## Current boundary

A copied-data CH Core runtime is deployed on the NAS and is available through
LAN HTTPS. It is not a production endpoint: the catalogue has not been
imported and no Windows or Android client has been enrolled. Production gates
still include stable addressing, completed SMART tests, an independent backup
and clean restore, UPS signaling, reboot/isolation checks, physical client
pilots, and the seven-client resource/load soak.

QuickConnect and Tailscale are for DSM/SMB administration only. The CH Core
API must remain reachable only from the business LAN at
`https://192.168.50.14:8443/v1`; it must never use QuickConnect, Tailscale
Serve/Funnel, router forwarding, or UPnP.

See:

- [NAS deployment runbook](docs/ch-core-nas-deployment.md)
- [Backup and clean-restore runbook](docs/ch-core-backup-restore.md)
- [API v0.2 maintenance and rollback runbook](docs/ch-core-v0.2-maintenance-rollback.md)
- [CH Core acceptance status](docs/ch-core-acceptance-status.md)

Physical printing acceptance is still open. Automatic client updates,
Internet/remote CH Core access, and recurring BigSeller synchronization are not
implemented.

## Runtime modes

Packaged desktop and native Android startup fail closed when CH Core is
unconfigured, unpaired, untrusted, revoked, or incompatible. Tokens stay in
Electron safeStorage or Android Keystore and do not enter renderer/WebView
JavaScript.

The mock gateway is an explicit test-only mock. Electron E2E can enable it
only in an unpackaged process with the dedicated test flag and locked renderer
URL marker. Packaged apps ignore that flag. Browser/mobile development demo
mode remains visibly marked as demo/session-only and cannot be mistaken for
the Core-backed runtime.

## GitHub pilot distribution

`.github/workflows/pilot-release.yml` defines a gated GitHub prerelease. The
repository is currently public; do not treat release links or source as private.
After all source and guarded publication gates pass, its exact installable
payload names are:

- `CH-Ultimate-0.2.3-Setup.exe` for Windows x64
- `CHU-Companion-Mobile-0.2.3-release.apk` for Android

Prerelease `pilot-v0.2.3` is the next guarded publication target. It supersedes
v0.2.2 because the v0.2.2 tag predates safe catalogue reconciliation. This does
not prove either client works on a physical device. Publication requires the
permanent Android pilot signer and its pinned digest; the four signing secrets
fail closed. A debug APK is verification-only and is never published. Windows
remains unsigned without Authenticode. Install only while connected to the
`CH-Business` Wi-Fi. The owner removed the four-day copied-data pilot from this
execution. See the
[v0.2.3 pilot notes](docs/releases/pilot-0.2.3.md) and the
[v0.2 maintenance runbook](docs/ch-core-v0.2-maintenance-rollback.md).

## Approved initial catalogue

The authoritative workbook for the guarded first import is:

`/Users/hamlet/Downloads/SKU_Gudang20260804080716145.xlsx`

SHA-256:

`f1f4675327fac107ef9f78c114b8afe86389d5543b204540ed45e74f9b15e49c`

Acceptance is 3,144 products, 6,288 identifiers, 2,786 image jobs, 358
missing images, three price mismatches for review, selected-price total
Rp276,285,615, and stock total 3,988 PCS. The owner desktop stages and previews
the workbook before one transactional commit. Replaying the same hash is
idempotent.

## Development

Install dependencies:

```bash
npm install
```

The normal desktop start uses the Core connection flow:

```bash
npm start
```

Do not set the Electron E2E mock flag for normal development or packaging.

## Verification

```bash
npm run verify
npm run test:mobile
npm run mobile:build
npm run package
npm run test:e2e
npm run server:test
npm run server:typecheck
npm run server:test:integration
npm run android:sync
npm run android:test
npm run android:lint
git diff --check
```

Android native checks require Android Studio JDK 21 at
`/Applications/Android Studio.app/Contents/jbr/Contents/Home` and SDK
`/Users/hamlet/Library/Android/sdk`.

`server:test:integration` intentionally fails closed unless
`CH_CORE_TEST_DATABASE_URL` points to the exact isolated `/chu_test` schema.
Never point it at production or an arbitrary database.

Local Docker/Compose and ARM64 image verification require an available Docker
daemon. A successful local build is not a NAS deployment receipt.

## Server package

`server/compose.yaml` uses host networking for DSM reverse-proxy access and
binds the Synology MariaDB Unix socket read-only without enabling MariaDB TCP.
CH Core binds to `127.0.0.1:18080`; DSM reverse proxy currently exposes it as
LAN HTTPS 8443. The container is non-root,
read-only, resource-bounded, and has one persistent writable private-file
mount.

Both runtime and one-off operations use the same explicitly configured
nonzero numeric DSM service UID/GID. The dedicated `ch-core-ops` Compose
profile contains the MariaDB clients and committed backup scripts; it does not
run by default and has one explicit backup bind. The normal runtime image does
not contain those database operations tools.

Copy `server/.env.example` to an untracked `.env` only in an approved
deployment staging area. Backup and scratch restore use separate
least-privilege database URLs. Dumps are completed directory bundles rather
than replaceable single files. Never commit credentials, database dumps,
private keys, leaf certificates/private material, or live configuration. The
public client-trust CA certificate is intentionally tracked for the pilot.

## Main business behavior

- Integer rupiah and quantities; one LSN equals 12 PCS.
- Negative stock is allowed and audited through immutable signed movements.
- Nota completion atomically posts Nota state, stock movements, omzet, audit,
  change event, and idempotency receipt.
- Recompletion posts only differences; cancellation adds reversals.
- Different Nota fields/lines merge; same-target edits produce explicit
  mine/server conflicts.
- Every mutation is installation-authenticated, versioned, payload-hashed, and
  idempotent.
- Production demo reset is unavailable.
