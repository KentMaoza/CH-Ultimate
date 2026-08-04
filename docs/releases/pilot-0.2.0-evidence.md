# Bukti persiapan pilot v0.2.0

Dokumen ini menyimpan bukti repository dan template penerimaan. Dokumen tidak
menyimpan baris workbook, byte gambar, credential, token, atau secret signing.

## Baseline katalog yang disetujui

Status repository: `PASS` berdasarkan acceptance parser workbook lokal Task 1.
Belum ada impor live ke CH Core.

| Bukti | Nilai yang disetujui |
| --- | --- |
| Nama sumber | `SKU_Gudang20260804080716145.xlsx` |
| SHA-256 | `f1f4675327fac107ef9f78c114b8afe86389d5543b204540ed45e74f9b15e49c` |
| SKU | 3,144 |
| Identifier | 6,288 |
| Total stok | 3,988 PCS |
| Referensi gambar valid | 2,786 |
| Gambar tidak tersedia | 358 |
| Total harga terpilih | Rp276,285,615 |

Konflik harga yang sudah dikodekan memilih `Modal Referensi` untuk nomor baris
Excel 1018, 1088, dan 1180. Bukti ini hanya mencatat pilihan; isi baris workbook
dan gambar biner tidak disalin ke dokumentasi.

## Template penerimaan progres gambar

Isi satu receipt per klien/perangkat dan satu ringkasan server setelah bootstrap
otoritatif. Jangan mengganti nilai yang belum diukur dengan nol.

| Bidang | Nilai | Sumber bukti |
| --- | --- | --- |
| Waktu WITA | `BELUM DIISI` | log/layar |
| Perangkat dan versi | `BELUM DIISI` | Settings/package inspector |
| `matched` | `BELUM DIISI` | total referensi yang cocok dengan filter/bootstrap |
| `included` | `BELUM DIISI` | total yang masuk antrean/receipt |
| `succeeded` | `BELUM DIISI` | selesai tersimpan dan dapat ditampilkan |
| `failed` | `BELUM DIISI` | gagal setelah upaya saat itu |
| `retry-visible` | `BELUM DIISI` | kegagalan yang terlihat dan menawarkan coba ulang |
| Hash berubah/deduplicated | `BELUM DIISI` | hash lama/baru tanpa byte gambar |
| Resume restart/reconnect | `BELUM DIISI` | receipt sebelum/sesudah |

Status fisik saat dokumen dibuat: `BLOCKED`. Belum ada bukti kamera/share Android,
dua perangkat, retry visual, atau cache setelah restart pada perangkat fisik.
