# CH Ultimate Restock Recommendations Design

## Outcome

Add a `Rekomendasi Restock` subsection to the desktop `Barang Kosong` workspace. It derives explainable restock candidates from authoritative CH Core stock and Nota history, lets the operator place chosen candidates into the existing empty-stock report workflow, and saves a dedicated portrait A4 PDF containing only product image, SKU name, and restock quantity.

The feature must never mutate warehouse stock. The action requested as “mengurangi barang” is implemented as `Keluarkan dari laporan`: it removes an SKU from the current report selection and leaves its real stock unchanged.

## Constraints and Assumptions

- CH Core bootstrap data remains authoritative. No new endpoint, database table, migration, or persisted score is introduced.
- Calculation, search/filter state, report selection, and manual quantity overrides live in the renderer session.
- Completed/cancelled/recompleted Nota lifecycle postings determine sales. A cancelled or reversed sale must not remain counted.
- All calendar boundaries use WITA (`Asia/Makassar`) and include the current WITA date.
- Only active, tracked, non-archived SKU can be recommended.
- Existing user report selections and warehouse balances are not changed automatically.
- UI copy is Indonesian and ranking output is deterministic for the same bootstrap and WITA date.

## Approaches Considered

### 1. Derive recommendations from the current bootstrap — selected

Build a pure domain report from `DemoState.skus`, `adjustments`, `stockChecks`, `notaPostings`, and `revenuePostings`, with the completed Nota fallback used only when posting collections are unavailable. This is the smallest architecture change, preserves the `OperationsGateway` boundary, and gives Windows the same answer for the same synchronized Core snapshot.

### 2. Add a CH Core recommendation endpoint

This would centralize calculation but requires a new API contract, server deployment, NAS migration/version gate, and mobile compatibility work for logic that is already fully represented in bootstrap history. It is rejected for this revision.

### 3. Persist a recommendation score on every SKU

This would make reads cheap but creates stale derived state and needs invalidation after every Nota and stock change. It is rejected because the current catalogue size is small enough for a memoized pure calculation.

## Authoritative Sales Timeline

Create a reusable domain helper that emits signed sold pieces per SKU for each lifecycle posting:

- `complete` and `restore`: add the posted snapshot pieces.
- `recomplete`: add the new snapshot and subtract the previous effective posted snapshot.
- posting kinds containing `reversal`: subtract the reversed snapshot.
- ignore future events relative to the requested WITA date.

When both posting collections exist, they are authoritative even when empty. The completed-transaction fallback is used only when the collections are absent, matching the current revenue-report compatibility behavior.

The helper exposes per-SKU lifetime net sold pieces, net sold pieces in a WITA date window, and the latest effective sale date. Negative window corrections are retained while eligibility requires a positive net result.

## Eligibility Proof

An SKU has `pernah distok` only when at least one of these is true:

- its current balance is positive;
- a stock adjustment has `before > 0` or `after > 0`; or
- a stock-check record has a positive observed, counted, or server-before balance.

An SKU has `pernah terjual` only when its lifecycle-aware lifetime net sold pieces are positive. A sale that was fully cancelled or reversed does not satisfy the proof.

The eligible base is active, tracked, non-archived SKU with both proofs.

## WITA Windows and Candidate Union

For report date `D`:

- the 30-day window is WITA dates `D-29` through `D`, inclusive;
- the 60-day window is WITA dates `D-59` through `D`, inclusive.

The candidate set is the deduplicated union of:

1. eligible SKU with `stock <= 0` and positive net sold pieces in the 60-day window; and
2. top sellers among eligible SKU with positive net sold pieces in the 30-day window.

“Top sellers” means the first third of the positive-30-day population after sorting by 30-day sold pieces descending, latest effective sale descending, 60-day sold pieces descending, and SKU number ascending. The count is `ceil(population / 3)`. All SKU tied on the three business metrics at the cutoff are included, so an arbitrary SKU-number tie-break cannot exclude an equal performer.

This rule is relative to real catalogue activity, requires no hidden rupiah or unit threshold, and is stable for the same data/date.

## Ranking Colors

Candidates with no positive 30-day sales are always red because their qualifying sale occurred only in the older part of the 60-day window.

The remaining candidates are ordered by the same business tuple: 30-day sold pieces descending, latest effective sale descending, then 60-day sold pieces descending. Their metric groups are divided into thirds:

- green: first third — strongest recent velocity and recency;
- yellow: middle third — ordinary recent movement;
- red: final third — slowest recent movement.

Equal business metrics receive the same, better band when a boundary is crossed. SKU number is used only for stable display order and never changes the color of an equal performer. Supplier filtering does not recalculate colors, so an SKU keeps the same meaning in every view and PDF.

## Recommended Quantity

The target is one month of observed demand:

- when 30-day net sold pieces are positive, demand is that 30-day total;
- otherwise demand is `ceil(60-day net sold pieces / 2)`.

Recommended restock is `max(0, demand - max(current stock, 0))`. A qualifying zero/negative-stock SKU is clamped to at least one piece. A top seller whose current stock already covers the observed monthly demand remains visible with `0` and the explanation `Stok saat ini mencukupi`; it is not auto-selected for the report.

The operator may override a selected quantity from `0` through `9,999`. An override affects only the current report. Quantity `0` cannot be saved into the dedicated recommendation PDF.

## Supplier Grouping and Filtering

Use the existing exact trailing supplier-code rule (`CH` plus digits, preserving zero padding). Recommendations are grouped by supplier code; `Tanpa kode supplier` is a separate final group. Search and supplier filters apply to both recommendation cards and “add all filtered recommendations.”

The chosen report preview is also grouped by supplier. Changing a filter hides nonmatching rows from the visible report/PDF scope but does not silently clear their session selection; the UI states how many selected rows are outside the current filter.

## Desktop Interaction

The `Barang Kosong` page gains a `Rekomendasi Restock` card above the existing stock list. Each recommendation shows:

- product image or CHU placeholder;
- SKU name and number;
- supplier group;
- green/yellow/red rank label;
- current stock, 30-day sales, 60-day sales, and reason;
- suggested quantity;
- `Masukkan ke laporan` action.

The report preview keeps quantity editing and adds a clearly named `Keluarkan dari laporan` action. No control on this page calls `adjustStock` or another mutating gateway operation.

## Dedicated A4 PDF

Add a distinct `restock-recommendation` output document plan rather than overloading the landscape operational-data table. It uses portrait A4 (`210 × 297 mm`) and supplier sections. Every product card contains exactly:

- product image;
- SKU name;
- restock quantity.

The section header may contain the supplier code and the card may use a green/yellow/red border or marker. SKU number, current stock, sales metrics, prices, and other product metadata are intentionally absent. Repeated page headers, supplier continuity, image fallback, page containment, and nonzero selected quantities are deterministic.

The existing `Laporan Barang Kosong` PDF remains available and unchanged. A separate `Simpan PDF Rekomendasi` action creates the restricted PDF.

## Failure and Sync Behavior

Recommendations render only from a valid loaded bootstrap. Existing truthful sync states continue to govern the workspace. During offline cached operation, the subsection is read-only-derived from the last-known-good snapshot and clearly inherits the offline status; it must not show a normal zero state caused by bootstrap failure.

Saving a PDF reports saved, cancelled, or failed status using the existing desktop output bridge. A failed image hydration uses the CHU placeholder and does not drop the SKU.

## Verification and Release Gate

### Domain tests

- exact WITA 30-day and 60-day inclusive boundaries;
- complete, recomplete, cancel/reversal, and restore lifecycle deltas;
- `pernah distok` proof from balance, adjustments, and stock checks;
- `pernah terjual` proof excludes fully reversed sales;
- candidate union, cutoff ties, deduplication, and archived/untracked exclusion;
- stable green/yellow/red ranking and supplier-filter independence;
- suggested quantity and zero-stock minimum.

### UI and document tests

- supplier grouping, search/filter, add-one, add-all-filtered, manual quantity edit, and `Keluarkan dari laporan` without stock mutation;
- restricted portrait A4 plan contains only image/name/quantity product data;
- image hydration fallback, page containment, multi-page supplier grouping, and output status copy;
- existing Barang Kosong, Stok Menipis, operational export, PDF, and print tests remain green.

### Installed Windows acceptance

Use the installed candidate with a valid synchronized Core snapshot and data labelled `ACCEPTANCE TEST ONLY`. Use Windows mouse/keyboard or native UI automation for interaction; CDP/JavaScript may only read/assert.

Verify filters, recommendation reasons/colors, quantity corrections, add/remove report actions, no warehouse-stock mutation, a real portrait A4 PDF file with visual inspection, app restart, truthful offline/reconnect state, and regression smoke for Barang Kosong, Stok Menipis, export, print/PDF, and Nota. Any functional, data, sync, native-input, or layout failure blocks release and requires regression-first repair, rebuild, reinstall, and retest.
