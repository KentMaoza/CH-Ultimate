# Live Catalogue Reconciliation Design

## Context

The verified pre-deployment receipt for CH Core v0.2.4 proves that the NAS already contains live business history: 5 SKUs, 4 Nota records, 6 stock movements, and 8 non-import price-history records. The existing full-catalogue commit intentionally rejects this state because it overwrites stock balances and assumes that no business activity has started.

The owner approved the conservative interpretation: the existing records are business data and must be preserved. The new workbook `SKU_Gudang20260808075120732.xlsx` must still become the authoritative source for every row it contains.

## Chosen Approach

Implement an audited live-catalogue reconciliation in the existing staged, owner-only, transactional import flow.

- Preserve every existing SKU identity, Nota reference, stock movement, stock check, price-history record, and audit event.
- Match workbook rows to existing SKUs by normalized primary SKU or product-code identifier.
- Create workbook SKUs that do not match an existing identifier.
- Update matched SKU metadata, price, source provenance, and workbook identifiers without deleting additional stored identifiers.
- Keep existing active SKUs that are absent from the workbook active and untouched. Report their count in the import audit instead of archiving or deleting them.
- Fail the entire transaction when identifiers map one workbook row to two stored SKUs, two workbook rows to one stored SKU, or a new identifier conflicts with another SKU.

This approach is preferred over preserving old balances silently because the owner asked to import the workbook stock data. It is preferred over deleting and reseeding because the NAS receipt proves that deletion would break business history.

## Stock Semantics

For a newly created SKU, the workbook quantity is its initial stock balance with row version 1. This is a baseline, not a historical movement.

For a matched existing SKU:

1. Lock and read the current balance in the same import transaction.
2. Compute `delta = workbook quantity - current quantity`.
3. If the delta is zero, leave the balance row version unchanged and write no stock movement.
4. If the delta is non-zero, set the balance to the workbook quantity, increment its row version once, and insert one `stock_movements` row with reason `catalogue_reconciliation`.
5. Record the previous quantity, workbook quantity, delta, resulting balance version, import ID, workbook SHA, and owner device in the audit detail.
6. Add stock-balance and stock-movement change-log entries so connected clients receive the same authoritative result.

Workbook reconciliation is not presented as a physical barcode stock check and therefore does not set `last_checked_at` or create a `stock_checks` row.

## Price, Metadata, Images, and Identifiers

- The selected workbook price becomes the current SKU price.
- A new `price_history` row with source `catalogue_import` is appended; manual history remains unchanged.
- Existing image bytes remain until a new image job succeeds. Workbook image URLs create idempotent pending jobs through the existing import path.
- Existing identifiers are retained. Missing workbook primary/product identifiers are added to the matched SKU.
- `primary_identifier`, name, source note, source creation time, source image URL, import provenance, and SKU row version are updated for matched rows.

## Transaction and Replay Safety

The existing business-write lock, staged workbook record, owner authorization, and database transaction remain mandatory.

- The import hash stays unique and a committed result replays without additional writes.
- Every reconciliation write, audit record, movement, image job, and import status update commits together or rolls back together.
- The code no longer rejects all live history. It replaces that broad gate with conflict checks and non-destructive reconciliation rules.
- No `DELETE`, `TRUNCATE`, production-database drop, or automatic SKU archive is introduced.

## Result and Audit Evidence

The committed import result and `catalogue.import_committed` audit detail report:

- workbook row count and SHA;
- matched existing SKU count;
- created SKU count;
- untouched existing SKU count;
- stock-adjusted SKU count;
- zero-delta matched SKU count;
- image-job count.

The release receipt must additionally prove that the expected workbook SHA committed once and that the resulting active catalogue contains every workbook identifier.

## Error Handling

- Identity conflicts return a 409 and roll back all changes.
- Missing or invalid existing balance data fails closed before any commit.
- A database failure at any write rolls back metadata, stock, history, image jobs, audit records, change-log entries, and import status together.
- A replay of a committed workbook returns the stored result and makes no new movement or audit entry.

## Verification

Implementation is complete only when the following evidence is green:

1. Unit tests prove matched identity preservation, extra-identifier retention, unmatched-SKU retention, new-SKU creation, zero-delta behavior, audited non-zero stock reconciliation, conflict rollback, and committed replay.
2. MariaDB integration tests prove that existing Nota/history counts are unchanged while matched balances reconcile and new SKUs are inserted atomically.
3. The real workbook acceptance test proves 3,172 rows and the pinned SHA are accepted.
4. A fresh verified NAS backup and scratch restore still match before cutover.
5. The deployed API reaches schema version 10 and bootstrap schema 2.
6. The owner-only import receipt proves all workbook identifiers are present, old Nota/history remain, and the import is idempotent.
7. Windows and Android clients load the reconciled catalogue and can complete the planned Nota, stock, image, print/export, navigation, and synchronization acceptance checks.

## Out of Scope

- Deleting the existing 4 Nota records or their dependent history.
- Automatically archiving legacy SKUs absent from the workbook.
- Treating the workbook as a barcode stock-check session.
- Adding a general-purpose import-mode selector to the client UI.
