# Bukti rilis dan pilot v0.2.1

Dokumen ini membedakan bukti otomatis dari penerimaan lingkungan fisik. Jangan
isi nilai yang belum diukur dengan nol, dan jangan simpan credential, token,
private key, dump, atau byte data bisnis di sini.

## Gate otomatis repository

| Gate | Status | Receipt |
| --- | --- | --- |
| Automated kontrak rilis, typecheck, dan package contract | PASS | Commit `2c569db25ada195e00ef220e99d6b05909a46768`; 2026-08-05 15:58:35 WITA; [workflow run 30986018170](https://github.com/KentMaoza/CH-Ultimate/actions/runs/30986018170) `success`: source gates, Electron E2E, Windows installer, Android test/lint/APK, permanent signer, checksum, dan publication semuanya lulus |

Verifikasi lokal terakhir pada commit yang sama juga lulus: `npm run verify`
90 file / 687 test, `npm run test:mobile` 12 file / 118 test,
`npm run server:test` 50 file / 338 test dengan satu acceptance skip yang
disengaja, server typecheck, Android JVM/lint, Electron package, dan Electron
E2E 11/11. Suite MariaDB terisolasi tidak dijalankan karena mesin ini tidak
memiliki `CH_CORE_TEST_DATABASE_URL`, Docker, atau klien MariaDB; suite itu
tidak diarahkan ke NAS/production.

## Prerelease GitHub dan fresh-download verification

Prerelease [CH Ultimate pilot v0.2.1](https://github.com/KentMaoza/CH-Ultimate/releases/tag/pilot-v0.2.1)
diterbitkan 2026-08-05T07:58:23Z (15:58:23 WITA) dari commit
`2c569db25ada195e00ef220e99d6b05909a46768`. Fresh authenticated download
pada 2026-08-05 16:01:16 WITA berisi tepat tiga file berikut:

| Artifact | Bytes | SHA-256 | Hasil inspeksi |
| --- | ---: | --- | --- |
| `CH-Ultimate-0.2.1-Setup.exe` | 149267456 | `d8835ff3f0a367ae277192c624c429c05e019041a42cab92c0d1b478c86913aa` | PE32 Windows GUI; Squirrel payload memuat `ch_ultimate-0.2.1-full.nupkg`; nuspec menetapkan title `CH Ultimate` dan version `0.2.1` |
| `CHU-Companion-Mobile-0.2.1-release.apk` | 43103217 | `91b7ff7b5be93b1f0c602c82662f8db802429dc72cbc098fd0283e1fe43b1be1` | `com.tokoch.chucompanion`; versionName `0.2.1`; versionCode `8`; satu signer v2 dengan digest permanen yang dipatok |
| `SHA256SUMS.txt` | 199 | `9e2da454a9b1642c97d05e56647349cf05fc33066764883c85858811db12c7be` | `shasum -a 256 -c` lulus untuk kedua payload |

Signer certificate SHA-256 APK adalah
`57e0731ce3db068e6581980c53610764af05c612184ff50e18a9f4912ca59ba5`.
Inspeksi exact Windows `app.asar` menemukan SVG
`brand/ch-ultimate-mark.svg` yang valid dan bundle renderer memakai asset
tersebut sebagai data URL. Ini membuktikan asset tidak lagi bergantung pada
path absolut `/brand/...` di bawah `file://`; tampilan aktual setelah instalasi
tetap merupakan gate Windows fisik di bawah.

## Penerimaan yang belum diverifikasi

| Gate | Status | Receipt yang wajib dicatat |
| --- | --- | --- |
| Windows terpasang | BELUM DIVERIFIKASI | versi produk, sidebar `file://`, SHA-256 |
| Android fisik | BELUM DIVERIFIKASI | package ID, versionName 0.2.1, versionCode 8, signer digest |
| deploy CH Core | BELUM DIVERIFIKASI | health CA-validated, `apiSchemaVersion: 2`, `stockChecks` |
| cetak | BELUM DIVERIFIKASI | dialog Windows, PDF, XLSX, waktu WITA |

Sebelum pemasangan, cocokkan Android dengan application ID
`com.tokoch.chucompanion` dan signer permanen
`57e0731ce3db068e6581980c53610764af05c612184ff50e18a9f4912ca59ba5`.

## Receipt pilot empat hari WITA

Pilot hanya dimulai setelah kedua klien terpasang dan CH Core v2 diterima pada
data salinan. Empat receipt berikut adalah empat hari kalender WITA berturut-
turut, bukan aturan prioritas rekomendasi.

### Hari 1 WITA

| Koneksi/sinkronisasi | Outbox blocked/replayed | Nota | Gambar | Cek stok | Print/PDF/XLSX | Restart | Error retry-visible | Disposisi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` |

### Hari 2 WITA

| Koneksi/sinkronisasi | Outbox blocked/replayed | Nota | Gambar | Cek stok | Print/PDF/XLSX | Restart | Error retry-visible | Disposisi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` |

### Hari 3 WITA

| Koneksi/sinkronisasi | Outbox blocked/replayed | Nota | Gambar | Cek stok | Print/PDF/XLSX | Restart | Error retry-visible | Disposisi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` |

### Hari 4 WITA

| Koneksi/sinkronisasi | Outbox blocked/replayed | Nota | Gambar | Cek stok | Print/PDF/XLSX | Restart | Error retry-visible | Disposisi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` |

Hari 4 hanya dapat ditutup setelah semua insiden memiliki disposisi atau secara
eksplisit memblokir rollout. Receipt empat hari ini bukan prioritas rekomendasi
empat tanggal kalender WITA.
