# CH Core acceptance status

Updated 2026-08-04 WITA. This is an evidence ledger, not a production
deployment receipt. A v0.1.3-compatible copied-data CH Core runtime is
deployed on the NAS, but CH Core is not deployed as a production endpoint.
The catalogue workbook has not been imported. The Windows owner is enrolled;
Android v0.1.5 is installed and awaiting a fresh one-use pairing code.

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
evidence. The business-LAN partial live receipt does not amend those receipts.

### Pilot v0.2.0 — persiapan repository lokal

Bagian ini hanya mencatat kesiapan source untuk **four-day copied-data pilot**.
Ia tidak mengubah receipt historis v0.1.x dan tidak menjadi izin menjalankan
maintenance, clear data, migrasi, impor, deployment, pairing, atau publikasi.

| Gate | Status | Bukti repository atau pekerjaan yang masih wajib |
| --- | --- | --- |
| Metadata klien v0.2.0 | PASS | `package.json`, lockfile, Settings, Android `versionName 0.2.0`/`versionCode 7`, copy script, dan test alignment memakai versi yang sama |
| Kontrak release privat | PASS | Workflow mengunci `pilot-v0.2.0`, kedua nama payload, notes, empat secret Android, digest signer permanen, dan tidak memublikasikan debug APK |
| Baseline katalog | PASS | Evidence lokal mencatat workbook/hash yang disetujui, 3,144 SKU, 6,288 identifier, 3,988 PCS, 2,786 referensi gambar, 358 missing, total Rp276,285,615, dan tiga pilihan Modal; belum ada impor live |
| Notes, runbook, dan receipt template | READY | `docs/releases/pilot-0.2.0.md`, evidence katalog/gambar, dan runbook API v0.2 tersedia untuk review operator |
| Template progres gambar | READY | Kolom matched/included/succeeded/failed/retry-visible tersedia; nilainya belum diisi dari perangkat fisik |
| Live import workbook | BLOCKED | Belum dijalankan; perlu maintenance, backup/restore, preview, count, dan persetujuan pemilik |
| Deploy Core API v2 | BLOCKED | Migrasi/Core v2 belum diterapkan pada NAS dan tidak ada receipt health/schema pascadeploy |
| Artefak signed v0.2.0 | BLOCKED | Installer Windows dan APK release permanen belum dibuat atau diverifikasi checksum/signer-nya |
| Publikasi GitHub | BLOCKED | Tag/prerelease `pilot-v0.2.0` belum diterbitkan dan belum ada fresh-download verification |
| Windows printing fisik | BLOCKED | Dialog sistem, printer dokumen, dan printer thermal belum diterima pada laptop Windows fisik |
| Kamera/share fisik | BLOCKED | Scan kamera, preprocessing gambar, dan Android share sheet belum diterima pada ponsel fisik |
| Penerimaan fisik dua perangkat | BLOCKED | Nota typing/conflict/restart, gambar dua arah, QR/barcode paket, forced-stock audit, PDF/XLSX, restart Core, dan retry gambar belum lulus pada laptop + ponsel |
| Pilot copied-data empat hari | BLOCKED | Empat hari kalender belum dimulai; hasil harian dan keputusan lanjut/henti belum direkam |

Windows tetap private pilot tanpa Authenticode. Hanya APK release dengan signer
permanen yang boleh dipublikasikan; debug APK adalah artefak verifikasi saja.
Jangan menyebut v0.2.0 published, deployed, imported, signed-artifact complete,
physically accepted, atau production-ready sampai baris `BLOCKED` memperoleh
bukti langsung dan statusnya diubah melalui receipt yang ditinjau.

## Local implementation and regression

| Requirement | Status | Current evidence |
| --- | --- | --- |
| Desktop application and gateway | PASS | v0.1.5 `npm run verify`: 69 files / 497 tests |
| Mobile application | PASS | v0.1.5 `npm run test:mobile`: 12 files / 92 tests |
| CH Core unit and artifact tests | PASS | `npm run server:test`: 44 files / 308 tests plus one intentional workbook skip |
| Approved workbook parser | PASS | `SKU_Gudang20260804080716145.xlsx` at SHA-256 `f1f4675327fac107ef9f78c114b8afe86389d5543b204540ed45e74f9b15e49c`: 3,144 SKU / 6,288 identifiers / 2,786 refs / 358 missing / 3 Modal selections / Rp276,285,615 / 3,988 PCS acceptance: 1/1 |
| Desktop mock isolation | PASS | Packaged startup fails closed; explicit unpackaged test marker only; Playwright 8/8 |
| Mobile production bundle | PASS | 591-module Vite build and Capacitor Android sync |
| Android JVM and lint gates | PASS | Debug/release unit tests and lint pass with Android Studio JDK 21 |
| Electron package | PASS | Reproducible darwin-arm64 package succeeds |
| Source hygiene | PASS | `git diff --check`, shell syntax, and tracked-secret/private-artifact scans pass |
| Exact MariaDB integration | BLOCKED | The NAS runtime connects through `/run/mysqld/mysqld10.sock`, migrations completed, and `/health/ready` returns `{"status":"ready"}`; the isolated `/chu_test` integration suite and transaction/restart acceptance remain outstanding |
| Docker/Compose and ARM64 image | PASS | Container Manager built the merged ARM64 image on the DS223j and started one healthy container from project `ch-ultimate-core-4482af7`; the prior `ch-ultimate-core-d5bb4b6` project is stopped and retained for rollback |

## Client release artifacts

### Client stabilization v0.1.5 — implementation in progress

This release is a client-only stabilization of the existing copied-data CH
Core pilot. It does not migrate MariaDB, modify the NAS container, or import a
new catalogue. Publication and physical acceptance remain open.

| Requirement | Status | Current evidence or missing action |
| --- | --- | --- |
| Real-Core render stability | PASS | Focused Android/desktop renderer tests reproduce populated CH Core snapshots without the React maximum-update-depth loop; both entry points have a visible Indonesian retry boundary |
| Rapid Nota edit ordering | PASS | Focused actual-Core gateway tests prove queued header and line edits rebase against the first acknowledgement before sending |
| Desktop and mobile Nota input | PASS | Delayed-write tests keep fields focused and enabled; rejected mobile creation and edit promises are converted into visible alerts |
| v0.1.5 release metadata | READY | Desktop, Android `versionCode 6`, Settings, copy script, filenames, and release notes are aligned at `0.1.5` |
| Permanent Android signing identity | PASS | The off-repository keystore has public certificate SHA-256 `57e0731ce3db068e6581980c53610764af05c612184ff50e18a9f4912ca59ba5`; the password is stored in Apple Passwords and macOS Keychain, a checksum-verified JKS and recovery instructions are on the NAS `home` share, all four GitHub secret names exist, and the plaintext environment file was removed |
| Local signed v0.1.5 APK | PASS | `assembleRelease` produced a one-signer v2 APK of 43,077,815 bytes with SHA-256 `d01e9a4362dac8a7a8c1fe076bd6425371d624cc51192a4f623167ec3cf4eb8e`; `apksigner` matched the pinned permanent certificate |
| Signed-only GitHub publication | READY | The manual main-branch publisher requires all four signing secrets, builds `assembleRelease`, rejects any signer other than the pinned certificate, and never publishes the debug verification APK |
| v0.1.5 GitHub artifacts | BLOCKED | Source integration, repository-visibility decision, workflow publication, fresh download, checksum verification, and downloaded-signer verification remain outstanding |
| Physical Android installation | READY | Samsung SM-S901E was moved from debug-signed v0.1.4 to permanently signed v0.1.5; the pairing form renders without React error 185. Fresh pairing, shared data rendering, Nota typing/synchronization, restart, and exact-once posting remain open |
| Physical Windows acceptance | BLOCKED | The Windows v0.1.5 installer has not yet been built by GitHub or installed over v0.1.4 on either laptop |
| Exact MariaDB integration suite | BLOCKED | Unit/type gates pass, but this Mac has no local MariaDB/Docker service and no explicitly isolated `chu_test` URL; the suite correctly refused to use an unspecified database and was not pointed at the NAS |

Do not describe v0.1.5 as published, physically accepted, or production-ready
until those missing actions have direct evidence below.

### Owner-pairing release v0.1.3

The merged source and private pilot release contain the owner-only
pairing-status API, secure Electron owner transport, and Windows Settings
controls for generating, inspecting, and explicitly approving one-use pairing
requests. Physical-device acceptance remains separate:

| Requirement | Status | Current evidence or missing action |
| --- | --- | --- |
| Owner-pairing implementation | READY | Full local desktop, mobile, server, package, Electron E2E, Android JVM, Android lint, and debug-APK gates pass; physical devices have not accepted it |
| Compatible NAS Core upgrade | PASS | NAS project `ch-ultimate-core-4482af7` runs the server from merged commit `4482af7ce1a4f20acfed49f31f037348c5586d8f`; the container is healthy and CA-validated live/ready checks pass |
| v0.1.3 GitHub artifacts | PASS | Private prerelease `pilot-v0.1.3` was published by successful workflow run `30790902144` from merged commit `4482af7ce1a4f20acfed49f31f037348c5586d8f`; fresh downloads and independent verification are recorded below |
| Physical owner/client pairing | BLOCKED | No physical Windows owner bootstrap, device-name/platform confirmation, explicit approval, client completion, or synchronized edit has been recorded |

Do not describe physical pairing, synchronization, or production acceptance
as complete until their independent evidence is added here.

| Requirement | Status | Current evidence |
| --- | --- | --- |
| Private GitHub pilot workflow | PASS | `.github/workflows/pilot-release.yml` run `30790902144` passed source, Windows, Android, and publication jobs on merged commit `4482af7ce1a4f20acfed49f31f037348c5586d8f` |
| Windows x64 application package | READY | Electron cross-package succeeds and a reproducible Windows x64 ZIP is created |
| Windows Squirrel installer | PASS | GitHub built and published `CH-Ultimate-0.1.3-Setup.exe`; a fresh authenticated download matched its published SHA-256 and was identified as a Windows PE32 GUI executable |
| Two Windows laptop installations | BLOCKED | Windows package is not tested on either physical laptop |
| Android debug/release code checks | PASS | Gradle unit tests and lint pass |
| Android pilot debug APK | PASS | GitHub built and published `CHU-Companion-Mobile-0.1.3-pilot-debug.apk`; a fresh authenticated download matched its SHA-256, embeds `https://192.168.50.14:8443`, and passed `apksigner` v2 verification with exactly one Android Debug signer |
| Android release signing | BLOCKED | Owner deferred creation of the permanent signing identity; release builds continue to fail closed without the four private signing variables |
| Signed Android APK | BLOCKED | No release key or signed APK exists; development/debug builds are not treated as production releases |
| Physical Android installation | BLOCKED | The published pilot APK is not installed or tested on a physical phone |

The workflow and Windows ZIP are useful only for target-machine validation;
they do not satisfy physical installation. Likewise, the debug Android pilot
does not satisfy permanent release signing.

### Private pilot release receipt v0.1.3

Private prerelease `pilot-v0.1.3` was published from merge commit
`4482af7ce1a4f20acfed49f31f037348c5586d8f` by successful GitHub Actions run
`30790902144`:

- Release: `https://github.com/KentMaoza/CH-Ultimate/releases/tag/pilot-v0.1.3`
- Windows installer: `CH-Ultimate-0.1.3-Setup.exe`, 149,243,392 bytes,
  SHA-256 `4d76dad8707373f61dffdb8bb3619a7d733144666c25342fad32ea7e639abf15`
- Android pilot APK: `CHU-Companion-Mobile-0.1.3-pilot-debug.apk`, 46,610,239
  bytes, SHA-256
  `6d3e42b90ebd7717050e25115a9a215de392007e7d1c858d09c562092c775f80`
- Android signer certificate SHA-256:
  `6b0a86ff0d56ba045b12d391f02ab3c4869c7f78d4d0afcc5fb81435250bdbcb`
- Checksum manifest: `SHA256SUMS.txt`, 203 bytes, SHA-256
  `36010781272ecde309994e26e1fb8189b0ffa25f9daf3e21a9ad93aea274a59b`
- The lightweight tag resolves directly to the same merge commit.

Fresh authenticated downloads contained exactly those three files.
`shasum -a 256 -c` passed both payloads, and the Windows installer was
identified as a PE32 GUI executable. Independent APK inspection confirmed
`com.tokoch.chucompanion`, version `0.1.3` (`4`), the exact endpoint
`https://192.168.50.14:8443`, disabled Android backup and cleartext traffic,
and one v2 Android Debug signer. The Windows checkout converted the embedded
public-CA PEM to CRLF, so its raw-file hash differs; after CR removal it has
the repository hash
`2856854bdfd40dcad3a69d1f5f8b9a14e50d6d553d6cafd36bff6a047ab13168`,
and the decoded DER certificate matches exactly at SHA-256
`397c7a745af599edd7f898ceff50d3f5117c7f7d1b6100ac8f9cab7de998763c`.

The release remains a copied-data pilot. Neither installer has passed
installation, owner bootstrap, pairing, or synchronized-edit acceptance on
physical devices.

### Private pilot release receipt v0.1.2

Private prerelease `pilot-v0.1.2` was published from merge commit
`69f308c6971496d1e38a172c0f7d98a699cc894a` by successful GitHub Actions run
`30749115155`:

- Release: `https://github.com/KentMaoza/CH-Ultimate/releases/tag/pilot-v0.1.2`
- Windows installer: `CH-Ultimate-0.1.2-Setup.exe`, 149,240,832 bytes,
  SHA-256 `e86517fd0a32313270ea64cd4595c298274e2d6d822243061aa38367698fbf0a`
- Android pilot APK: `CHU-Companion-Mobile-0.1.2-pilot-debug.apk`, 46,610,239
  bytes, SHA-256
  `4d384782ab9d92fa4b1b251cb5f0fac315aa323538522da8bcc32086c6b365f2`
- Android signer certificate SHA-256:
  `e3e57a4770bb374e6b12e5e6d1ff31e27bfef31e2bef30a7def382247f40dce5`
- Checksum manifest: `SHA256SUMS.txt`, SHA-256
  `f46a28e8f6f163df7d2ac62ab21668e16840be8cbd7c17e85d6284ba534eb2ef`
- Fresh authenticated downloads passed `shasum -a 256 -c`; the APK passed
  independent package/version, signer, and embedded endpoint inspection for
  `com.tokoch.chucompanion`, version `0.1.2` (`3`), and
  `https://192.168.50.14:8443`.

The release contains exactly these two installers and the checksum manifest.
It remains a copied-data pilot: neither installer has passed installation or
runtime acceptance on a physical Windows laptop or Android phone.

### Historical private pilot release receipt v0.1.1

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

For the approved v0.2 source `SKU_Gudang20260804080716145.xlsx`, the fixed
selection rule uses a positive `Modal Referensi`; only a missing/non-positive
Modal value falls back to a positive `Harga Jual Referensi`. The three coded
price differences therefore select the same source:

| Excel row | Selected source | Status |
| --- | --- | --- |
| 1018 | Modal Referensi | Recorded in v0.2 workbook evidence |
| 1088 | Modal Referensi | Recorded in v0.2 workbook evidence |
| 1180 | Modal Referensi | Recorded in v0.2 workbook evidence |

This v0.2 contract supersedes the former unversioned Jual-first description;
the v0.1.x release receipts above remain historical records. The workbook
review gate is complete, but no live import has been performed or authorized.

## NAS preflight and deployment gates

Current live-readiness evidence on 2026-08-02: the Mac is `192.168.50.174`
with gateway `192.168.50.1`; `Maoza_NAS.local` and ARP show that the NAS
resolves to `192.168.50.14` at Ethernet MAC `90:09:D0:9F:7C:1F`.
CA-validated `/health/live` returned `{"status":"ok"}` and `/health/ready`
returned `{"status":"ready"}`. The served leaf contains
`IP:192.168.50.14`, expires 2027-09-02, and has SHA-256 fingerprint
`22:08:62:71:10:7F:61:65:E6:34:B3:70:12:20:C3:16:BC:E1:B8:87:5A:20:E8:AA:21:26:59:DB:04:90:E5:88`.

The public target is now `https://192.168.50.14:8443`. The raw API remains on
NAS loopback at `127.0.0.1:18080`; raw 18080 and MariaDB 3306 were unreachable
from the Mac. The DSM firewall rule order and the external isolation probes
remain open, as do EW/NAS reboot persistence and physical-client acceptance.

The network-only cutover preflight requires a new completed logical dump
bundle, verified checksum/integrity, an off-NAS copy on the protected
administrator Mac, and its recorded SHA-256 hash. Private-file manifest and
evidence are captured and copied off-NAS where feasible. This bounded cutover
receipt does not satisfy the independent encrypted backup or clean scratch
restore production gates.

### Compatible server upgrade receipt — 2026-08-03

The merged server archive for commit
`4482af7ce1a4f20acfed49f31f037348c5586d8f` was staged at
`/volume1/homes/kentmaoza/CH_Ultimate_Pilot/4482af7/` with SHA-256
`18f446375e5ca340c1342362b4d32f3efc0a631193eabcae20eb0238e129e8c8`.
A root one-time preparation task verified that hash, rejected unsafe archive
paths, created `/volume1/docker/ch-ultimate-4482af7/server`, and preserved the
existing environment without printing it. The retained preparation receipt
records no migration beyond `009_offline_operations.sql`.

Container Manager stopped but retained project `ch-ultimate-core-d5bb4b6`
for rollback, then built and started project `ch-ultimate-core-4482af7` from
the prepared path. Container
`96b42c6f60b16c40704735ea02d35e6c96e47b39ab1458f29ce62682f3781655`
uses image `ch-ultimate-core-4482af7-ch-core:latest`; DSM reported it healthy,
with a 256 MB memory limit, auto-restart, host networking, and all Linux
capabilities dropped. The observed post-start sample was 3.15% container CPU
and 96 MB RAM; soak acceptance remains open.

From the administrator Mac, the bundled CA validated both `/health/live` as
`{"status":"ok"}` and `/health/ready` as `{"status":"ready"}` over
`https://192.168.50.14:8443`. Raw 18080 and MariaDB 3306 remained
unreachable. The three new owner-only pairing routes returned authenticated
boundary `401` responses without a token, while a deliberately unknown route
returned `404`; this proves the deployed router contains the new endpoints
without creating an unintended owner or pairing. Physical owner bootstrap is
still required before an authenticated route test is possible.

| Requirement | Status | Current evidence or missing action |
| --- | --- | --- |
| Authenticated DSM preflight | PASS | DS223j, DSM 7.4.1-90080, healthy RAID1/Btrfs, and supported Container Manager were confirmed before deployment |
| Reserved LAN endpoint | PILOT RISK ACCEPTED | `.50.14` currently resolves only to MAC `90:09:D0:9F:7C:1F` from the administrator Mac. Manual-address configuration and persistence still require proof across EW and NAS reboots |
| Extended SMART tests | BLOCKED | Drive 2 extended test was started and last observed at 10%; Drive 1 is pending and neither drive has a retained completion result |
| Independent encrypted backup | BLOCKED | Separate production gate; the one-time off-NAS cutover bundle does not provide an independent encrypted backup destination or job |
| Backup integrity and clean restore | BLOCKED | Separate production gate; checksum verification of the cutover bundle does not complete an isolated clean restore or business-invariant comparison |
| UPS safe shutdown | BLOCKED | Owner reports external UPS hardware is connected, but DSM recognition, data signaling, shutdown, and restart have not been verified |
| MariaDB 10 socket service | PASS | Package installed; `chu` and least-privilege `chu_app` created; socket login verified at `/run/mysqld/mysqld10.sock`; TCP disabled with `port=0` |
| Restricted service identity and private share | PASS | `ch_core_service` has UID/GID `1027:100`, no DSM login or unrelated share access, and direct read/write only to hidden `CH_Core_Private` |
| Copied-data CH Core runtime | PASS | Project `ch-ultimate-core-4482af7` has one healthy running container from merged commit `4482af7ce1a4f20acfed49f31f037348c5586d8f`; `/health/live` returned `{"status":"ok"}` and `/health/ready` returned `{"status":"ready"}` through CA-validated LAN HTTPS |
| Runtime isolation | PASS | Container uses host networking but binds `127.0.0.1:18080`; the Mac cannot connect to raw 18080 or MariaDB 3306; all Linux capabilities are dropped and the root filesystem is read-only |
| Post-start resource sample | READY | The new container was observed at 3.15% CPU and 96 MB RAM under its 256 MB limit; the one-hour and seven-client soak gates remain open |
| Private CA and IP-SAN leaf | PASS | The encrypted CA key remains off-NAS on the administrator Mac. The current leaf has `IP:192.168.50.14`, expires 2027-09-02, and passed CA validation at the public endpoint with the recorded fingerprint |
| DSM firewall and reverse proxy | PARTIAL | CA-validated 8443 health passed while raw 18080 remained unreachable, consistent with the reverse-proxy boundary. Authenticated DSM confirmation of the `.50.0/24` allow-then-deny order and every external isolation path remain open |
| Production CH Core deployment | BLOCKED | The copied-data runtime is not a production endpoint until stable addressing, backup/restore, SMART, UPS, restart, load, isolation-path, and physical-client gates pass |

## Physical acceptance after guarded deployment

The copied-data runtime and current business-LAN HTTPS endpoint have fresh
read-only evidence. That health result does not establish the full firewall,
reboot, or physical-client acceptance boundary. The remaining items below are
still open unless explicitly marked `PASS`:

- Business Wi-Fi works with Internet disconnected.
- Guest Wi-Fi, mobile data, WAN, QuickConnect, and Tailscale cannot reach
  CH Core 8443. The `.50.14` firewall rule order and all external isolation
  probes remain open.
- `PASS`: raw 18080 is unreachable from the Mac and MariaDB has no TCP
  listener.
- `PASS`: the bundled private CA validated the current `IP:192.168.50.14`
  leaf and recorded fingerprint. Wrong-IP, untrusted, and expired-certificate
  physical-client checks remain open.
- Foreground changes propagate within three seconds.
- Replay never duplicates Nota, stock, or omzet.
- Concurrent stock deltas survive and Nota merge/conflict rules hold.
- Revoked devices receive 401 and retain but cannot send their queue.
- NAS/API restart and DSM reboot lose no acknowledged transaction.
- UPS shutdown and restart pass.
- Clean restore reproduces catalogue, ledger, Nota, omzet, audit, change,
  and image-reference invariants.
- One Windows laptop and one Android phone pass a four-day copied-data pilot.
- Both Windows laptops and the remaining phones are then enrolled.
- The one-hour seven-client soak has no restart or sustained swap; p95 reads
  stay below 500 ms and p95 writes below one second.

If the DS223j fails the resource gate, only the Node service moves to a small
LAN computer; MariaDB and private files remain on the NAS.

## Current owner decisions and unresolved gates

1. The three workbook price selections are approved.
2. The router reservation was declined. The NAS currently answers at `.50.14`
   as MAC `90:09:D0:9F:7C:1F`, but stable-address acceptance remains open
   until one NAS MAC at `.50.14` is proven across EW and NAS reboots.
3. Use of the connected Seagate disk for backup was declined; an independent
   production backup and restore drill remain unresolved.
4. External UPS hardware is reported connected; DSM signaling and safe
   shutdown remain unverified.
5. A permanent Android pilot signing identity now exists off-repository. Its
   recovery copies and GitHub secrets must be verified before the first signed
   v0.1.5 publication; no production Android release may be claimed.
6. Private GitHub Releases will distribute the Windows installer and the
   permanently signed Android release APK for v0.1.5. Pull-request debug APKs
   are verification-only and must never be published. This does not relax
   physical-client or production acceptance gates.
