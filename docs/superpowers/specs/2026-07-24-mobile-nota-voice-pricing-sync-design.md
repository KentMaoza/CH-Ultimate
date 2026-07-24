# CHU Mobile Nota Voice, Dual Pricing, and Desktop Retry Design

## Scope

This revision remains frontend-only. `MockOperationsGateway` continues to own all business data in memory, and no backend, database, NAS connection, or real desktop receiver is added.

## Barcode Voice Feedback

After a scanned barcode is accepted into the active note, the existing Nota voice player reads the row number, updated quantity, unit, and active unit price.

- A new SKU reads its assigned row, such as `1A`, quantity `1 PCS`, and its PCS price.
- Scanning the same SKU again increments the existing row and reads the same row again with the new quantity and the price stored on that row.
- Archived, unknown, empty, or cancelled scans do not trigger Nota voice.
- The existing short scan-success tone and haptic feedback remain separate decoded-barcode feedback.

## Manual PCS and LSN Prices

The manual-item form has independent `Harga PCS` and `Harga Lusin` inputs, matching the desktop Nota model.

- Both values are integer rupiah and may be zero, but cannot be negative or invalid.
- Saving stores both values without deriving one from the other.
- The selected unit determines the line total and which price is read by Nota voice.
- Switching a saved row between PCS and LSN preserves both stored prices.

## Completion and Desktop Transfer

The completion dialog exposes one primary action: `Simpan ke Arsip dan kirim ke desktop`.

1. The note is completed into the mobile Archive.
2. The gateway attempts the frontend-demo transfer.
3. The mock gateway records a failed transfer with the reason `CH Core API belum tersedia.`
4. The UI confirms that the note was saved, but clearly reports that desktop delivery failed.

The transaction stores optional session-only transfer metadata:

- transfer status;
- failure reason;
- most recent attempt time.

No screen may claim that a note was delivered successfully while the mock gateway is active.

## Archive Retry

An archived note with a failed desktop transfer displays:

- a `Gagal terkirim ke desktop · frontend demo` badge;
- the specific failure reason;
- a `Sinkronisasi ulang` button.

Retry calls the same gateway transfer operation, updates the attempt metadata, and displays the same honest failure reason while CH Core API is unavailable. Retry does not change stock, revenue, note completion, or archive placement.

## Gateway Boundary

Desktop transfer is added to `OperationsGateway` rather than implemented inside React state. The mock adapter records a deterministic session-only failure. A future real gateway may replace that behavior without rewriting the mobile editor or archive screen.

## Verification

- Barcode voice tests cover first scan, duplicate scan, row identity, updated quantity, active unit, and active price.
- Manual-entry tests cover independent PCS/LSN prices, validation, persistence, totals, and voice selection.
- Completion tests cover the single action, archive placement, failed transfer state, and exact reason.
- Archive tests cover failed badge, retry action, repeated failure, and unchanged note posting.
- Full TypeScript, unit, mobile, Android build, test, and lint checks run before installation.
