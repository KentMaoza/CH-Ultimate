# CH Core acceptance status

Updated 2026-07-31 WITA. This is an evidence ledger, not a production
deployment receipt. CH Core is not deployed and the catalogue workbook has
not been imported.

Status meanings:

- `PASS`: the named requirement has direct current evidence.
- `READY`: the implementation or reproducible artifact exists, but the
  required target environment has not accepted it.
- `BLOCKED`: a required environment, credential, hardware item, or owner
  decision is absent.

## Local implementation and regression

| Requirement | Status | Current evidence |
| --- | --- | --- |
| Desktop application and gateway | PASS | `npm run verify`: 56 files / 453 tests |
| Mobile application | PASS | `npm run test:mobile`: 9 files / 88 tests |
| CH Core unit and artifact tests | PASS | `npm run server:test`: 44 files / 303 tests plus one intentional workbook skip |
| Approved workbook parser | PASS | Exact SHA-256 and 3,144 / 2,786 / 358 / 3 / Rp276,267,011 / 4,115 PCS acceptance: 1/1 |
| Desktop mock isolation | PASS | Packaged startup fails closed; explicit unpackaged test marker only; Playwright 8/8 |
| Mobile production bundle | PASS | 589-module Vite build and Capacitor Android sync |
| Android JVM and lint gates | PASS | Debug/release unit tests and lint pass with Android Studio JDK 21 |
| Electron package | PASS | Reproducible darwin-arm64 package succeeds |
| Source hygiene | PASS | `git diff --check`, shell syntax, and tracked-secret/private-artifact scans pass |
| Exact MariaDB integration | BLOCKED | The NAS `chu` schema and app login exist, but CH Core migrations and integration tests have not yet run against that copied-data pilot; `server:test:integration` still fails closed unless explicitly pointed to isolated `/chu_test` |
| Docker/Compose and ARM64 image | BLOCKED | No Docker, Compose, Podman, OrbStack, or equivalent runtime is installed on this Mac |

## Client release artifacts

| Requirement | Status | Current evidence |
| --- | --- | --- |
| Windows x64 application package | READY | Electron cross-package succeeds and a reproducible Windows x64 ZIP is created |
| Windows Squirrel installer | BLOCKED | Non-Windows build requires Mono and Wine; the installer must preferably be built and then tested on real Windows |
| Two Windows laptop installations | BLOCKED | Windows package is not tested on either physical laptop |
| Android debug/release code checks | PASS | Gradle unit tests and lint pass |
| Android release signing | BLOCKED | Owner deferred creation of the permanent signing identity; release builds continue to fail closed without the four private signing variables |
| Signed Android APK | BLOCKED | No release key or signed APK exists; development/debug builds are not treated as production releases |
| Physical Android installation | BLOCKED | Signed APK is not installed or tested on a physical phone |

The Windows ZIP is useful only for target-machine validation. It does not
satisfy the installer gate. Likewise, a debug or unsigned Android build does
not satisfy release signing.

## Workbook owner review

The fixed selection rule uses a positive `Harga Jual Referensi`; otherwise it
uses `Modal Referensi`. On 2026-07-31, owner approval was recorded for the
three selected price differences:

| Excel row | Primary SKU | Modal | Jual selected |
| --- | --- | ---: | ---: |
| 1018 | `PR010215 Pigeon Softouch BPP Nursing Bottle PPSU 160ml Safari Doodles CH058` | Rp338,148 | Rp338,184 |
| 1088 | `PR060522 Pigeon Baby Cologne Rejuv 200ml CH058` | Rp40,440 | Rp25,800 |
| 1180 | `PR050339 Pigeon 2 Way Baby Bibs - Check CH058` | Rp187,320 | Rp183,320 |

The price-review gate is complete. No import has been committed because CH
Core is not deployed.

## NAS preflight and deployment gates

Current LAN evidence: the Mac is `192.168.1.18`; the NAS is
`192.168.1.14`, MAC `90:09:D0:9F:7C:1F`. SMB 445 and DSM HTTPS 5001 are
reachable. CH Core 8443 and raw API 18080 remain closed/filtered, and MariaDB
TCP is disabled (`port=0`), which is correct before deployment.

| Requirement | Status | Current evidence or missing action |
| --- | --- | --- |
| Authenticated DSM preflight | PASS | DS223j, DSM 7.4.1-90080, healthy RAID1/Btrfs, and supported Container Manager were confirmed before deployment |
| Reserved LAN endpoint | BLOCKED | Owner declined a router reservation; no stable static-address or local-DNS alternative is approved, so the IP-SAN endpoint cannot be finalized |
| Extended SMART tests | BLOCKED | Drive 2 extended test was started and last observed at 10%; Drive 1 is pending and neither drive has a retained completion result |
| Independent encrypted backup | BLOCKED | Owner declined using the connected Seagate disk; no independent backup destination or job exists |
| Backup integrity and clean restore | BLOCKED | No job, integrity receipt, isolated restore schema, or business-invariant comparison exists |
| UPS safe shutdown | BLOCKED | Owner reports external UPS hardware is connected, but DSM recognition, data signaling, shutdown, and restart have not been verified |
| MariaDB 10 socket service | PASS | Package installed; `chu` and least-privilege `chu_app` created; socket login verified at `/run/mysqld/mysqld10.sock`; TCP disabled with `port=0` |
| Restricted service identity and private share | PASS | `ch_core_service` has UID/GID `1027:100`, no DSM login or unrelated share access, and direct read/write only to hidden `CH_Core_Private` |
| Private CA and IP-SAN leaf | BLOCKED | Off-NAS CA custody and `IP:192.168.1.14` leaf are not yet established |
| DSM firewall and reverse proxy | BLOCKED | Firewall is disabled and reverse-proxy list is empty |
| CH Core deployment | BLOCKED | All preceding hard gates must pass first |

## Physical acceptance after guarded deployment

Every item below remains `BLOCKED` until a copied-data pilot exists:

- Business Wi-Fi works with Internet disconnected.
- Guest Wi-Fi, mobile data, WAN, QuickConnect, and Tailscale cannot reach
  CH Core 8443.
- Raw 18080 remains unreachable and MariaDB has no TCP listener.
- Correct certificates work; untrusted, wrong-IP, and expired certificates
  fail closed.
- Foreground changes propagate within three seconds.
- Replay never duplicates Nota, stock, or omzet.
- Concurrent stock deltas survive and Nota merge/conflict rules hold.
- Revoked devices receive 401 and retain but cannot send their queue.
- NAS/API restart and DSM reboot lose no acknowledged transaction.
- UPS shutdown and restart pass.
- Clean restore reproduces catalogue, ledger, Nota, omzet, audit, change,
  and image-reference invariants.
- One Windows laptop and one Android phone pass a 24-hour copied-data pilot.
- Both Windows laptops and the remaining phones are then enrolled.
- The one-hour seven-client soak has no restart or sustained swap; p95 reads
  stay below 500 ms and p95 writes below one second.

If the DS223j fails the resource gate, only the Node service moves to a small
LAN computer; MariaDB and private files remain on the NAS.

## Current owner decisions and unresolved gates

1. The three workbook price selections are approved.
2. A router reservation was declined; a stable LAN endpoint remains unresolved.
3. Use of the connected Seagate disk for backup was declined; an independent
   production backup and restore drill remain unresolved.
4. External UPS hardware is reported connected; DSM signaling and safe
   shutdown remain unverified.
5. Android release-signing identity creation is deferred. Development/debug
   builds may continue, but no production Android release may be claimed.
