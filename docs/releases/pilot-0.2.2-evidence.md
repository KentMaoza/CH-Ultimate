# Bukti kesiapan rilis v0.2.2

Dokumen ini tidak menyimpan credential, token, private key, dump, atau byte
data bisnis. Nilai yang tidak dapat diukur tidak boleh diganti dengan nol.

## Gate repository dan keamanan runtime

| Gate | Status | Receipt |
| --- | --- | --- |
| Automated repository | PASS | Node 24: desktop/typecheck 92 file / 694 test; mobile 12 file / 118 test; server 50 file / 338 test + 1 acceptance skip; server typecheck; Android sync/test/lint; Electron package; Electron E2E 11/11 |
| Kontrak dependensi | PASS | jsPDF `4.2.1`; fast-uri `3.1.5`/`4.1.2`; brace-expansion `1.1.18`/`2.1.4`; tes PDF/ekspor lulus |
| Audit runtime | PASS DENGAN RESIDUAL | `npm audit --omit=dev`: `0 critical`, `0 high`, 2 moderate untuk ExcelJS/uuid; `uuid` bukan dependensi aplikasi langsung dan jalur rentan v3/v5/v6 dengan supplied buffer tidak dipanggil |
| Kontrak paket Android | PREPARED | `com.tokoch.chucompanion`; versionName `0.2.2`; versionCode `9`; signer yang dipatok `57e0731ce3db068e6581980c53610764af05c612184ff50e18a9f4912ca59ba5` |
| Payload Windows | PREPARED | `CH-Ultimate-0.2.2-Setup.exe`; hash dan ukuran diisi hanya setelah fresh download GitHub |
| Payload Android | PREPARED | `CHU-Companion-Mobile-0.2.2-release.apk`; hash dan ukuran diisi hanya setelah fresh download GitHub |

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
| Publikasi GitHub | BELUM DIVERIFIKASI | commit rilis, workflow run, tiga fresh-download artifact, SHA-256 |
| Backup NAS-only dan scratch restore | BELUM DIVERIFIKASI | receipt, count, SHA-256, invariant restore |
| Rotasi credential | BELUM DIVERIFIKASI | konfirmasi pemilik tanpa nilai credential |
| deploy CH Core | BELUM DIVERIFIKASI | source commit v0.2.2, migration 010, health dan bootstrap v2 |
| Import 3.144 SKU | BELUM DIVERIFIKASI | hash workbook, count import, rekonsiliasi harga/stok/gambar |
| Windows terpasang | BELUM DIVERIFIKASI | versi produk, sidebar, pairing, sinkronisasi |
| Android fisik | BELUM DIVERIFIKASI | package/version/signer, pairing, Back, barcode |
| cetak | BELUM DIVERIFIKASI | dialog Windows, PDF, XLSX, waktu WITA |

Pilot empat hari telah dihapus dari eksekusi saat ini sesuai keputusan pemilik.
