# CH Ultimate pilot v0.2.4 candidate

Rilis internal ini mempertahankan kontrak CH Core v2 dan menyiapkan workbook
`SKU_Gudang20260808075120732.xlsx` sebagai baseline katalog serta stok awal.
Tag kandidat ditentukan oleh input workflow `candidate_tag`; kandidat pertama
memakai `pilot-v0.2.4-r2`. Payload setiap kandidat adalah:

- Windows: `CH-Ultimate-0.2.4-Setup.exe`
- Android: `CHU-Companion-Mobile-0.2.4-release.apk`
- Verifikasi: `SHA256SUMS.txt`

Installer Windows memiliki batas yang diketahui: `Authenticode: NotSigned`.
Checksum wajib diverifikasi sebelum instalasi. Android tetap wajib memiliki
digest signer permanen yang diperiksa workflow rilis.

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
NAS, lalu deploy Core dari commit rilis v0.2.4 yang sama. Fixture, SKU lama,
Nota, pergerakan stok, cek stok, dan histori harga tidak boleh dihapus oleh
proses rilis ini. Perubahan data destruktif memerlukan rencana dan persetujuan
terpisah; rilis ini tidak memberi wewenang cleanup katalog.

Workflow pertama membuat GitHub draft yang belum dipublikasikan. Aset draft
yang persis sama harus diverifikasi checksum dan signer-nya, dipasang pada
Windows serta Android, lalu lulus uji fisik dan technical soak 60 menit. Hanya
setelah semua gate tersebut lulus, draft yang sama boleh diubah menjadi
prerelease publik; aset tidak boleh dibangun ulang di antara kedua tahap.

Jika pembuatan draft berhenti di tengah upload, draft yang tidak lengkap tidak
boleh diedit, ditimpa, dihapus, atau dipublikasikan. Jalankan ulang workflow
dengan `candidate_tag` baru berikutnya, misalnya `pilot-v0.2.4-r3`; pemeriksaan
fail-closed akan memastikan tag baru belum pernah dipakai sebelum membuatnya.
Kandidat lengkap yang menemukan bug saat uji fisik juga harus dipertahankan;
perbaikan diterbitkan sebagai nomor kandidat berikutnya dari commit baru, bukan
dengan mengganti aset draft kandidat lama.

Klien hanya terhubung ke `https://192.168.50.14:8443` pada LAN bisnis. Pilot
empat hari tidak termasuk; penerimaan menggunakan uji fisik dan technical soak
60 menit. Sertifikasi cetak terbatas pada printer virtual Windows. Rilis ini
tidak menyatakan disaster recovery atau printer fisik telah tersertifikasi.
