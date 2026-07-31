# CH Core acceptance status

Updated 2026-07-31 WITA. This is an evidence ledger, not a production
deployment receipt. A copied-data CH Core runtime is deployed on the NAS, but
CH Core is not deployed as a production endpoint. The catalogue workbook has
not been imported and no client is enrolled.

Status meanings:

- `PASS`: the named requirement has direct current evidence.
- `READY`: the implementation or reproducible artifact exists, but the
  required target environment has not accepted it.
- `PREPARED`: a validated prerequisite exists but is not yet applied to its
  target environment.
- `PILOT RISK ACCEPTED`: the owner accepted a named copied-data pilot risk
  without satisfying the corresponding production gate.
- `BLOCKED`: a required environment, credential, hardware item, or owner
  decision is absent.

## Local implementation and regression

| Requirement | Status | Current evidence |
| --- | --- | --- |
| Desktop application and gateway | PASS | `npm run verify`: 59 files / 459 tests |
| Mobile application | PASS | `npm run test:mobile`: 9 files / 88 tests |
| CH Core unit and artifact tests | PASS | `npm run server:test`: 44 files / 303 tests plus one intentional workbook skip |
| Approved workbook parser | PASS | Exact SHA-256 and 3,144 / 2,786 / 358 / 3 / Rp276,267,011 / 4,115 PCS acceptance: 1/1 |
| Desktop mock isolation | PASS | Packaged startup fails closed; explicit unpackaged test marker only; Playwright 8/8 |
| Mobile production bundle | PASS | 589-module Vite build and Capacitor Android sync |
| Android JVM and lint gates | PASS | Debug/release unit tests and lint pass with Android Studio JDK 21 |
| Electron package | PASS | Reproducible darwin-arm64 package succeeds |
| Source hygiene | PASS | `git diff --check`, shell syntax, and tracked-secret/private-artifact scans pass |
| Exact MariaDB integration | BLOCKED | The NAS runtime connects through `/run/mysqld/mysqld10.sock`, migrations completed, and `/health/ready` returns `{"status":"ready"}`; the isolated `/chu_test` integration suite and transaction/restart acceptance remain outstanding |
| Docker/Compose and ARM64 image | PASS | Container Manager built the ARM64 image on the DS223j and started one container from project `ch-ultimate-core-d5bb4b6`; the runtime remained up during the post-start checks |

## Client release artifacts

| Requirement | Status | Current evidence |
| --- | --- | --- |
| Private GitHub pilot workflow | PASS | `.github/workflows/pilot-release.yml` run `30625635440` passed source, Windows, Android, and publication jobs on merged commit `fe479f6be82704c7ac7257ba46de45017a362db0` |
| Windows x64 application package | READY | Electron cross-package succeeds and a reproducible Windows x64 ZIP is created |
| Windows Squirrel installer | PASS | GitHub built and published `CH-Ultimate-0.1.0-Setup.exe`; a fresh authenticated download matched its published SHA-256 and was identified as a Windows PE32 GUI executable |
| Two Windows laptop installations | BLOCKED | Windows package is not tested on either physical laptop |
| Android debug/release code checks | PASS | Gradle unit tests and lint pass |
| Android pilot debug APK | PASS | GitHub built and published `CHU-Companion-Mobile-0.1.0-pilot-debug.apk`; a fresh authenticated download matched its SHA-256 and passed `apksigner` v2 verification with exactly one Android Debug signer |
| Android release signing | BLOCKED | Owner deferred creation of the permanent signing identity; release builds continue to fail closed without the four private signing variables |
| Signed Android APK | BLOCKED | No release key or signed APK exists; development/debug builds are not treated as production releases |
| Physical Android installation | BLOCKED | Android is not installed on a physical phone; the pilot APK has not yet been built or tested there |

The workflow and Windows ZIP are useful only for target-machine validation;
they do not satisfy physical installation. Likewise, the debug Android pilot
does not satisfy permanent release signing.

### Private pilot release receipt

Private prerelease `pilot-v0.1.0` was published from commit
`fe479f6be82704c7ac7257ba46de45017a362db0` by successful GitHub Actions run
`30625635440`:

- Release: `https://github.com/KentMaoza/CH-Ultimate/releases/tag/pilot-v0.1.0`
- Windows installer: `CH-Ultimate-0.1.0-Setup.exe`, 149,194,240 bytes,
  SHA-256 `fe6c89c5adb2eaa018cd3f5e27494c7847749462eb9414785e720dca982e68ed`
- Android pilot APK: `CHU-Companion-Mobile-0.1.0-pilot-debug.apk`, 46,568,612
  bytes, SHA-256
  `7af5ebcc190266e916ff9e01bf25fd2aa735ff023d40232e32800afdeb3ebe41`
- Android signer certificate SHA-256:
  `6fadcb41eae42b1d90218fca8a72af3f1e3a50817a241372394fec44995a0b28`
- `SHA256SUMS.txt` was downloaded from the release and verified both files
  with the standard macOS `shasum -a 256 -c` command. Its line endings were
  corrected to portable LF, and the workflow was updated to preserve that
  format for future releases.

The release contains exactly these two installers and the checksum manifest.
It remains a copied-data pilot: neither installer has passed installation or
runtime acceptance on a physical Windows laptop or Android phone.

## Workbook owner review

The fixed selection rule uses a positive `Harga Jual Referensi`; otherwise it
uses `Modal Referensi`. On 2026-07-31, owner approval was recorded for the
three selected price differences:

| Excel row | Primary SKU | Modal | Jual selected |
| --- | --- | ---: | ---: |
| 1018 | `PR010215 Pigeon Softouch BPP Nursing Bottle PPSU 160ml Safari Doodles CH058` | Rp338,148 | Rp338,184 |
| 1088 | `PR060522 Pigeon Baby Cologne Rejuv 200ml CH058` | Rp40,440 | Rp25,800 |
| 1180 | `PR050339 Pigeon 2 Way Baby Bibs - Check CH058` | Rp187,320 | Rp183,320 |

The price-review gate is complete. No import has been committed because the
copied-data runtime is not yet an approved production endpoint.

## NAS preflight and deployment gates

Current LAN evidence: the Mac is `192.168.1.18`; the NAS is
`192.168.1.14`, MAC `90:09:D0:9F:7C:1F`. SMB 445 and DSM HTTPS 5001 are
reachable. CH Core HTTPS is available at `192.168.1.14:8443` through the DSM
reverse proxy. The deployed raw API listens only on NAS loopback: the Mac
cannot reach `192.168.1.14:18080`; MariaDB TCP is also unreachable and remains
disabled (`port=0`).

| Requirement | Status | Current evidence or missing action |
| --- | --- | --- |
| Authenticated DSM preflight | PASS | DS223j, DSM 7.4.1-90080, healthy RAID1/Btrfs, and supported Container Manager were confirmed before deployment |
| Reserved LAN endpoint | PILOT RISK ACCEPTED | Owner accepted using DHCP address `192.168.1.14` for the copied-data pilot. This does not pass the production stable-endpoint gate; an address change requires a new IP-SAN leaf, reverse-proxy update, and client reconfiguration |
| Extended SMART tests | BLOCKED | Drive 2 extended test was started and last observed at 10%; Drive 1 is pending and neither drive has a retained completion result |
| Independent encrypted backup | BLOCKED | Owner declined using the connected Seagate disk; no independent backup destination or job exists |
| Backup integrity and clean restore | BLOCKED | No job, integrity receipt, isolated restore schema, or business-invariant comparison exists |
| UPS safe shutdown | BLOCKED | Owner reports external UPS hardware is connected, but DSM recognition, data signaling, shutdown, and restart have not been verified |
| MariaDB 10 socket service | PASS | Package installed; `chu` and least-privilege `chu_app` created; socket login verified at `/run/mysqld/mysqld10.sock`; TCP disabled with `port=0` |
| Restricted service identity and private share | PASS | `ch_core_service` has UID/GID `1027:100`, no DSM login or unrelated share access, and direct read/write only to hidden `CH_Core_Private` |
| Copied-data CH Core runtime | PASS | Project `ch-ultimate-core-d5bb4b6` has one running container; `/health/live` returned `{"status":"ok"}` and `/health/ready` returned `{"status":"ready"}` through NAS loopback |
| Runtime isolation | PASS | Container uses host networking but binds `127.0.0.1:18080`; the Mac cannot connect to raw 18080 or MariaDB 3306; all Linux capabilities are dropped and the root filesystem is read-only |
| Post-start resource sample | READY | Load average `0.51 / 0.71 / 0.86`, `344328 kB` memory available, and `639496 kB` swap used; the one-hour and seven-client soak gates remain open |
| Private CA and IP-SAN leaf | PASS | Encrypted CA key remains off-NAS on the administrator Mac. DSM serves the leaf assigned to `*:8443`; it contains `IP:192.168.1.14`, expires 2027-09-01, and the live SHA-256 fingerprint matches `22:CC:AC:8A:62:DE:C8:22:80:74:56:12:D5:55:18:67:53:BF:E7:BF:EE:17:F8:B9:D5:47:8E:B3:2B:DD:2E:1C` |
| DSM firewall and reverse proxy | PASS | `CH Core LAN` maps HTTPS `*:8443` to `127.0.0.1:18080`. Ordered firewall rules allow TCP 8443 from `192.168.1.0/255.255.255.0` and deny that port from all other sources. LAN CA-validated health passed; DSM 5001 and SMB 445 remained reachable |
| Production CH Core deployment | BLOCKED | The copied-data runtime is not a production endpoint until stable addressing, backup/restore, SMART, UPS, restart, load, isolation-path, and physical-client gates pass |

## Physical acceptance after guarded deployment

The copied-data runtime and LAN HTTPS endpoint exist. Loopback health,
CA-validated LAN health, certificate fingerprint, scoped firewall state, and
raw-port isolation have direct evidence. The remaining items below are still
open unless explicitly marked `PASS`:

- Business Wi-Fi works with Internet disconnected.
- Guest Wi-Fi, mobile data, WAN, QuickConnect, and Tailscale cannot reach
  CH Core 8443. The firewall rule is configured to deny every non-business-LAN
  source, but these separate paths have not all been probed; the administrator
  Mac's Tailscale client was stopped during verification.
- `PASS`: raw 18080 is unreachable from the Mac and MariaDB has no TCP
  listener.
- `PASS`: the correct private CA, IP SAN, and live fingerprint work; a client
  without the private CA failed closed. Dedicated wrong-IP and
  expired-certificate client tests remain open.
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
2. A router reservation was declined. DHCP address `192.168.1.14` is accepted
   for the copied-data pilot only; the stable production endpoint remains
   unresolved.
3. Use of the connected Seagate disk for backup was declined; an independent
   production backup and restore drill remain unresolved.
4. External UPS hardware is reported connected; DSM signaling and safe
   shutdown remain unverified.
5. Android release-signing identity creation is deferred. Development/debug
    builds may continue, but no production Android release may be claimed.
6. Private GitHub Releases will distribute the Windows installer and Android
   debug APK for the copied-data pilot. This does not relax physical-client or
   production acceptance gates.
