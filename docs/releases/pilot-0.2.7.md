# CH Ultimate pilot v0.2.7 candidate

Rilis internal ini mempertahankan **Rekomendasi Restock** pada halaman Barang
Kosong dan memperbaiki barcode pada kartu minimum 20 x 15 mm agar memakai Kode
Produk resmi yang pendek, bukan Nomor SKU gudang yang dapat sangat panjang. Tag kandidat ditentukan oleh input workflow
`candidate_tag`; kandidat pertama memakai `pilot-v0.2.7-r2`. Payload setiap
kandidat adalah:

- Windows: `CH-Ultimate-0.2.7-Setup.exe`
- Android: `CHU-Companion-Mobile-0.2.7-release.apk`
- Verifikasi: `SHA256SUMS.txt`

Installer Windows memiliki batas yang diketahui: `Authenticode: NotSigned`.
Checksum wajib diverifikasi sebelum instalasi. Android tetap wajib memiliki
digest signer permanen yang diperiksa workflow rilis.

## Rekomendasi Restock

1. Kandidat merupakan gabungan SKU kosong yang terjual dalam 60 hari terakhir
   dan kelompok teratas SKU terlaris dalam 30 hari terakhir.
2. SKU hanya memenuhi syarat jika pernah memiliki stok dan memiliki penjualan
   bersih positif. Perhitungan mengikuti lifecycle Nota dan batas hari WITA.
3. Peringkat warna hijau, kuning, dan merah dihitung secara deterministik dari
   penjualan 30 hari, tanggal penjualan terakhir, dan penjualan 60 hari.
4. Filter supplier membatasi tampilan dan PDF tanpa menghapus pilihan supplier
   lain. Rekomendasi dikelompokkan menurut supplier.
5. Jumlah restock dapat dikoreksi dengan keyboard. Aksi “Kurangi dari laporan”
   hanya mengeluarkan SKU dari pilihan laporan sesi berjalan dan tidak mengubah
   stok nyata.
6. PDF khusus menggunakan A4 portrait dan hanya menampilkan gambar, nama SKU,
   serta jumlah restock. Warna peringkat disampaikan melalui bingkai kartu.

## Barcode dan label

1. QR pada kartu minimum tetap berukuran 8 mm agar dapat dipindai.
2. QR dan copy manusia memakai identifier `product_code` resmi. SKU manual yang
   belum memiliki identifier tersebut tetap memakai Nomor SKU sebagai fallback.
3. Kartu barcode 20 x 15 mm memakai copy compact yang dapat membungkus baris,
   tanpa prefix yang menghabiskan ruang.
4. Gate browser mengukur overflow copy pada satu kartu thermal dan 51 kartu A4.
5. Preview, QR, dan output dokumen memakai identifier yang sama; nama file PDF
   dibatasi 120 karakter agar SKU gudang panjang tetap dapat disimpan melalui
   dialog Windows tanpa mengubah payload barcode.
   PDF nyata dari aplikasi Windows terpasang tetap wajib diperiksa sebelum draft
   dipublikasikan.

## Kontrak dan kompatibilitas

1. Versi desktop dan Android adalah `0.2.7`; Android memakai `versionCode 14`.
2. Kontrak CH Core tetap `apiSchemaVersion: 2`; rilis ini tidak menambah migrasi
   database, endpoint, atau mutasi stok baru.
3. Perbaikan buffer keyboard Nota dari v0.2.5 tetap dipertahankan.
4. Klien hanya terhubung ke `https://192.168.50.14:8443` pada LAN bisnis.

Kontrak rekonsiliasi katalog aman dari v0.2.5 juga tetap berlaku dan
mempertahankan ID SKU serta histori harga yang sudah ada:

1. SKU lama yang tidak ada di workbook dipertahankan; identifier tambahan tetap dipertahankan.
2. Nota, pergerakan stok, cek stok, dan histori harga yang sudah ada tidak
   dihapus atau dijadikan alasan untuk menolak rekonsiliasi.
3. Selisih stok yang sah dicatat sebagai movement `catalogue_reconciliation`;
   jumlah yang sama tidak membuat movement palsu.
4. Receipt impor tetap menjadi bukti jumlah SKU cocok, SKU baru, SKU lama yang
   tidak disentuh, serta penyesuaian stok.

Bootstrap wajib berisi `apiSchemaVersion: 2` dan `stockChecks: []`. Respons yang
tidak kompatibel harus gagal tertutup dan tidak boleh terlihat tersinkronisasi.
Rilis klien ini tidak meminta migrasi baru. Sebelum instalasi, deploy Core dari
commit rilis v0.2.5 yang sudah diterima atau verifikasi bahwa deployment itu
masih sehat dan kontrak bootstrap tersebut masih valid.

## Gate sebelum dipakai

Workflow pertama membuat GitHub draft yang belum dipublikasikan. Aset draft
yang sama harus diverifikasi checksum dan signer-nya, dipasang pada Windows dan
Android, lalu lulus acceptance aplikasi terpasang terhadap CH Core/NAS yang
sehat. Uji Windows wajib memakai mouse dan keyboard tingkat Windows; JavaScript
hanya boleh membaca hasil. Gunakan data berlabel `ACCEPTANCE TEST ONLY`, jangan
ubah data kerja asli, dan buktikan bahwa mengeluarkan SKU dari laporan tidak
mengubah stok.

Sebelum acceptance, pastikan backup dan scratch restore NAS masih valid. Fixture,
SKU lama, Nota, movement, cek stok, serta histori harga tidak boleh dihapus oleh
rilis ini. Pilot empat hari tidak termasuk; penerimaan memakai gate fisik dan
technical soak yang ditetapkan untuk kandidat ini.

PDF A4 nyata harus dibuka dan diperiksa agar tidak kosong atau terpotong.
Regression smoke mencakup Barang Kosong, Stok Menipis, Nota, ekspor, cetak/PDF,
offline/reconnect, serta persistensi setelah restart. Satu kegagalan fungsi,
data, sinkronisasi, input native, atau layout memblokir publikasi.

Jika pembuatan draft berhenti di tengah upload, draft yang tidak lengkap tidak
boleh diedit, ditimpa, dihapus, atau dipublikasikan. Jalankan workflow dengan
nomor kandidat baru berikutnya, misalnya `pilot-v0.2.7-r3` setelah kegagalan
parsial r2. Rilis ini belum boleh dinyatakan siap dipakai nyata hanya berdasarkan
tes otomatis; bukti acceptance fisik dan pemeriksaan NAS tetap wajib dicatat
sebelum draft yang sama dipublikasikan.
