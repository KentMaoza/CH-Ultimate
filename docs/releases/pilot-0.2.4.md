# CH Ultimate pilot v0.2.4

Rilis internal ini mempertahankan kontrak CH Core v2 dan menyiapkan workbook
`SKU_Gudang20260808075120732.xlsx` sebagai baseline katalog serta stok awal.
Payload GitHub prerelease `pilot-v0.2.4` adalah:

- Windows: `CH-Ultimate-0.2.4-Setup.exe`
- Android: `CHU-Companion-Mobile-0.2.4-release.apk`
- Verifikasi: `SHA256SUMS.txt`

## Kontrak katalog dan Core

1. Impor workbook melakukan rekonsiliasi katalog aman lewat identifier yang
   dinormalisasi dan mempertahankan ID SKU serta histori yang sudah ada.
2. SKU arsip yang cocok dipulihkan; SKU aktif yang tidak cocok, identifier
   tambahan, atau kecocokan silang memblokir transaksi sebelum penulisan.
3. Stok baseline memakai upsert dan audit. Tidak ada penghapusan katalog otomatis.
4. Klien memerlukan `apiSchemaVersion: 2` dan `stockChecks: []`; bootstrap yang
   tidak kompatibel gagal tertutup dan tidak boleh terlihat tersinkronisasi.

## Prasyarat operasional

Sebelum impor live, operator wajib menyelesaikan backup dan scratch restore di
NAS, lalu deploy Core dari commit rilis v0.2.4 yang sama. Pembersihan fixture
hanya boleh dilakukan setelah tabel live membuktikan tidak ada Nota, pergerakan
stok, cek stok, atau histori harga manual.

Klien hanya terhubung ke `https://192.168.50.14:8443` pada LAN bisnis. Pilot
empat hari tidak termasuk; penerimaan menggunakan uji fisik dan technical soak
60 menit. Sertifikasi cetak terbatas pada printer virtual Windows. Rilis ini
tidak menyatakan disaster recovery atau printer fisik telah tersertifikasi.
