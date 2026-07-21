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
- Full-screen Nota workspace for session-only transactions
- Laporan Omzet and selectable Barang Kosong A4 preview
- Session data/status controls under Settings

## Workspace Nota

**Nota** opens as a full-screen workspace, without the CH Ultimate sidebar or generic page header. Each transaction starts at page **A** and can add pages through **Z**, **AA**, and beyond. A page keeps fifteen rows; the grid retains all ten columns and scrolls inside its own frame on narrower screens.

- **Working, archive, and trash.** Draft and reopened transactions appear in *Nota Dikerjakan*. Completing a transaction moves it to *Arsip*. Cancelling a page or transaction moves it to *Sampah*, where it can be restored; page cancellation also offers a short-lived **Urungkan** action.
- **Items and prices.** Select a SKU by name, number, or alias to link the line and seed both the PCS and LSN price. An ad-hoc item remains valid without a SKU. Prices and quantities are integer rupiah and integer units; a line can use either PCS or LSN.
- **Stock and reports.** Completion posts the active pages as one transaction. Linked tracked SKU stock is updated, while ad-hoc and untracked items do not affect stock. Reopening, editing, and completing again applies only the stock delta. Cancelling reverses its posted stock, and restoring reapplies it. Laporan Omzet reflects completed transactions.
- **Keyboard.** `Ctrl/Cmd+K` focuses Nota search; `Escape` clears it and returns focus. In the grid, `Enter` advances to the next field and arrow keys move between rows. Dialog and drawer focus stays contained; `Escape` closes a dismissible dialog or drawer and restores the triggering control.
- **Session boundary.** Reloading or closing the app discards every Nota edit, import, transaction, archive, trash entry, and report, then restores the seeded Amelia A/B demo session.

This port deliberately contains no CH Nota backend, IPC bridge, database/persistence, network API, production printing, or PDF service. The renderer continues to use the asynchronous `OperationsGateway` boundary, so a future authenticated NAS/CH Core implementation can replace the in-memory adapter without rewriting the screens.
