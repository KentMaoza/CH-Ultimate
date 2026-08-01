# CH Core acceptance status

Updated 2026-08-01 WITA. This is an evidence ledger, not a production
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

Historical v0.1.0/v0.1.1 release evidence remains retained as historical
evidence. The planned business-LAN cutover does not amend those receipts.

## Local implementation and regression

| Requirement | Status | Current evidence |
| --- | --- | --- |
| Desktop application and gateway | PASS | `npm run verify`: 60 files / 462 tests |
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
| Private GitHub pilot workflow | PASS | `.github/workflows/pilot-release.yml` run `30690226319` passed source, Windows, Android, and publication jobs on merged commit `f8cc18d12f247f645f137a5fcb54143587831fdf` |
| Windows x64 application package | READY | Electron cross-package succeeds and a reproducible Windows x64 ZIP is created |
| Windows Squirrel installer | PASS | GitHub built and published `CH-Ultimate-0.1.1-Setup.exe`; a fresh authenticated download matched its published SHA-256 and was identified as a Windows PE32 GUI executable |
| Two Windows laptop installations | BLOCKED | Windows package is not tested on either physical laptop |
| Android debug/release code checks | PASS | Gradle unit tests and lint pass |
| Android pilot debug APK | PASS | GitHub built and published `CHU-Companion-Mobile-0.1.1-pilot-debug.apk`; a fresh authenticated download matched its SHA-256 and passed `apksigner` v2 verification with exactly one Android Debug signer |
| Android release signing | BLOCKED | Owner deferred creation of the permanent signing identity; release builds continue to fail closed without the four private signing variables |
| Signed Android APK | BLOCKED | No release key or signed APK exists; development/debug builds are not treated as production releases |
| Physical Android installation | BLOCKED | The published pilot APK is not installed or tested on a physical phone |

The workflow and Windows ZIP are useful only for target-machine validation;
they do not satisfy physical installation. Likewise, the debug Android pilot
does not satisfy permanent release signing.

### Private pilot release receipt

Private prerelease `pilot-v0.1.1` was published from commit
`f8cc18d12f247f645f137a5fcb54143587831fdf` by successful GitHub Actions run
`30690226319`:

- Release: `https://github.com/KentMaoza/CH-Ultimate/releases/tag/pilot-v0.1.1`
- Windows installer: `CH-Ultimate-0.1.1-Setup.exe`, 149,241,344 bytes,
  SHA-256 `8bc9ec1014295e9f1dbf2f5df87b842675c09a298ace5d2df384e07cd1907cec`
- Android pilot APK: `CHU-Companion-Mobile-0.1.1-pilot-debug.apk`, 46,610,231
  bytes, SHA-256
  `4c784f6ab13f35797e400e8cd29ed23008f1ec8aed20634c18dc44188ffd04bd`
- Android signer certificate SHA-256:
  `30498d7c313a0ccab1710a3828aa30df87bf96c30114a87fe5f4e05cc27e3103`
- `SHA256SUMS.txt` was downloaded from the release and verified both files
  with the standard macOS `shasum -a 256 -c` command.

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

Current live-readiness evidence on 2026-08-01: the NAS is DHCP
`192.168.1.14/24`, Ethernet MAC `90:09:D0:9F:7C:1F`, at 1 Gbps full duplex.
CA-validated `/health/live` is OK, and the DSM certificate list contains the
old `IP:192.168.1.14` leaf. The DSM Firewall UI currently appears disabled.
Older firewall PASS evidence below is historical, not a current authorization
claim. The live cutover has not happened.

The deployed raw API remains intended for NAS loopback at `127.0.0.1:18080`;
MariaDB TCP remains disabled. The planned target is
`https://192.168.50.14:8443` and is governed by
`docs/ch-core-business-lan.md`, not by this pre-cutover health result.

| Requirement | Status | Current evidence or missing action |
| --- | --- | --- |
| Authenticated DSM preflight | PASS | DS223j, DSM 7.4.1-90080, healthy RAID1/Btrfs, and supported Container Manager were confirmed before deployment |
| Reserved LAN endpoint | PILOT RISK ACCEPTED | Current DHCP `192.168.1.14/24` remains pre-cutover evidence only. The target manual `.50.14` endpoint is unresolved until EW and NAS reboot evidence proves it belongs only to MAC `90:09:D0:9F:7C:1F` |
| Extended SMART tests | BLOCKED | Drive 2 extended test was started and last observed at 10%; Drive 1 is pending and neither drive has a retained completion result |
| Independent encrypted backup | BLOCKED | Owner declined using the connected Seagate disk; no independent backup destination or job exists |
| Backup integrity and clean restore | BLOCKED | No job, integrity receipt, isolated restore schema, or business-invariant comparison exists |
| UPS safe shutdown | BLOCKED | Owner reports external UPS hardware is connected, but DSM recognition, data signaling, shutdown, and restart have not been verified |
| MariaDB 10 socket service | PASS | Package installed; `chu` and least-privilege `chu_app` created; socket login verified at `/run/mysqld/mysqld10.sock`; TCP disabled with `port=0` |
| Restricted service identity and private share | PASS | `ch_core_service` has UID/GID `1027:100`, no DSM login or unrelated share access, and direct read/write only to hidden `CH_Core_Private` |
| Copied-data CH Core runtime | PASS | Project `ch-ultimate-core-d5bb4b6` has one running container; `/health/live` returned `{"status":"ok"}` and `/health/ready` returned `{"status":"ready"}` through NAS loopback |
| Runtime isolation | PASS | Container uses host networking but binds `127.0.0.1:18080`; the Mac cannot connect to raw 18080 or MariaDB 3306; all Linux capabilities are dropped and the root filesystem is read-only |
| Post-start resource sample | READY | Load average `0.51 / 0.71 / 0.86`, `344328 kB` memory available, and `639496 kB` swap used; the one-hour and seven-client soak gates remain open |
| Private CA and IP-SAN leaf | PREPARED | The encrypted CA key remains off-NAS on the administrator Mac; DSM currently lists the historical `IP:192.168.1.14` leaf. A separate new leaf with `IP:192.168.50.14` must be staged, assigned, and CA-validated during the cutover |
| DSM firewall and reverse proxy | BLOCKED | The DSM Firewall UI currently appears disabled. Historical `.1.0/24` firewall/reverse-proxy validation is retained above but is not current. The cutover must enable ordered `.50.0/24` TCP 8443 allow-then-deny rules and verify reverse proxy `*:8443` to `127.0.0.1:18080` |
| Production CH Core deployment | BLOCKED | The copied-data runtime is not a production endpoint until stable addressing, backup/restore, SMART, UPS, restart, load, isolation-path, and physical-client gates pass |

## Physical acceptance after guarded deployment

The copied-data runtime and historical LAN HTTPS endpoint have evidence, but
the planned business-LAN endpoint does not. Current CA-validated old-endpoint
health does not establish firewall state or acceptance on `CH-Business`. The
remaining items below are still open unless explicitly marked `PASS`:

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
2. The router reservation was declined. The current conflict is unresolved:
   the NAS is DHCP `192.168.1.14/24` on the old LAN while the target is manual
   `.50.14`. Do not claim cutover until live evidence proves one NAS MAC at
   `.50.14` across EW and NAS reboots: `90:09:D0:9F:7C:1F` only.
3. Use of the connected Seagate disk for backup was declined; an independent
   production backup and restore drill remain unresolved.
4. External UPS hardware is reported connected; DSM signaling and safe
   shutdown remain unverified.
5. Android release-signing identity creation is deferred. Development/debug
    builds may continue, but no production Android release may be claimed.
6. Private GitHub Releases will distribute the Windows installer and Android
   debug APK for the copied-data pilot. This does not relax physical-client or
   production acceptance gates.
