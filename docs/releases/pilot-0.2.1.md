# CH Ultimate pilot v0.2.1

Rilis pengganti ini memperbaiki enam masalah klien yang sudah terkonfirmasi
tanpa melonggarkan batas kompatibilitas CH Core. Payload prerelease
`pilot-v0.2.1` adalah:

- Windows: `CH-Ultimate-0.2.1-Setup.exe`
- Android: `CHU-Companion-Mobile-0.2.1-release.apk`
- Verifikasi: `SHA256SUMS.txt`

## Enam perbaikan terkonfirmasi

1. **Status sinkronisasi** kini selalu berasal dari fase aktual; hanya fase
   `online` yang boleh menyatakan tersinkronisasi.
2. **Pesan kompatibilitas** menggantikan dashboard bisnis bila bootstrap CH
   Core tidak kompatibel, sehingga katalog kosong tidak tampak sebagai data
   terkini.
3. **Diagnostik teknis** kesalahan parser hanya masuk ke sink diagnostik,
   sedangkan pengguna menerima pesan Indonesia yang aman.
4. Field Nota desktop, termasuk **Nama Barang**, Jenis, PCS, dan LSN tetap dapat
   digunakan setelah bootstrap v2 yang valid mencapai `online`.
5. **Tombol Kembali Android** menutup detail/overlay atau kembali ke layar asal;
   aplikasi hanya keluar dari Beranda tingkat atas.
6. **Logo sidebar Windows** dimuat sebagai aset Vite relatif agar renderer
   Electron `file://` yang dipaketkan dapat menampilkannya.

## Prasyarat dan urutan pembaruan

Klien v0.2.1 hanya bekerja dengan CH Core v2 yang mengirim
`apiSchemaVersion: 2` dan selalu menyertakan `stockChecks: []` bila belum ada
cek stok. Respons v1 atau respons v2 yang malformed harus gagal tertutup; tidak
ada jalur tulis kompatibilitas tersembunyi.

Terbitkan v0.2.1 sebelum menjalankan maintenance CH Core v2. Setelah semua
artefak diverifikasi, lakukan gate backup/restore dan deployment Core sesuai
runbook, lalu pasang klien v0.2.1 dan lakukan penerimaan fisik terbatas.
v0.1.5 hanya dapat dipakai sebelum Core v2; setelah Core v2 live, v0.1.5 harus
gagal tertutup dan tidak boleh dipakai untuk write.

Klien hanya terhubung ke `https://192.168.50.14:8443` pada LAN bisnis.

## Batas pilot

Pilot empat hari adalah observasi LAN copied-data setelah penerimaan fisik
Windows, Android, dan Core v2. Ini bukan produksi, bukan migrasi data produksi,
dan bukan izin menambah perangkat atau membuka write di luar gate. Rilis ini
tidak membuktikan instalasi Windows, perangkat Android fisik, deploy Core,
cetak, atau penerimaan pilot hanya dari pemeriksaan otomatis.
