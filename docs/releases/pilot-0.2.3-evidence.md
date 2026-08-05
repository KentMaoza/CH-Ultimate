# Bukti kesiapan rilis v0.2.3

Dokumen ini tidak menyimpan credential, token, private key, dump, atau isi data
bisnis. Nilai yang tidak dapat diukur tidak diganti dengan nol.

## GitHub dan fresh-download

Prerelease publik [`pilot-v0.2.3`](https://github.com/KentMaoza/CH-Ultimate/releases/tag/pilot-v0.2.3)
diterbitkan pada 2026-08-05T11:51:06Z (19:51:06 WITA) dari commit
`8a9ffcec972a358ce94270a70f0a1de026c85b84`. Seluruh job pada
[workflow run 31002068557](https://github.com/KentMaoza/CH-Ultimate/actions/runs/31002068557)
lulus. Unduhan baru berisi tepat tiga aset:

| Aset | Bytes | SHA-256 | Verifikasi |
| --- | ---: | --- | --- |
| `CH-Ultimate-0.2.3-Setup.exe` | 149268992 | `26a10069a03a03919905d6912232d72dc35e4dc8534aa8ff562029f76015fb1f` | PE32 GUI; paket internal `ch_ultimate-0.2.3-full.nupkg`; nuspec `0.2.3` |
| `CHU-Companion-Mobile-0.2.3-release.apk` | 43104533 | `1b43fdb0aba53896d26f379cbafcd31de4afa742683bdbec2ebdaa62de1c0700` | `com.tokoch.chucompanion`; versionName `0.2.3`; versionCode `10`; minSdk 26; targetSdk 36 |
| `SHA256SUMS.txt` | 199 | `1bc649bd81029483c2cf506980cff86f268ecca9ce065222416e5975b7eb1546` | `shasum -a 256 -c` lulus untuk kedua payload |

APK memiliki satu signer release yang lolos verifikasi dengan SHA-256
sertifikat permanen
`57e0731ce3db068e6581980c53610764af05c612184ff50e18a9f4912ca59ba5`.
Installer sudah siap diunduh untuk instalasi manual, tetapi belum membuktikan
instalasi atau penerimaan pada perangkat fisik.

## Gate repository

| Gate | Status | Receipt |
| --- | --- | --- |
| Workflow release | PASS | Source gate 3m23s; Windows 2m31s; Android 4m02s; publisher 8m15s |
| Runtime dependency | PASS DENGAN RESIDUAL | `npm audit --omit=dev --audit-level=high`: 0 critical, 0 high, 2 moderate ExcelJS/uuid |
| Helper NAS v0.2.3 | PASS | Shell syntax dan 8 test fokus lulus; full desktop/typecheck 95 file / 706 test lulus |
| Workbook NAS | PASS | Acceptance 1/1 terhadap salinan NAS dengan 3.144 SKU, 6.288 identifier, dan total 3.988 PCS |

## Staging CH Core di NAS

Pada 2026-08-05T19:49:19+0800, source dan input impor ditempatkan langsung di
NAS pada `/Volumes/home/CH_Ultimate_Pilot/8a9ffce`. Folder ini bukan backup
database dan belum dieksekusi sebagai deployment.

| Aset staging | Bytes | SHA-256 | Verifikasi |
| --- | ---: | --- | --- |
| `ch-ultimate-8a9ffcec972a358ce94270a70f0a1de026c85b84.tar.gz` | 11181733 | `49e5be9c0b3672012ece35f67850bc3ce6e840669fec6ed9574980de1e652712` | `git archive` dari commit rilis; seluruh path berada di satu root aman |
| `ch-core-v023-prepare.sh` | 5942 | `839a65c061af0ce99bbe7fe6d9192a3a63997723eb01cc087407233550f6bf94` | Mengunci commit, archive, target baru, migrasi 001-010, dan tidak mengakses database |
| `ch-core-v023-preflight.sh` | 8710 | `274a1faf979cb168c4d9ee8e97eee7c39090b9c432223a5b0c5531330dbad215` | Mengizinkan klien uninstall tanpa mengklaim outbox nol; menghitung allowlist lalu membuat dan memverifikasi dump NAS-only |
| `compare-scratch.sh` | 2075 | `f34cf3040757612346e1780a144a0f01ba50a89cdf34b153ace48437ae424b55` | Membandingkan dump canonical live dan scratch tanpa mencetak baris bisnis |
| `SKU_Gudang20260804080716145.xlsx` | 341193 | `f1f4675327fac107ef9f78c114b8afe86389d5543b204540ed45e74f9b15e49c` | Hash dan penerimaan workbook cocok |
| `STAGING-RECEIPT.txt` | 911 | `dcd42ecc7d54ac14dde89496314139c24c40162bbdb741192f44ba7bfd16b503` | Receipt sanitasi: database, backup, scratch, deployment, dan import masih `NOT_STARTED` |

Probe lama terhadap Core v1 tetap sehat melalui CA, tetapi tidak membuktikan
Core v2. Source v0.2.2 pada staging lama tidak boleh dideploy.

## Gate operasional tersisa

| Gate | Status | Bukti yang masih wajib |
| --- | --- | --- |
| Disposisi klien | QUIESCED | Android uninstall diverifikasi langsung; Windows uninstall dikonfirmasi pemilik; outbox keduanya `UNAVAILABLE_AFTER_OWNER_UNINSTALL` |
| Credential owner Windows | BELUM DIKONFIRMASI | Pastikan uninstall biasa tidak disertai penghapusan `%APPDATA%\CH Ultimate` sebelum Core dipindah |
| Backup dan scratch restore NAS-only | BELUM DIJALANKAN | Receipt count, SHA-256 dump, restore scratch, dan invariant `MATCH` |
| Deploy CH Core v2 | BELUM DIJALANKAN | Exact source commit, migrasi 010, health CA, bootstrap schema 2, dan `stockChecks` |
| Import katalog | BELUM DIJALANKAN | Transaksi rekonsiliasi 3.144 SKU dan hasil count/audit |
| Instalasi perangkat | DILAKUKAN PEMILIK | Windows dan Android dipasang manual dari GitHub setelah backend lulus |

Pilot empat hari tidak termasuk dalam eksekusi ini sesuai keputusan pemilik.
