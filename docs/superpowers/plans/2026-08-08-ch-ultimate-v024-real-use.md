# CH Ultimate v0.2.4 Real-Use Implementation Plan

**Goal:** Publish an internally deployable CH Ultimate v0.2.4, import the supplied warehouse catalogue as the initial stock baseline, and prove the Windows, Android, and NAS workflows used in daily work.

## Acceptance boundary

- Zero known reproducible defects in the named business workflows: connection/bootstrap, SKU catalogue, Nota editing/completion, stock checks/barcodes, images, export, and Windows printing.
- The supplied workbook `SKU_Gudang20260808075120732.xlsx` is the exact initial catalogue and stock baseline. It is never committed to GitHub.
- SKU rows with a zero reference price remain selectable, but Nota completion requires a positive manual price.
- Existing NAS SKUs may be cleared only after measured database evidence proves they are fixtures and contain no real Nota, stock movement, stock-check, or manual-price history.
- Before the first production data mutation, create and verify one same-NAS rollback dump and restore it into a clean scratch database.
- Printing is certified against Windows virtual printing (Microsoft Print to PDF), not a physical printer.
- Windows artifacts are for controlled internal distribution: checksum-verified but not Authenticode-signed.
- No four-day pilot. Use a 60-minute technical soak after physical acceptance.
- Final operational status may be **internal-use PASS**, but must explicitly remain **not disaster-recovery ready** and **not physical-printer certified**.

## Execution checklist

1. Establish an isolated worktree and preserve the baseline evidence.
2. Test-first update release metadata to v0.2.4 / Android versionCode 11 and pin the new workbook hash and acceptance metrics.
3. Test-first close known application gaps: zero-price Nota completion, empty-stock PDF export, source-image synchronization, large-catalogue paging, React test warning, and the reachable runtime dependency advisory.
4. Test-first repair NAS database operations for socket-only MariaDB. Mount `/run/mysqld` read-only in the ops container and use `/run/mysqld/mysqld10.sock` without opening TCP 3306 or logging credentials.
5. Run focused tests after every slice, then full typecheck, unit/integration/E2E, Android lint/test/build, Electron packaging, and production dependency audit.
6. Build Windows and Android candidates from the same exact commit; verify checksums and CI.
7. Diagnose the current CH Core 502, deploy the exact release commit with schema migration 010, and validate API schema 2 including `stockChecks`.
8. Create a same-NAS dump, verify its checksum, restore to a clean scratch database, and prove the canonical data matches.
9. Measure live tables. Clear fixture SKUs only if the approved safety predicate is true; otherwise stop without importing.
10. Stage and commit the supplied workbook transactionally and idempotently as the first business-data write; verify counts, stock totals, images, and sampled aliases.
11. Install and test the candidates on Windows and Samsung, including live cross-device sync, Android Back behavior, restart/replay/isolation, Microsoft Print to PDF, and exported XLSX/PDF files.
12. Complete a 60-minute soak, tag `pilot-v0.2.4`, publish GitHub artifacts/checksums/release notes, and report every remaining certification boundary.

## Stop conditions

- Do not import if the Core is unhealthy, the rollback restore is unproven, the existing data is not demonstrably fixture-only, or the workbook hash differs.
- Do not label synchronization successful until a valid bootstrap has completed and the live sync phase is online.
- Do not publish an internal-use PASS while any named workflow has a known reproducible defect or any required physical/NAS test remains unverified.
