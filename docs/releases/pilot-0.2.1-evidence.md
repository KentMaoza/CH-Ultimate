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

## Preflight CH Core v2 — 2026-08-05 WITA

Preflight read-only/staging dijalankan setelah artefak klien terbit. Status
keseluruhan masih `BLOCKED`; tidak ada container yang dihentikan, migrasi yang
dijalankan, database yang diubah, atau klien yang dipasang pada tahap ini.

| Gate | Status | Receipt |
| --- | --- | --- |
| Health LAN dengan CA | PASS | 2026-08-05 16:04:15 WITA; `https://192.168.50.14:8443/health/live` HTTP 200 `{"status":"ok"}` dan `/health/ready` HTTP 200 `{"status":"ready"}` dengan `resources/ch-core-ca.pem`; leaf SHA-256 `22:08:62:71:10:7F:61:65:E6:34:B3:70:12:20:C3:16:BC:E1:B8:87:5A:20:E8:AA:21:26:59:DB:04:90:E5:88`, SAN `IP:192.168.50.14`, berlaku sampai 2027-09-02 |
| Isolasi port | PASS | Raw Core `18080` dan MariaDB `3306` menolak koneksi dari administrator Mac; hanya reverse proxy `8443` yang dipakai klien |
| Artifact Core lama | PASS | Sesi DSM terautentikasi mengonfirmasi project live sehat `ch-ultimate-core-4482af7`, path `/volume1/docker/ch-ultimate-4482af7/server`, container `ch-ultimate-core-4482af7-ch-core-1`, dan image `ch-ultimate-core-4482af7-ch-core:latest`; receipt artifact menunjuk commit `4482af7ce1a4f20acfed49f31f037348c5586d8f`, source SHA-256 `18f446375e5ca340c1342362b4d32f3efc0a631193eabcae20eb0238e129e8c8`, dan migrasi sampai 009 |
| Artifact Core v2 | PASS (staging saja) | Source commit yang ditinjau `2c569db25ada195e00ef220e99d6b05909a46768`; bundle baru `CH_Ultimate_Pilot/2c569db/ch-ultimate-2c569db.tar.gz` pada share NAS cocok dengan sumber lokal di SHA-256 `b7f4bf8ea44d56561228cea1859959e7dcab04bb2de8c866c9b600069a4dbded`; bundle memuat Dockerfile, Compose, package manifest, dan migrasi 010 |
| Klien Android sebelum cutover | PASS | Samsung SM-S901E terhubung melalui USB dan LAN bisnis; installed APK adalah `com.tokoch.chucompanion` v0.2.0, versionCode 7, SHA-256 `f55a55204a0c6b0169fc8376a096801b1d4556d57f94e686d4b370774b880c20`, signer permanen `57e0731ce3db068e6581980c53610764af05c612184ff50e18a9f4912ca59ba5`; belum di-upgrade atau dibersihkan |
| Klien Windows/outbox/quiesce | BLOCKED | Windows v0.2.0 berasal dari laporan operator, belum diukur langsung; count outbox kedua klien dan active-write state belum direkam; aplikasi belum dipaksa berhenti |
| Count database dan schema live | BLOCKED | Tidak ada sesi DSM/ops atau credential read-only yang tersedia untuk menghitung seluruh tabel dan mencocokkan baris `schema_migrations`; akses tidak diarahkan ke port MariaDB atau credential lain secara improvisasi |
| Backup baru NAS-only | BLOCKED / OWNER RISK ACCEPTED | Hyper Backup secara langsung melaporkan tidak ada backup task dan bundle logis baru belum dibuat. Pemilik pada 2026-08-05 memilih agar backup dan data tetap hanya di NAS serta melarang salinan ke Mac. Backup ini dapat melindungi dari kegagalan migrasi/logis, tetapi bukan kehilangan seluruh NAS/volume |
| Clean scratch restore | BLOCKED | Schema/account scratch-only baru, restore, exact-old-artifact runtime, dan invariant comparison belum tersedia |
| Credential exposure/rotation | BLOCKED | Pane `General` Container Manager menampilkan environment rahasia tanpa masking selama inspeksi. Nilainya tidak disalin ke receipt atau repository; credential database dan owner-bootstrap harus dirotasi melalui prosedur terkoordinasi sebelum rollout |
| Helper preflight satu-kali | PREPARED / TIDAK DIJALANKAN | `scripts/ch-core-v021-preflight.sh` lulus shell syntax dan 4 focused test, gagal tertutup tanpa approval/quiesce/outbox nol, hanya mengizinkan count tabel + dump + verify, dan staged di NAS dengan SHA-256 `137f82f862468a43c1485907b45774b2bd6bbc226edd624421c50c901a664384` |
| Deploy/migrasi 010 | BLOCKED / TIDAK DICOBA | Deployment dilarang sampai seluruh gate di atas PASS |

Checksum repository yang harus cocok dengan `schema_migrations` sebelum write
dibuka kembali:

| Version | Migration | SHA-256 |
| ---: | --- | --- |
| 1 | `001_initial.sql` | `e22cfbbf1af7b72e0091c9bf8a399ac2570fc6f971723330d085d0954cf68b69` |
| 2 | `002_nota_line_page_ownership.sql` | `39fd3afbe56aef8fa4b5c317753622998f73877925f1eed24996686721f17923` |
| 3 | `003_identity_sync_protocol.sql` | `cb1ab6f8382317cf9e3abfde5f9f4edf6883eea75f06cc0c6b1d4ac54dbde581` |
| 4 | `004_replay_safe_protocol.sql` | `e82b21d3e86680432f270b51a1d61c79cd0c69105f9e9ab8212768dcc1387139` |
| 5 | `005_catalogue_import.sql` | `b36063e077279b11997bed0cb4577053b7ff6f3ff7ef19e2c13d5678163209b0` |
| 6 | `006_business_write_safety.sql` | `dbe0d11d5df5c3241c985afd2db37ce37cea24231397e62e5e8711ea84403cad` |
| 7 | `007_active_template_kind.sql` | `b03215e308d94c374cc8e2d63da47599f85cf3338f788baf3add26a47ec1ae44` |
| 8 | `008_nota_authority.sql` | `a75edec750744aa68b28be3e53b50ea001b7be0c8a50c8ea413a309adeef2cfc` |
| 9 | `009_offline_operations.sql` | `e4a35e360a8e726dc0cbfa202b9f445b684a39172ce42c8944c3a975dce892c1` |
| 10 | `010_stock_checks.sql` | `6aaa1aa921b939aad93bc1730dd46a3c1f3a0f4fa55484c5f55565b3317af105` |

`git diff` membuktikan file migrasi 001–009 identik antara commit lama
`4482af7` dan artifact v2 `2c569db`; migrasi 010 adalah penambahan yang harus
diterapkan bersama binary v2.

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

Bagian ini dipertahankan sebagai template historis release, tetapi **bukan gate
eksekusi aktif**. Pada 2026-08-05 pemilik menghapus pilot empat hari dari scope
dan memilih pemasangan Windows/Android secara manual dari GitHub. Jangan mengisi
receipt ini atau menyatakan pilot berjalan pada eksekusi saat ini.

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
