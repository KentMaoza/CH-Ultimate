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
| CH Core unit and artifact tests | PASS | `npm run server:test`: 43 files / 295 tests plus one intentional workbook skip |
| Approved workbook parser | PASS | Exact SHA-256 and 3,144 / 2,786 / 358 / 3 / Rp276,267,011 / 4,115 PCS acceptance: 1/1 |
| Desktop mock isolation | PASS | Packaged startup fails closed; explicit unpackaged test marker only; Playwright 8/8 |
| Mobile production bundle | PASS | 589-module Vite build and Capacitor Android sync |
| Android JVM and lint gates | PASS | Debug/release unit tests and lint pass with Android Studio JDK 21 |
| Electron package | PASS | Reproducible darwin-arm64 package succeeds |
| Source hygiene | PASS | `git diff --check`, shell syntax, and tracked-secret/private-artifact scans pass |
| Exact MariaDB integration | BLOCKED | No local MariaDB server; `server:test:integration` accepts only an isolated `/chu_test` URL and fails closed otherwise |
| Docker/Compose and ARM64 image | BLOCKED | No Docker, Compose, Podman, OrbStack, or equivalent runtime is installed on this Mac |

## Client release artifacts

| Requirement | Status | Current evidence |
| --- | --- | --- |
| Windows x64 application package | READY | Electron cross-package succeeds and a reproducible Windows x64 ZIP is created |
| Windows Squirrel installer | BLOCKED | Non-Windows build requires Mono and Wine; the installer must preferably be built and then tested on real Windows |
| Two Windows laptop installations | BLOCKED | Windows package is not tested on either physical laptop |
| Android debug/release code checks | PASS | Gradle unit tests and lint pass |
| Android release signing | BLOCKED | Release build correctly refuses to run without `CHU_COMPANION_STORE_FILE`, store password, key alias, and key password |
| Signed Android APK | BLOCKED | No owner-approved signing credential is available; no unsigned artifact is treated as a release |
| Physical Android installation | BLOCKED | Signed APK is not installed or tested on a physical phone |

The Windows ZIP is useful only for target-machine validation. It does not
satisfy the installer gate. Likewise, a debug or unsigned Android build does
not satisfy release signing.

## Workbook owner review

The fixed selection rule uses a positive `Harga Jual Referensi`; otherwise it
uses `Modal Referensi`. Before the transactional first import, owner approval
of the three selected price differences remains required:

| Excel row | Primary SKU | Modal | Jual selected |
| --- | --- | ---: | ---: |
| 1018 | `PR010215 Pigeon Softouch BPP Nursing Bottle PPSU 160ml Safari Doodles CH058` | Rp338,148 | Rp338,184 |
| 1088 | `PR060522 Pigeon Baby Cologne Rejuv 200ml CH058` | Rp40,440 | Rp25,800 |
| 1180 | `PR050339 Pigeon 2 Way Baby Bibs - Check CH058` | Rp187,320 | Rp183,320 |

No import is committed until the owner approves those prices or supplies
corrections.

## NAS preflight and deployment gates

Current LAN evidence: the Mac is `192.168.1.18`; the NAS is
`192.168.1.14`, MAC `90:09:D0:9F:7C:1F`. SMB 445 and DSM HTTPS 5001 are
reachable. CH Core 8443, raw API 18080, and MariaDB 3306 remain
closed/filtered, which is correct before deployment.

| Requirement | Status | Current evidence or missing action |
| --- | --- | --- |
| Authenticated DSM preflight | PASS | DS223j, DSM 7.4.1-90080, healthy RAID1/Btrfs, Container Manager present; no changes made |
| Reserved LAN endpoint | BLOCKED | Owner/router confirmation of `90:09:D0:9F:7C:1F -> 192.168.1.14` is absent |
| Extended SMART tests | BLOCKED | Both drives report healthy, but no explicit SMART self-test results exist |
| Independent encrypted backup | BLOCKED | Hyper Backup is absent; connected Seagate 1TB is not approved or configured as a backup |
| Backup integrity and clean restore | BLOCKED | No job, integrity receipt, isolated restore schema, or business-invariant comparison exists |
| UPS safe shutdown | BLOCKED | No compatible UPS is connected; DSM UPS support is disabled |
| MariaDB 10 loopback service | BLOCKED | Package is absent and must not be installed before the preceding safety decisions |
| Private CA and IP-SAN leaf | BLOCKED | Off-NAS CA custody and `IP:192.168.1.14` leaf are not yet established |
| DSM firewall and reverse proxy | BLOCKED | Firewall is disabled and reverse-proxy list is empty |
| CH Core deployment | BLOCKED | All preceding hard gates must pass first |

## Physical acceptance after guarded deployment

Every item below remains `BLOCKED` until a copied-data pilot exists:

- Business Wi-Fi works with Internet disconnected.
- Guest Wi-Fi, mobile data, WAN, QuickConnect, and Tailscale cannot reach
  CH Core 8443.
- Raw 18080 and MariaDB 3306 remain unreachable from clients.
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

## Owner decisions required before the next mutation

1. Approve or correct the three workbook prices above.
2. Confirm the router reservation is complete.
3. Confirm whether the connected Seagate 1TB disk may be dedicated to an
   encrypted backup, including whether existing contents may be erased or
   repurposed.
4. Connect and identify a compatible UPS.
5. Provide or authorize creation and custody of the Android release-signing
   credential.

