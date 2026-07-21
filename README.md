# CH Ultimate

Frontend-only Electron demo for Toko CH operational workflows.

## Run locally

```bash
npm install
npm start
```

## Verify

```bash
npm run verify
npm run test:e2e
npm run package
```

## Demo boundaries

- Data exists only for the current app session and resets on reload or exit.
- Runtime XLSX imports are parsed in memory and are never copied into this repository.
- Printing, final PDF export, NAS/database integration, mobile dashboards, and other CH apps are intentionally deferred.
- `CHU` is temporary branding.

The future NAS phase will replace the mock `OperationsGateway` implementation with an authoritative CH Core API.

## Import workbook

Open **SKU Gudang**, choose **Import XLSX**, then confirm the full session replacement. The runtime mapper reads `Nomor SKU`, `Judul`, `Modal Referensi`, `Semua Total Stok`, `Tautan Gambar`, `Catatan SKU Gudang`, and `Waktu Dibuat`. Long SKU values remain strings. The file is parsed in memory, is not cached, and the import summary reports loaded, skipped, and warning counts.

Reloading or closing the application discards the imported workbook, stock edits, nota, and reports. A later NAS phase should keep the existing asynchronous `OperationsGateway` boundary and replace only its mock implementation with a separately authenticated CH Core API client.

## Current demo modules

- SKU Gudang with runtime XLSX import, search, edit aliases, archive, and stock adjustment
- Buat SKU with tracked/untracked stock
- Thermal/A4 QR label builder and preview
- Fifteen-row Nota workflow with pcs/lsn pricing and in-memory stock effects
- Laporan Omzet and selectable Barang Kosong A4 preview
- Session data/status controls under Settings
