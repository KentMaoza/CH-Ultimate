# Bukti kesiapan rilis v0.2.2

Dokumen ini tidak menyimpan credential, token, private key, dump, atau byte
data bisnis. Nilai yang tidak dapat diukur tidak boleh diganti dengan nol.

## Gate repository dan keamanan runtime

| Gate | Status | Receipt |
| --- | --- | --- |
| Automated repository | PASS | Node 24: desktop/typecheck 92 file / 694 test; mobile 12 file / 118 test; server 50 file / 338 test + 1 acceptance skip; server typecheck; Android sync/test/lint; Electron package; Electron E2E 11/11 |
| Kontrak dependensi | PASS | jsPDF `4.2.1`; fast-uri `3.1.5`/`4.1.2`; brace-expansion `1.1.18`/`2.1.4`; tes PDF/ekspor lulus |
| Audit runtime | PASS DENGAN RESIDUAL | `npm audit --omit=dev`: `0 critical`, `0 high`, 2 moderate untuk ExcelJS/uuid; `uuid` bukan dependensi aplikasi langsung dan jalur rentan v3/v5/v6 dengan supplied buffer tidak dipanggil |
| Kontrak paket Android | PASS | Fresh download: `com.tokoch.chucompanion`; versionName `0.2.2`; versionCode `9`; minSdk 26; targetSdk 36; satu signer APK v2 dengan SHA-256 sertifikat `57e0731ce3db068e6581980c53610764af05c612184ff50e18a9f4912ca59ba5` |
| Payload Windows | PASS | `CH-Ultimate-0.2.2-Setup.exe`; 149268992 bytes; SHA-256 `a1d484804d49ea9bce3b895b628bfb745de8eaa73181d59378a599396e007b40`; PE32 GUI yang memuat `ch_ultimate-0.2.2-full.nupkg` dan nuspec versi `0.2.2` |
| Payload Android | PASS | `CHU-Companion-Mobile-0.2.2-release.apk`; 43104529 bytes; SHA-256 `496057db78f5a41a3f75adf7c5eef9f878cf33cc5ee9674eb48fa7cb2e1909c9` |

## Prerelease GitHub dan fresh-download verification

Prerelease privat [`pilot-v0.2.2`](https://github.com/KentMaoza/CH-Ultimate/releases/tag/pilot-v0.2.2)
diterbitkan pada 2026-08-05T09:57:45Z (17:57:45 WITA) dari commit
`dc76d3c0529233974f0d1ec18420a230d0c768a5`. Seluruh job pada
[workflow run 30994408231](https://github.com/KentMaoza/CH-Ultimate/actions/runs/30994408231)
lulus. Unduhan baru berisi tepat tiga aset:

| Aset | Bytes | SHA-256 | Verifikasi |
| --- | ---: | --- | --- |
| `CH-Ultimate-0.2.2-Setup.exe` | 149268992 | `a1d484804d49ea9bce3b895b628bfb745de8eaa73181d59378a599396e007b40` | PE32 GUI; paket internal `ch_ultimate-0.2.2-full.nupkg`; nuspec `0.2.2` |
| `CHU-Companion-Mobile-0.2.2-release.apk` | 43104529 | `496057db78f5a41a3f75adf7c5eef9f878cf33cc5ee9674eb48fa7cb2e1909c9` | Package/version/signer permanen lulus |
| `SHA256SUMS.txt` | 199 | `3773d852b65dd1773fb509bd1b38d3b8ab846edf246f6f1a99e0600470c93036` | `shasum -a 256 -c` lulus untuk kedua payload |

## Staging CH Core di NAS

Pada 2026-08-05T18:02:51 WITA, source dan input impor ditempatkan di NAS pada
`/Volumes/home/CH_Ultimate_Pilot/dc76d3c`. Folder ini bukan backup database dan
belum pernah dieksekusi sebagai deployment.

| Aset staging | Bytes | SHA-256 | Verifikasi |
| --- | ---: | --- | --- |
| `ch-ultimate-dc76d3c0529233974f0d1ec18420a230d0c768a5.tar.gz` | 11171255 | `55f193d8b483223c322e69312b86a12f90be6f7c42d1da39517ccdd366ca4798` | `git archive` dari commit rilis; memuat `server/compose.yaml`, migrasi `010_stock_checks.sql`, helper v0.2.2, dan lockfile |
| `ch-core-v022-preflight.sh` | 8710 | `de55aec640e316fe9dd87c4b9e226cfa6a0d0db3f8b6a94f004b2ef5910d7a6b` | Standalone helper aktif; checksum migrasi 006 dikoreksi dan seluruh manifest dicocokkan ke byte SQL aktual |
| `ch-core-v022-prepare.sh` | 5942 | `028d6cf8c1f6c6d4bec2bcfe35e3291234688500183e4a9e574fb92751e117c9` | Menyiapkan exact source, memverifikasi migrasi 001-010, dan memasang hanya supplement operasi yang hash-nya dikunci; tidak membuat environment, mengakses database, atau menjalankan deployment |
| `compare-scratch.sh` | 2075 | `f34cf3040757612346e1780a144a0f01ba50a89cdf34b153ace48437ae424b55` | Supplement operasi untuk membandingkan dump canonical produksi dan scratch; hanya mengeluarkan hash dan hasil `MATCH`, tanpa baris bisnis |
| `SKU_Gudang20260804080716145.xlsx` | 341193 | `f1f4675327fac107ef9f78c114b8afe86389d5543b204540ed45e74f9b15e49c` | Hash cocok dengan workbook yang disetujui |

Helper preflight yang tertanam di archive rilis memiliki checksum migrasi 006
yang salah satu karakter dan tidak boleh dijalankan. Salinan provenance-nya
dipindahkan menjadi `ch-core-v022-preflight-release.DO-NOT-RUN`. Helper
standalone aktif di atas adalah satu-satunya preflight yang diizinkan.
Helper prepare sebelumnya dipertahankan hanya sebagai
`ch-core-v022-prepare-without-compare.DO-NOT-RUN`; helper aktif adalah versi
yang tercatat pada tabel di atas.

Probe pramaintenance pada 2026-08-05 WITA lulus melalui CA: `/health/live`
HTTP 200 `{"status":"ok"}` dan `/health/ready` HTTP 200
`{"status":"ready"}`. Port raw `18080` dan MariaDB `3306` tidak terjangkau
dari Mac. Probe ini tidak membuktikan Core v2 dan tidak mengizinkan deployment.

## Disposisi klien sebelum cutover

| Klien | Status | Outbox |
| --- | --- | --- |
| Android Samsung SM-S901E | UNINSTALLED / DIRECTLY VERIFIED | `UNAVAILABLE_AFTER_OWNER_UNINSTALL` |
| Windows | UNINSTALLED / OWNER CONFIRMED | `UNAVAILABLE_AFTER_OWNER_UNINSTALL` |

Uninstall membuat kedua klien quiesced, tetapi tidak membuktikan outbox lama
bernilai nol. Helper `scripts/ch-core-v022-preflight.sh` menerima keadaan ini
secara eksplisit dan menolak pencatatan outbox nol palsu.

## Gate lingkungan yang masih terbuka

| Gate | Status | Bukti yang wajib diisi |
| --- | --- | --- |
| Publikasi GitHub | PASS | commit rilis, workflow run, tiga fresh-download artifact, checksum, metadata paket, dan signer diverifikasi |
| Source/Core/import staging NAS | PASS | commit rilis, source archive, helper prepare/preflight terkoreksi, workbook, dan `STAGING-RECEIPT.txt` tersedia dengan hash terverifikasi; helper archive lama ditandai `DO-NOT-RUN` |
| Backup NAS-only dan scratch restore | BELUM DIVERIFIKASI | receipt, count, SHA-256, invariant restore |
| Rotasi credential | BELUM DIVERIFIKASI | konfirmasi pemilik tanpa nilai credential |
| deploy CH Core | BELUM DIVERIFIKASI | source commit v0.2.2, migration 010, health dan bootstrap v2 |
| Import 3.144 SKU | BELUM DIVERIFIKASI | hash workbook, count import, rekonsiliasi harga/stok/gambar |
| Windows terpasang | BELUM DIVERIFIKASI | versi produk, sidebar, pairing, sinkronisasi |
| Android fisik | BELUM DIVERIFIKASI | package/version/signer, pairing, Back, barcode |
| cetak | BELUM DIVERIFIKASI | dialog Windows, PDF, XLSX, waktu WITA |

Pilot empat hari telah dihapus dari eksekusi saat ini sesuai keputusan pemilik.
