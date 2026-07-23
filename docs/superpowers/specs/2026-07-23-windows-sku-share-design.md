# CH Ultimate Windows — Share Satu SKU

## Tujuan

Ganti ekspor PDF pada halaman **Rekomendasi Share** desktop dengan aksi berbagi per-SKU. Setiap klik membagikan satu produk berisi gambar produk, nama, nomor SKU, dan harga referensi. Stok dan data rekomendasi internal tidak masuk ke materi yang dibagikan.

## Batas

- Logic pemilihan rekomendasi tetap memakai `buildShareRecommendationReport`.
- Halaman tetap menampilkan stok, waktu terakhir keluar, hari tidak keluar, supplier, dan status urgent untuk kebutuhan internal.
- Hapus tombol dan generator PDF serta dependency `jsPDF` apabila tidak dipakai di tempat lain.
- Tidak menambah backend, persistence, NAS, sinkronisasi, atau data produksi.
- Perubahan Nota/voice yang tidak terkait tidak masuk commit fitur ini.

## Alur Pengguna

1. Pengguna membuka **Rekomendasi Share** dan memilih tab/tanggal seperti sekarang.
2. Setiap baris SKU memiliki tombol **Bagikan SKU**.
3. Tombol hanya bekerja untuk SKU pada baris tersebut.
4. Aplikasi menyiapkan teks:

   ```text
   Nama Produk
   SKU: NOMOR-SKU
   Harga referensi: Rp 25.000
   ```

5. Jika Web Share tersedia dan menerima file, aplikasi membuka Share Sheet sistem dengan gambar serta teks.
6. Jika Share Sheet atau file share tidak tersedia, aplikasi membuka dialog **Bagikan SKU** milik CH Ultimate. Dialog menyediakan:
   - **Salin informasi** untuk menyalin teks yang sama.
   - **Simpan gambar** bila SKU mempunyai gambar yang dapat dimuat.
   - **Tutup** tanpa mengubah data.
7. Status sukses atau kegagalan ditampilkan tanpa menghapus daftar rekomendasi.

## Arsitektur

### Format bersama

Pindahkan formatter teks share SKU ke modul domain/renderer-netral agar mobile dan desktop menghasilkan isi yang sama. Formatter tidak boleh membaca atau mencantumkan stok.

### Adapter desktop

Tambahkan port kecil yang menerima satu `Sku`.

- Adapter Web Share membuat `File` dari gambar produk bila didukung.
- Kegagalan memuat gambar tidak menggagalkan share teks.
- Ketidaktersediaan atau penolakan API dibedakan: API tidak tersedia membuka fallback; pembatalan pengguna tidak dilaporkan sebagai sukses.
- Dialog fallback tetap berada di renderer dan tidak membutuhkan Node integration atau IPC baru.

Pendekatan ini mempertahankan `contextIsolation`, `nodeIntegration: false`, dan `sandbox: true`.

### UI

`RecommendationRow` menerima callback share dan status pending. Tombol ekspor global dihapus. Dialog fallback hanya menampilkan identitas publik SKU; stok dan metrik gudang tidak ditampilkan.

## Penanganan Gambar

- Ambil `imageUrl` lokal melalui `fetch`.
- Gunakan nama file aman berdasarkan nomor SKU dan tipe MIME gambar.
- Share teks tetap tersedia ketika gambar kosong atau rusak.
- Fallback **Simpan gambar** membuat unduhan file gambar lokal; tidak membuat PDF.

## Pengujian

- Formatter menghasilkan nama, nomor SKU, dan rupiah bulat tanpa stok.
- Klik pada satu baris hanya mengirim satu SKU.
- Web Share menerima teks dan gambar ketika tersedia.
- Kegagalan gambar turun menjadi share teks.
- Share API yang tidak tersedia membuka dialog fallback.
- Dialog dapat menyalin teks dan menyimpan gambar tanpa PDF.
- Tidak ada tombol ekspor PDF atau import `jsPDF`.
- Unit/component test, typecheck, Electron E2E, package build, dan regresi mobile harus lulus.

## Kriteria Selesai

- Desktop tidak lagi mengekspor rekomendasi sebagai PDF.
- Satu klik membagikan tepat satu SKU.
- Materi share tidak mengandung stok.
- Pengguna tetap dapat membagikan informasi pada runtime yang tidak menyediakan Windows Share Sheet.
- Perubahan relevan tercommit pada `main`; perubahan pengguna yang tidak terkait tetap dipertahankan.
