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
- Printing Nota/template label/invoice and their PDF exports, NAS/database integration, mobile dashboards, and other CH apps are intentionally deferred. Rekomendasi Share shares one SKU at a time through the system share sheet or its local fallback, while SKU Gudang barcode can use the operating system print dialog.
- `CHU` is temporary branding.

The future NAS phase will replace the mock `OperationsGateway` implementation with an authoritative CH Core API.

## Import workbook

Open **SKU Gudang**, choose **Import XLSX**, then confirm the full session replacement. The runtime mapper reads `Nomor SKU`, `Judul`, `Modal Referensi`, `Semua Total Stok`, `Tautan Gambar`, `Catatan SKU Gudang`, and `Waktu Dibuat`. Long SKU values remain strings. The file is parsed in memory, is not cached, and the import summary reports loaded, skipped, and warning counts.

Reloading or closing the application discards the imported workbook, stock edits, nota, and reports. A later NAS phase should keep the existing asynchronous `OperationsGateway` boundary and replace only its mock implementation with a separately authenticated CH Core API client.

## Current demo modules

- SKU Gudang with runtime XLSX import, search, edit aliases/prices, archive, explicit add/subtract stock actions, and quantity-controlled QR barcode printing
- Perubahan SKU with date-filtered price/quantity history and CSV price export
- Rekomendasi Share with daily supplier grouping, oldest-stock priority, a 300-SKU daily cap, an urgent over-eight-month section, and per-SKU sharing
- Buat SKU with tracked/untracked stock
- Thermal/A4 QR label builder plus configurable invoice template preview
- Full-screen Nota workspace for session-only draft/reopened transactions
- Dedicated Arsip Nota master-detail module with collapsible read-only previews and Sampah restore
- Laporan Omzet and selectable low-stock/Barang Kosong A4 preview
- Session data/status controls under Settings

## Workspace Nota

**Nota** opens as a full-screen workspace, without the CH Ultimate sidebar or generic page header. Each transaction starts at page **A** and can add pages through **Z**, **AA**, and beyond. A page keeps fifteen rows; the grid retains all ten columns and scrolls inside its own frame on narrower screens.

- **Working, archive, and trash.** Draft and reopened transactions appear in *Nota Dikerjakan*, with customer/date filters and 50-item pagination. Completed transactions live in the dedicated sidebar module **Arsip Nota**, which uses a searchable master-detail layout with place/date filters and collapsible read-only A/B/C previews. **Buka kembali untuk edit** is a separate confirmed action. Cancelling a page or transaction moves it to the Arsip module's *Sampah* tab, where it can be restored.
- **Items and prices.** Choose a target row, then select a SKU from the collapsible **SKU Gudang** panel above the grid. Search supports the current number, old aliases, and name; archived SKU is excluded while zero, negative, and untracked stock stays selectable. An ad-hoc item remains valid without a SKU. The grid orders PCS before LSN, keeps the active unit as a black block, and normalizes Indonesian thousands separators while typing (for example `52000`, `52.000`, and transient `5.2000` all resolve to `52.000`).
- **Typed text.** Pelanggan, Tempat, Nama Barang, Jenis, and Nama SKU use Title Case as the operator types. Existing uppercase codes such as `XL` stay intact and supplier codes such as `ch001` become `CH001`; selecting an existing warehouse SKU never rewrites its stored name.
- **Stock and reports.** Completion posts the active pages as one transaction. Linked tracked SKU stock is updated, while ad-hoc and untracked items do not affect stock. Reopening, editing, and completing again applies only the stock delta. Cancelling reverses its posted stock, and restoring reapplies it. Laporan Omzet reflects completed transactions.
- **Keyboard, copy, and text size.** `Ctrl/Cmd+K` focuses Nota search; `Escape` clears it and returns focus. Arrow keys move across every non-destructive grid cell, while `Shift+Arrow` keeps native text selection so names and formatted prices can be copied with `Ctrl/Cmd+C`; **Hapus** remains Tab-only. `Ctrl/Cmd+P` is connected to the demo print intent, but production printing remains disabled. Nota starts at 150%; `Ctrl/Cmd` with `+`, `-`, or `0` switches the session-only 100%, 125%, 150%, and 175% text presets.
- **Totals per page.** A compact summary strip shows `Total Nota A`, `Total Nota B`, and every later active suffix independently while the existing transaction total continues to aggregate all active pages.
- **Session boundary.** Reloading or closing the app discards every Nota edit, import, transaction, archive, trash entry, and report, then restores the seeded Amelia A/B demo session.

## Barang Kosong

Barang Kosong can show zero/negative stock, exactly one piece, exactly two pieces, or every tracked SKU at two pieces or below. It can also be searched by SKU name or number and filtered by a supplier code found only at the end of the name (`CH` followed by digits). Codes keep their exact zero padding, so `CH02` and `CH002` are separate suppliers. **Pilih semua hasil filter** adds the current result to the report selection without dropping items chosen through another filter. After a SKU is selected, its session-only planned restock quantity from `0` to `9.999` is edited directly in the **Laporan Barang Kosong** preview; it never changes warehouse stock.

## Rekomendasi Share

Rekomendasi Share uses active SKU with positive stock. It sorts by the latest completed Nota sale; a SKU that has never sold uses its creation time as the baseline. The daily list is capped at 300 SKU and grouped by the trailing supplier code found in the SKU name or number, such as `CH009` and `CH010`. The **SKU Urgent** tab contains items that have not moved for more than eight calendar months. Choosing another date recalculates the session-only recommendation from the data available on that date. **Bagikan SKU** shares one selected product's image, name, SKU number, and reference price without warehouse stock. When the operating-system share sheet is unavailable, the local dialog can copy the same information or save the product image.

## Template Label & Invoice

The template module keeps the existing thermal/A4 label builder and adds an **Invoice** tab. Invoice width, height, font size, logo URL, bank account, address, and phone number are configurable in memory. Logo, address, phone, and bank elements can be shown/hidden and moved with explicit up/down controls. The preview uses current demo Nota data; print and PDF actions remain disabled.

This port deliberately contains no CH Nota backend, IPC bridge, database/persistence, network API, production printing, or external PDF service. The renderer continues to use the asynchronous `OperationsGateway` boundary, so a future authenticated NAS/CH Core implementation can replace the in-memory adapter without rewriting the screens.
