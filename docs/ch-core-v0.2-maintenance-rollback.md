# CH Core API v0.2 maintenance, rollback, dan receipt

Runbook versioned ini hanya menyiapkan prosedur untuk copied-data LAN pilot
v0.2.0 dengan `apiSchemaVersion: 2`. Menambahkan dokumen ini tidak memberi izin
untuk menjalankan migrasi, menghentikan layanan, menghapus data, mengimpor
workbook, memasangkan perangkat, atau menerbitkan release. Setiap tindakan live
memerlukan jendela maintenance dan persetujuan pemilik tersendiri.

## Batas wajib

- Umumkan jendela pemeliharaan, operator, target Core, waktu mulai/akhir, dan
  jalur eskalasi kepada semua pengguna sebelum menyentuh layanan.
- Lakukan quiesce terhadap seluruh write: hentikan aktivitas pengguna secara
  terkoordinasi, pastikan tidak ada request write aktif, dan catat jumlah outbox
  tiap klien. Jangan menghapus outbox yang belum selesai.
- Gunakan hanya endpoint LAN `https://192.168.50.14:8443` dan CA publik yang
  dibundel. QuickConnect, Tailscale Serve/Funnel, port forward, UPnP, dan bypass
  TLS tidak diizinkan.
- Simpan semua credential di boundary yang sudah disetujui. Receipt tidak boleh
  memuat token, password, private key, secret signing, atau isi dump.

## Receipt sebelum maintenance

Isi semua kolom; nilai kosong berarti gate `BLOCKED`, bukan dianggap lulus.

| Bidang | Receipt |
| --- | --- |
| Waktu mulai WITA / operator | `BELUM DIISI` |
| Commit dan checksum bundle source | `BELUM DIISI` |
| Core lama: image/artifact/schema | `BELUM DIISI` |
| Klien lama: versi dan jumlah perangkat | `BELUM DIISI` |
| Pengumuman diterima / write di-quiesce | `BELUM DIISI` |
| Outbox per perangkat / request write aktif | `BELUM DIISI` |
| Persetujuan pemilik untuk backup/clear/deploy | `BELUM DIISI` |

### Health CA-validated

Jalankan dari administrator Mac dengan file CA repository yang dipercaya;
jangan menambahkan `-k` atau mematikan verifikasi sertifikat:

```sh
curl --fail --silent --show-error --cacert resources/ch-core-ca.pem \
  https://192.168.50.14:8443/health/live
curl --fail --silent --show-error --cacert resources/ch-core-ca.pem \
  https://192.168.50.14:8443/health/ready
```

Receipt harus menyimpan waktu, status HTTP, body yang telah disanitasi,
fingerprint leaf, dan hasil `PASS`/`BLOCKED` untuk `/health/live` serta
`/health/ready`. Kedua health harus CA-validated dan lulus sebelum berlanjut.

### Hitungan tepat semua tabel

Dengan akses read-only yang disetujui, Hitung tepat semua tabel berikut sebelum
backup atau clear. Simpan satu nilai integer untuk setiap tabel, bukan perkiraan
dan bukan jumlah gabungan:

| Kelompok | Tabel | Jumlah sebelum |
| --- | --- | --- |
| Skema | `schema_migrations` | `BELUM DIISI` |
| Identitas | `devices`, `pairings`, `owner_recovery` | masing-masing `BELUM DIISI` |
| Katalog | `skus`, `sku_identifiers`, `price_history`, `templates`, `imports` | masing-masing `BELUM DIISI` |
| Gambar | `image_assets`, `image_jobs` | masing-masing `BELUM DIISI` |
| Nota/omzet | `notas`, `nota_pages`, `nota_lines`, `nota_postings`, `nota_daily_sequences`, `nota_conflicts`, `revenue_postings` | masing-masing `BELUM DIISI` |
| Stok | `stock_movements`, `stock_balances`, `stock_checks` | masing-masing `BELUM DIISI` |
| Protokol/audit | `idempotency_receipts`, `audit_events`, `client_cursor_acknowledgements`, `change_log` | masing-masing `BELUM DIISI` |
| Infrastruktur | `business_write_lock` | `BELUM DIISI` |

Catat juga migration version tertinggi dan checksum migrasi untuk setiap file
`server/migrations/*.sql`. Daftar `schema_migrations`, file migrasi, dan checksum
harus menghasilkan current schema yang sama sebelum deployment dimulai.

### Backup bertimestamp dan verifikasi restore

1. Buat nama bundle baru `chu-v020-YYYYMMDD-HHMMSS.bundle`. Jalankan dump logis bertimestamp
   melalui container ops yang opt-in sebagaimana dijelaskan di
   `docs/ch-core-backup-restore.md`; jangan menimpa bundle lama.
2. Verifikasi marker `COMPLETE`, struktur bundle, dan SHA-256 `dump.sql` dengan
   verifier repository. Salin bundle lengkap ke target independen yang
   disetujui, lalu validasi SHA-256 salinan terhadap sumber.
3. Buat schema scratch baru dan kosong bernama `chu_restore_<suffix>` dengan
   credential scratch-only. Lakukan restore bersih; jangan restore ke `chu` dan
   jangan melanjutkan ke schema scratch parsial setelah kegagalan.
4. Jalankan Core artifact yang cocok terhadap scratch terisolasi. Bandingkan
   semua hitungan tabel, SKU/identifier, stock ledger/balance, Nota/omzet,
   audit/change cursor, serta hash/referensi gambar.
5. Simpan receipt dump, kedua SHA-256, hasil restore bersih, checksum artifact,
   waktu WITA, dan operator. Gate tetap `BLOCKED` jika satu perbandingan belum
   cocok atau belum memiliki penjelasan yang disetujui.

### Tabel identitas yang wajib dipertahankan

Tabel `devices`, `pairings`, dan `owner_recovery` memuat identitas pemilik,
perangkat, token/auth hash, status revoke, pairing, dan recovery. Ketiganya wajib
dipertahankan byte-for-byte selama clear data pilot. Catat count dan checksum
terbatas sebelum/sesudah tanpa mengekspor credential mentah. `schema_migrations`
juga tidak boleh dihapus atau dimodifikasi oleh clear data bisnis. Baris tunggal
`business_write_lock` adalah infrastruktur serialisasi write dan wajib tetap ada;
ia bukan data bisnis pilot.

### Allowlist tabel data bisnis pilot

Clear hanya boleh dilakukan setelah dump dan restore bersih lulus, semua write
tetap quiesce, target schema telah dikonfirmasi, dan ada persetujuan pemilik
untuk transaksi clear yang ditinjau. Allowlist tertutupnya adalah:

- Katalog/gambar: `skus`, `sku_identifiers`, `price_history`, `templates`,
  `imports`, `image_assets`, `image_jobs`.
- Nota/omzet: `notas`, `nota_pages`, `nota_lines`, `nota_postings`,
  `nota_daily_sequences`, `nota_conflicts`, `revenue_postings`.
- Stok: `stock_movements`, `stock_balances`, `stock_checks`.
- Protokol/audit bisnis: `idempotency_receipts`, `audit_events`,
  `client_cursor_acknowledgements`, `change_log`.

Tidak ada tabel lain yang boleh masuk transaksi clear. Operator wajib meninjau
urutan foreign key, menyimpan SQL yang disetujui sebagai evidence terpisah,
mencatat hitungan sebelum/sesudah, dan rollback transaksi jika tabel target atau
count berbeda dari receipt. Jangan menambahkan nama tabel secara ad hoc saat
jendela maintenance berlangsung.

## Penerapan v0.2

1. Pastikan semua klien lama gagal tertutup sebelum menulis ketika bootstrap,
   change feed, atau acknowledgement menyatakan `apiSchemaVersion: 2` yang tidak
   didukung. Simpan evidence HTTP/client; respons error tanpa percobaan write.
2. Verifikasi checksum bundle server v0.2. Deploy satu artifact yang ditinjau
   dan biarkan advisory lock migration berjalan satu kali.
3. Cocokkan `schema_migrations` dengan daftar file dan checksum migrasi yang
   direkam. Jangan membuka write bila versi, nama, atau checksum berbeda.
4. Jalankan ulang health CA-validated. Buka hanya perangkat v0.2 yang cocok;
   klien lama tetap tertutup.
5. Bila fase clear/import disetujui terpisah, gunakan allowlist di atas dan
   workbook/hash pada receipt katalog. Preview, count, dan pilihan konflik harga
   harus cocok sebelum commit import tunggal.

## Uji baca/tulis terbatas pascadeploy

Gunakan satu perangkat pilot yang disetujui dan data uji yang dinamai jelas.
Receipt harus menyimpan request/idempotency key yang disanitasi, revision, count
sebelum/sesudah, audit id, dan hasil pada perangkat kedua:

1. Bootstrap terautentikasi dan satu baca SKU/Nota/gambar.
2. Satu edit field Nota, satu stock delta kecil, dan satu stock count yang telah
   dikonfirmasi. Pastikan replay duplikat tidak menggandakan perubahan.
3. Satu konflik target yang sama dan resolusinya; perubahan entitas lain harus
   tetap berjalan.
4. Satu upload/replace gambar dengan hash, lalu tampilan dua arah dan kegagalan
   retry-visible terkontrol.
5. Restart klien dan Core hanya dalam gate terpisah yang disetujui, lalu cocokkan
   revision, outbox, audit, dan count. Uji ini bukan izin restart otomatis.

Jika satu uji baca/tulis terbatas gagal, quiesce kembali, tahan rollout, simpan
log/evidence, dan ikuti keputusan rollback di bawah.

## Keputusan rollback yang tidak dapat ditawar

Rollback biner/database penuh diizinkan hanya sebelum ada satu pun v2 write atau
offline-outbox replay. Catat bukti bahwa kedua count masih nol sebelum memilih
rollback penuh, lalu gunakan artifact lama dan backup yang telah restore-verified
melalui prosedur recovery yang ditinjau.

Setelah ada v2 write atau offline-outbox replay, hentikan semua klien, pertahankan
Core/data/log, dan lakukan forward-fix. Jangan membuat down migration, jangan
menjalankan SQL reverse improvisasi, dan jangan mengembalikan database lama di
atas data v2. Incident owner memutuskan artifact forward-fix dan acceptance baru.

## Receipt penutupan

| Gate | Status dan evidence |
| --- | --- |
| Pengumuman, quiesce, dan outbox | `BELUM DIISI` |
| Health live/ready dengan CA | `BELUM DIISI` |
| Hitungan semua tabel | `BELUM DIISI` |
| Dump, SHA-256, dan salinan independen | `BELUM DIISI` |
| Restore bersih scratch | `BELUM DIISI` |
| Identitas/auth dipertahankan | `BELUM DIISI` |
| Klien lama fail-closed | `BELUM DIISI` |
| Current schema/checksum migrasi | `BELUM DIISI` |
| Uji baca/tulis terbatas | `BELUM DIISI` |
| v2 write count / outbox replay count | `BELUM DIISI` |
| Keputusan rollback atau forward-fix | `BELUM DIISI` |
| Waktu selesai WITA / operator / pemilik | `BELUM DIISI` |

Status akhir maintenance harus `PASS`, `BLOCKED`, atau `ROLLED BACK` per gate.
Satu baris kosong, `BELUM DIISI`, atau evidence tanpa checksum berarti belum lulus.
