# Bukti rilis dan pilot v0.2.1

Dokumen ini membedakan bukti otomatis dari penerimaan lingkungan fisik. Jangan
isi nilai yang belum diukur dengan nol, dan jangan simpan credential, token,
private key, dump, atau byte data bisnis di sini.

## Gate otomatis repository

| Gate | Status | Receipt |
| --- | --- | --- |
| Automated kontrak rilis, typecheck, dan package contract | PASS | `BELUM DIISI: commit, waktu WITA, output` |

`PASS` di atas hanya berarti gate otomatis lokal telah dijalankan. Ini bukan
bukti penerimaan instalasi, deploy, atau penggunaan fisik.

## Penerimaan yang belum diverifikasi

| Gate | Status | Receipt yang wajib dicatat |
| --- | --- | --- |
| Windows terpasang | BELUM DIVERIFIKASI | versi produk, sidebar `file://`, SHA-256 |
| Android fisik | BELUM DIVERIFIKASI | package ID, versionName 0.2.1, versionCode 8, signer digest |
| deploy CH Core | BELUM DIVERIFIKASI | health CA-validated, `apiSchemaVersion: 2`, `stockChecks` |
| cetak | BELUM DIVERIFIKASI | dialog Windows, PDF, XLSX, waktu WITA |

Sebelum pemasangan, cocokkan Android dengan application ID
`com.tokoch.chucompanion` dan signer permanen
`57e0731ce3db068e6581980c53610764af05c612184ff50e18a9f4912ca59ba5`.

## Receipt pilot empat hari WITA

Pilot hanya dimulai setelah kedua klien terpasang dan CH Core v2 diterima pada
data salinan. Empat receipt berikut adalah empat hari kalender WITA berturut-
turut, bukan aturan prioritas rekomendasi.

### Hari 1 WITA

| Koneksi/sinkronisasi | Outbox blocked/replayed | Nota | Gambar | Cek stok | Print/PDF/XLSX | Restart | Error retry-visible | Disposisi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` |

### Hari 2 WITA

| Koneksi/sinkronisasi | Outbox blocked/replayed | Nota | Gambar | Cek stok | Print/PDF/XLSX | Restart | Error retry-visible | Disposisi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` |

### Hari 3 WITA

| Koneksi/sinkronisasi | Outbox blocked/replayed | Nota | Gambar | Cek stok | Print/PDF/XLSX | Restart | Error retry-visible | Disposisi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` |

### Hari 4 WITA

| Koneksi/sinkronisasi | Outbox blocked/replayed | Nota | Gambar | Cek stok | Print/PDF/XLSX | Restart | Error retry-visible | Disposisi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` | `BELUM DIISI` |

Hari 4 hanya dapat ditutup setelah semua insiden memiliki disposisi atau secara
eksplisit memblokir rollout. Receipt empat hari ini bukan prioritas rekomendasi
empat tanggal kalender WITA.
