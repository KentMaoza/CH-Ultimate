# CH Ultimate pilot v0.2.0

Rilis ini disiapkan untuk **four-day copied-data pilot** melalui LAN bisnis.
Ini bukan produksi, bukan catatan bisnis tunggal, dan bukan bukti bahwa migrasi,
impor, instalasi, pencetakan, atau penerimaan perangkat fisik sudah selesai.

## Payload yang diharapkan

Setelah seluruh gate repository, artefak, checksum, signer, dan persetujuan
operasional lulus, prerelease publik `pilot-v0.2.0` hanya boleh memuat:

- Windows: `CH-Ultimate-0.2.0-Setup.exe`
- Android: `CHU-Companion-Mobile-0.2.0-release.apk`
- Verifikasi: `SHA256SUMS.txt`

Klien hanya terhubung ke `https://192.168.50.14:8443` dari LAN bisnis. CH Core
tidak boleh dibuka melalui QuickConnect, Tailscale Serve/Funnel, port forward,
UPnP, atau API Internet publik.

## Tujuh area revisi v0.2.0

1. **Nota desktop:** pengetikan Nota desktop tetap responsif ketika perubahan
   disinkronkan. Draf yang pernah tersinkron dapat diedit offline, sedangkan
   konflik target yang sama harus diselesaikan dengan memilih versi saya atau
   versi server.
2. **Gambar:** sinkronisasi gambar memakai cache persisten berbasis hash,
   melanjutkan antrean setelah restart/reconnect, dan menampilkan kegagalan
   yang dapat dicoba ulang tanpa menyimpan byte gambar di snapshot JSON.
3. **Rekomendasi share:** `SKU Baru` dan restock manual positif pertama
   (`Baru Restock`) diprioritaskan selama tepat empat tanggal kalender WITA:
   tanggal kejadian dan tiga tanggal berikutnya.
4. **Cek stok:** Cek Stok untuk seluruh SKU aktif menampilkan `Terakhir cek stok`,
   menerima semua identifier dan barcode paket, serta mengaudit koreksi jumlah PCS.
   Antrean offline memperingatkan bahwa hitungan absolut akan menimpa stok
   server saat diputar ulang.
5. **Cetak:** desktop dapat cetak Nota, invoice, label, dan barcode melalui
   dialog sistem; Windows memilih printer dokumen atau thermal di dialog itu.
6. **Ekspor:** layout yang sama dapat disimpan sebagai PDF. Ekspor operasional
   desktop menyediakan XLSX, sedangkan PDF operasional dibatasi 300 baris dan
   melaporkan jumlah yang cocok serta disertakan.
7. **Katalog:** impor tepat dari `SKU_Gudang20260804080716145.xlsx` hanya boleh
   memakai workbook yang SHA-256-nya
   `f1f4675327fac107ef9f78c114b8afe86389d5543b204540ed45e74f9b15e49c`,
   sesudah preview dan persetujuan pemilik.

## Instalasi dan penandatanganan

- Android wajib ditandatangani dengan identitas pilot permanen yang digest
  sertifikatnya dipin di workflow. Keempat secret signing wajib tersedia;
  build release gagal tertutup jika satu saja hilang.
- Windows tetap merupakan pilot publik yang tidak ditandatangani Authenticode.
  Jangan menyebut installer Windows sebagai production-signed.
- Debug APK hanya untuk verifikasi workflow dan tidak boleh dipublikasikan.
- Cocokkan kedua payload dengan `SHA256SUMS.txt`, lalu verifikasi kembali
  package/version Android dan digest signer sebelum instalasi.

## Batas pilot empat hari

Jalankan hanya setelah runbook maintenance API v0.2 selesai dan semua gate
yang masih `BLOCKED` telah memperoleh bukti. Pilot memakai salinan data, satu
laptop Windows, dan satu ponsel Android selama empat hari kalender. Catat Nota
lintas perangkat, konflik dan restart, gambar dua arah, QR/barcode paket, audit
stok paksa, print dokumen/thermal, PDF/XLSX, retry gambar, dan restart Core.

Windows printing, kamera/share Android, artefak signed v0.2.0, publikasi GitHub,
deployment Core API v2, impor workbook, serta penerimaan fisik belum dibuktikan
oleh perubahan repository ini.
