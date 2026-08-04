# Task 7 report: Document output and operational exports

## Status

Complete and verified on `codex/ch-ultimate-v020`.

Assumptions kept intentionally narrow:

- Output documents render from the existing trusted React state and `OperationsGateway`; no renderer HTML, printer name, silent flag, device selection, or filesystem path crosses the preload boundary.
- Desktop print and save use Electron's current trusted `webContents`. Printer/document selection stays in the operating-system dialog.
- Operational exports contain existing in-memory/Core-projected data only. No backend, database, NAS schema, persistence, production deployment, or release metadata was added.

## Implemented behavior

### Secure desktop output boundary

- Added a two-method `window.chOutput` bridge: `printDocument` and `savePdf`.
- Added fixed IPC handlers with exact-key validation, bounded document kinds/dimensions/filenames, trusted sender/main-frame/locked-URL checks, and one active native output at a time.
- Print uses the visible system dialog with `silent: false` and `printBackground: true`.
- Save PDF uses a native save dialog, validates the Electron result as bounded `%PDF-` bytes, and writes only to the path chosen by the user.
- The renderer sends only document kind, dimensions, and a safe PDF filename. It cannot send HTML, printer/device identifiers, a silent flag, or an arbitrary path.
- Added an E2E-only fake output bridge selected by the main process's locked URL marker. It opens no native dialog and does not invoke IPC.

### Trusted document rendering

- Added a print-only React host that mounts before output, waits for fonts and bounded image readiness, and remains outside the interactive layout.
- Nota and invoice share the configured invoice dimensions, store identity, font, page content, and inclusive PPN calculation.
- Current active page is the default; all active pages can be selected. Cancelled pages are excluded, cancelled transactions are rejected/skipped, draft/reopened output displays `DRAF`, and completed Arsip output does not.
- Nota, completed Arsip Nota, invoice, label, and product barcode expose matching Print and Simpan PDF controls.
- Label and barcode plans honor thermal/A4 layout and exact quantity. Every barcode includes QR data plus human-readable `Kode Produk`.
- Mobile Nota builds the same selected current/all plan and shares its PDF through the generalized `PdfSharePort` used by browser and Android adapters.

### Ekspor Data

- Added desktop `Ekspor Data` with selectors for `SKU dan Stok Saat Ini`, `Riwayat Stok`, `Riwayat Harga`, and `Cek Stok`; query, inclusive WITA dates, and SKU status filters apply consistently.
- PDF sorting is deterministic, capped at 300 rows, and shows matched versus included counts. SKU/current-stock PDF loads only included images through the gateway at concurrency two, creates bounded thumbnails, and falls back to CHU.
- Desktop XLSX includes all matching rows without the PDF cap and the exact sheets `Ringkasan`, `SKU_Stok`, `Riwayat_Stok`, `Riwayat_Harga`, and `Cek_Stok`. Numeric values remain numeric. Image fields contain only HTTP URL, hash, and status; data/blob bytes are explicitly omitted.
- ExcelJS is isolated in a desktop-only workbook module and lazy-loaded only when XLSX is requested. The shared/mobile PDF graph does not import the workbook builder or ExcelJS.
- Mobile exposes operational PDF only through `Lainnya`, supports one selected dataset and the same filters/counts, and shares through `PdfSharePort`.
- Revenue remains a separate password-gated module and is not included in operational exports.

## Main files changed

- Boundary and host: `src/electron/output-contract.ts`, `src/electron/output-ipc.ts`, `src/main.ts`, `src/preload.ts`, `src/types.d.ts`, `src/renderer/output-context.tsx`, `src/renderer/output/PrintDocumentHost.tsx`.
- Document plans/surfaces: `src/domain/output-documents.ts`, `src/domain/nota-pdf.ts`, `src/renderer/nota/NotaWorkspace.tsx`, `src/renderer/pages/ArchiveNotaPage.tsx`, `src/renderer/pages/InvoiceTemplateBuilder.tsx`, `src/renderer/pages/LabelPage.tsx`, `src/renderer/pages/InventoryPage.tsx`.
- Operational exports: `src/domain/operational-exports.ts`, `src/domain/operational-workbook.ts`, `src/renderer/operational-pdf-images.ts`, `src/renderer/pages/OperationalExportPage.tsx`, `mobile/components/OperationalExportView.tsx`.
- Mobile sharing/integration: `mobile/ports.ts`, `mobile/native-adapters.ts`, `mobile/bootstrap.ts`, `mobile/MobileApp.tsx`, `mobile/components/MobileNotaView.tsx`, `mobile/components/MoreView.tsx`, `mobile/components/ShareRecommendationsView.tsx`.
- Focused unit and E2E coverage is under `tests/unit/*output*`, `tests/unit/operational-*`, `tests/unit/nota-pdf.test.ts`, `tests/unit/mobile-export-boundary.test.ts`, and `tests/e2e/app.spec.ts`.

## RED evidence

1. Output boundary tests initially failed because no `chOutput` contract/handlers existed and main/preload registered only CH Core.
2. Document-plan and host tests initially failed because Nota/invoice/label/barcode had no trusted print plan or mounted output host.
3. UI parity tests initially failed because print/PDF controls were disabled or barcode called `window.print` directly.
4. Mobile Nota sharing tests initially failed because recommendation sharing was a specialized port and Nota produced no PDF.
5. Operational selector/workbook/PDF tests initially failed because no export plans, WITA filtering, five-sheet workbook, cap/count reporting, or image sanitization existed.
6. Desktop/mobile export UI tests initially failed because `Ekspor Data` and the `Lainnya` entry did not exist.
7. Completed-Arsip output failed until current/all print/PDF controls were added to the read-only preview.
8. The first updated E2E run reached real native print and failed with `No printers available`; Vite had compiled the preload `process.env` check to an empty shim. The fake bridge was moved to the locked E2E URL marker and a focused no-IPC regression was added.
9. The first mobile build after export showed ExcelJS in the shared bundle. Workbook generation was moved to a desktop-only dynamically imported module, then a recursive import-graph guard was added to prevent that coupling from returning.
10. Final CSS review found the obsolete direct-`window.print` barcode rule could expose the interactive barcode sheet alongside the trusted host. A focused host-only print CSS test failed until the legacy rule was removed.

## Final verification

- Focused operational/output/preload/mobile-boundary matrix: all tests passed.
- Full renderer suite after the final CSS correction: `npm test` passed, 89 files and 619 tests.
- Renderer/mobile TypeScript: `npm run typecheck` passed.
- Mobile production build: `npm run mobile:build` passed.
  - Main mobile chunk after ExcelJS isolation: 844.00 kB uncompressed / 248.09 kB gzip.
  - jsPDF chunk: 388.08 kB uncompressed / 127.39 kB gzip.
  - Before isolation, the main chunk was 1,789.15 kB / 521.51 kB gzip.
- Local Electron arm64 package prerequisite: `npm run package` passed.
- Full Electron/mobile-browser E2E: `npm run test:e2e` passed, 10/10 tests, including fake-bridge barcode/invoice and operational PDF with no native dialogs.
- `git diff --check` passed before report/commit.

## Self-review and remaining concerns

- Confirmed the preload exposes no raw IPC and main-process validation rejects extra HTML, path, printer, device, and silent-print fields before native APIs run.
- Confirmed the print host remains mounted until native output resolves and print/PDF consume the same plan.
- Confirmed PDF limits apply after deterministic sorting and XLSX uses uncapped matching plans.
- Confirmed mobile has no static or dynamic dependency on ExcelJS or either workbook parser.
- No physical printer, Windows print dialog, physical Android share sheet, signed package, or deployed Core was exercised. These remain Task 8 physical/release gates; local mocks, generated PDF signatures, arm64 packaging, mobile build, and E2E are green.
- The mobile build still reports a non-fatal greater-than-500-kB warning for the 844.00-kB main chunk. ExcelJS has been removed from that graph; further application-wide splitting is outside this task.
- The full suite still emits the pre-existing React `act(...)` warning from `nota-core-typing.test.tsx`; all 619 tests pass.
