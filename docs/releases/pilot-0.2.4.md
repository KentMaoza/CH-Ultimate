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
2. SKU arsip yang cocok dipulihkan. SKU lama yang tidak ada di workbook dan
   identifier tambahan tetap dipertahankan; hanya kecocokan identifier silang
   yang ambigu yang memblokir transaksi.
3. Nota, pergerakan stok, cek stok, dan histori harga yang sudah ada tidak
   dihapus atau dijadikan alasan untuk menolak impor.
4. Stok SKU baru dibuat sebagai baseline. Selisih stok pada SKU yang cocok
   dicatat sebagai movement `catalogue_reconciliation`, audit, dan change-log;
   jumlah yang sama tidak membuat movement palsu.
5. Receipt impor menyimpan jumlah SKU cocok, SKU baru, SKU lama yang tidak
   disentuh, penyesuaian stok, dan kecocokan stok tanpa selisih agar replay dan
   pemeriksaan pascadeploy dapat dibuktikan.
6. Klien memerlukan `apiSchemaVersion: 2` dan `stockChecks: []`; bootstrap yang
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
