# CH Ultimate pilot v0.2.3

Patch ini mempertahankan seluruh perbaikan klien v0.2.2 dan memasangkan
installer dengan source CH Core yang memiliki rekonsiliasi katalog aman.
Payload GitHub prerelease `pilot-v0.2.3` adalah:

- Windows: `CH-Ultimate-0.2.3-Setup.exe`
- Android: `CHU-Companion-Mobile-0.2.3-release.apk`
- Verifikasi: `SHA256SUMS.txt`

## Perbaikan Core

1. Impor workbook mencocokkan SKU lewat identifier yang dinormalisasi dan
   mempertahankan ID SKU, ID identifier, waktu dibuat, hash gambar, serta
   histori yang sudah ada.
2. SKU arsip yang cocok dipulihkan tanpa membuat identitas duplikat.
3. SKU aktif yang tidak cocok, identifier tambahan, atau kecocokan silang ke
   dua SKU memblokir transaksi sebelum penulisan.
4. Stok baseline memakai upsert dengan kenaikan `row_version`; change log dan
   audit mencatat hasil rekonsiliasi tanpa menghapus histori lama.
5. SKU arsip yang tidak cocok dipertahankan dan dihitung di audit untuk review
   eksplisit; tidak ada penghapusan katalog otomatis.

## Prasyarat dan urutan pembaruan

Klien v0.2.3 hanya bekerja dengan CH Core v2 yang mengirim
`apiSchemaVersion: 2` dan selalu menyertakan `stockChecks: []` bila belum ada
cek stok. Bootstrap tidak kompatibel harus gagal tertutup.

Sebelum instalasi manual, operator wajib menyelesaikan backup dan scratch
restore di NAS, deploy Core dari commit rilis v0.2.3 yang sama, lalu impor
workbook yang disetujui. Pengguna memasang kedua klien sendiri dari halaman
GitHub Releases setelah checksum diverifikasi.

Klien hanya terhubung ke `https://192.168.50.14:8443` pada LAN bisnis. Pilot
empat hari tidak termasuk dalam eksekusi ini. Rilis otomatis tidak membuktikan
deployment Core, impor live, instalasi fisik, sinkronisasi, atau cetak.
