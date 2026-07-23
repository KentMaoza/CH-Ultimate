# CHU Companion Mobile — Rekomendasi Share per SKU

## Tujuan

Port fitur **Rekomendasi Share** dari CH Ultimate Windows ke CHU Companion Mobile. Aplikasi ponsel memakai aturan rekomendasi yang sama, tetapi tindakan berbagi dilakukan untuk tepat satu SKU setiap kali, bukan PDF atau daftar massal.

## Batasan

- Data tetap berasal dari `OperationsGateway` dan hanya hidup selama sesi aplikasi.
- Tidak ada NAS, API, sinkronisasi desktop, database, atau penyimpanan data bisnis.
- Tidak ada ekspor PDF di mobile.
- Stok adalah informasi internal dan tidak dimasukkan ke payload berbagi.
- File gambar sementara hanya boleh ditulis ke cache aplikasi untuk membuka Android share sheet, lalu dihapus.
- Perubahan Windows yang belum di-commit tetap dipertahankan dan tidak dirapikan sebagai bagian dari port ini.

## Arsitektur

`buildShareRecommendationReport()` di `src/domain/share-recommendations.ts` menjadi sumber aturan bersama untuk Windows dan mobile. `MobileApp` menambah view `recommendations`, sementara komponen `ShareRecommendationsView` menangani tanggal WITA, tab harian/urgent, grup supplier, dan daftar SKU.

Native capability disembunyikan di balik `SkuSharePort`. `MobileApp` menerima port tersebut melalui dependency injection agar tes tidak membutuhkan perangkat Android. Adapter native memakai plugin resmi Capacitor Share dan Filesystem; browser fallback memakai Web Share API bila tersedia.

```ts
export interface SkuSharePort {
  shareSku(sku: Sku): Promise<void>;
}
```

## Alur Pengguna

1. Pengguna menekan **Rekomendasi Share** di Beranda.
2. Layar menampilkan tanggal WITA hari ini, tab **Rekomendasi Harian** dan **SKU Urgent**, serta SKU yang dikelompokkan berdasarkan suffix supplier `CHxxx`.
3. Urutan dan kelayakan mengikuti Windows: SKU aktif, stok positif, tertua tidak keluar lebih dulu, maksimal 300 SKU; urgent berarti lebih dari delapan bulan kalender.
4. Pengguna dapat membuka detail SKU atau menekan **Bagikan SKU** pada salah satu baris.
5. Android share sheet menerima satu gambar produk dan teks:

   ```text
   <nama produk>
   SKU: <nomor SKU>
   Harga referensi: <rupiah bulat>
   ```

6. Bila gambar rusak atau kosong, teks tetap dapat dibagikan. Bila share sheet dibatalkan/gagal, layar menampilkan pesan non-destruktif dan data tidak berubah.

## Struktur Tampilan

- Navigasi bawah tetap tiga tujuan agar tidak sesak pada 360 px dan teks 200%.
- Beranda mendapat tombol penuh-lebar **Rekomendasi Share** di bawah dua aksi cepat yang sudah ada.
- Layar rekomendasi memakai desain monokrom yang sudah disetujui:
  - heading dan tombol kembali;
  - input tanggal;
  - dua tab;
  - ringkasan jumlah;
  - section supplier;
  - baris vertikal yang memuat gambar, identitas, harga, stok internal, usia pergerakan, tombol detail, dan tombol share.
- Tombol sentuh minimal 44 px, kode panjang dapat wrap, dan layout tidak boleh overflow pada 360×800, 390×844, atau teks 200%.

## Penanganan File Gambar

Adapter native mengambil asset gambar lokal, mengubahnya menjadi base64, lalu menulis file ke `Directory.Cache`. URI cache diberikan ke Capacitor Share bersama teks. File cache dihapus pada blok `finally`. Folder cache tidak memerlukan izin penyimpanan eksternal dan tidak menjadi persistence data bisnis.

## Pengujian

- Unit: payload hanya berisi nama, nomor SKU, dan harga; stok tidak bocor.
- Component: pintasan Beranda, tab harian/urgent, grup supplier, tanggal, buka detail, status share berhasil/gagal, dan tepat satu SKU diteruskan ke port.
- Adapter: image + text, fallback text-only, dan cleanup cache walau share gagal.
- Regression: seluruh unit test desktop/mobile, typecheck, mobile build, Capacitor sync, Gradle tests, lint, signed release APK.
- Visual: interaksi inti dan overflow pada 360×800, 390×844, serta teks 200%.

## Kriteria Selesai

Fitur dianggap selesai ketika pengguna dapat memilih satu SKU rekomendasi dan membuka Android share sheet berisi gambar serta teks SKU tersebut, tanpa PDF, stok, jaringan, atau persistence data bisnis; seluruh verifikasi otomatis lulus dan APK signed baru tersedia.
