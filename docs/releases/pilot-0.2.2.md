# CH Ultimate pilot v0.2.2

Rilis pengganti keamanan ini mempertahankan seluruh perbaikan v0.2.1 dan
memperbarui dependensi pembuat PDF sebelum CH Core v2 dipasang. Payload
prerelease `pilot-v0.2.2` adalah:

- Windows: `CH-Ultimate-0.2.2-Setup.exe`
- Android: `CHU-Companion-Mobile-0.2.2-release.apk`
- Verifikasi: `SHA256SUMS.txt`

## Perbaikan klien

1. **Status sinkronisasi** hanya menyatakan tersinkronisasi pada fase `online`
   setelah bootstrap valid.
2. **Pesan kompatibilitas** menggantikan data nol palsu ketika CH Core belum
   kompatibel; **diagnostik teknis** tetap berada di log.
3. Field Nota desktop, termasuk **Nama Barang**, Jenis, PCS, dan LSN, dapat
   dipakai setelah bootstrap v2 valid.
4. **Tombol Kembali Android** kembali ke layar asal sebelum aplikasi boleh
   keluar dari Beranda tingkat atas.
5. **Logo sidebar Windows** memakai aset Vite yang aman untuk `file://`.
6. jsPDF dipatok pada **jsPDF 4.2.1**. Audit runtime rilis wajib berakhir
   **tanpa critical/high**; advisory moderate `uuid` transitif ExcelJS dicatat
   sebagai residual tidak terjangkau karena aplikasi tidak memanggil UUID
   v3/v5/v6 dengan buffer dari pengguna.

## Prasyarat dan urutan pembaruan

Klien v0.2.2 hanya bekerja dengan CH Core v2 yang mengirim
`apiSchemaVersion: 2` dan selalu menyertakan `stockChecks: []` bila belum ada
cek stok. Bootstrap v1 atau v2 malformed harus gagal tertutup tanpa jalur tulis
kompatibilitas tersembunyi.

Terbitkan v0.2.2 sebelum maintenance CH Core v2. Lalu selesaikan backup dan
scratch restore NAS, deploy Core dari commit rilis yang sama, impor workbook,
dan baru instal kedua klien secara manual dari GitHub. v0.1.5 hanya dapat
dipakai sebelum Core v2; setelah Core v2 live, v0.1.5 harus gagal tertutup.

Klien hanya terhubung ke `https://192.168.50.14:8443` pada LAN bisnis. Pilot
empat hari telah dihapus dari eksekusi ini. Rilis otomatis tidak membuktikan
instalasi fisik Windows/Android, deployment Core, sinkronisasi, atau cetak.
