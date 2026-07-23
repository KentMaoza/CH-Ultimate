# CH Ultimate — Per-Page Invoice, Inclusive PPN, and LSN PCS Voice Design

## Goal

Print and preview each Nota page as a separate invoice, split the page's actual
total into an inclusive PPN presentation, and speak Harga PCS commits while an
LSN line is active.

## Scope

- Remain frontend-only and session-only.
- Do not add persistence, backend services, networking, or new IPC.
- Keep production PDF and print actions disabled.
- Preserve the existing Label barcode builder.
- Apply the Invoice change only to the invoice preview/output model.

## Per-Page Invoice

The Invoice builder shows one active Nota page at a time.

- Render a page selector for every active page: `Nota A`, `Nota B`, `Nota C`,
  and so on.
- Select the first active page by default.
- Preserve the selected suffix while the page remains active.
- If the selected page disappears, select the first remaining active page.
- Cancelled pages do not appear.
- Each preview contains only the selected page's populated rows.
- Fixed row codes remain tied to their original positions, such as `1A`,
  `3A`, or `2B`.
- Each future print job represents only the currently selected page.

The existing transaction metadata and configurable identity header remain
visible. The table retains `NO`, `NOTA`, `NAMA BARANG`, `JUMLAH`, `HARGA`, and
`TOTAL`.

## Inclusive PPN Presentation

The sum of the selected page's line totals is the actual `Total Transaksi`.
PPN is treated as included in that amount.

```text
PPN 12%        = round(Total Transaksi × 12 / 112)
Total Nota     = Total Transaksi − PPN
Total Transaksi = sum of selected page line totals
```

Display the values in this exact order:

1. `Total Nota`
2. `PPN 12%`
3. `Total Transaksi`

The subtraction occurs after PPN rounding so the three integer-rupiah values
always reconcile. Remove the sentence `PPN tidak ditambahkan ke total
transaksi.`

## Nota Voice

Price commits should follow what the operator actually edits.

- A valid Harga PCS commit triggers speech even when unit LSN is selected.
- A valid Harga LSN commit continues to trigger speech when unit LSN is
  selected.
- A valid Harga PCS commit continues to trigger speech for PCS.
- Quantity revisions continue to use the selected line price.
- The spoken request contains the row code, quantity/unit, and the committed
  price.
- Existing limits remain: quantity `1–48`, supported page suffix, and price
  `1–1.000.000`.
- Invalid, unchanged, or out-of-range values remain silent.

Example:

```text
Row: 1A
Unit: LSN
Quantity: 1
Committed field: Harga PCS
Price: Rp165.000
Speech request: 1A, satu lusin, harga seratus enam puluh lima ribu
```

## Git Workflow

- Finish this revision in the current `main` checkout.
- After full verification, commit the complete intended CH Ultimate working
  tree to `main`.
- Future revisions start on a `codex/<revision-name>` branch.
- Each future branch is verified, committed, then merged back into local
  `main`.
- Do not push or create a remote unless explicitly requested.

## Testing

### Invoice

- Nota A and Nota B are selectable but never appear in the same preview.
- Switching from A to B updates row codes and totals.
- Cancelled pages are excluded.
- Empty fixed rows remain omitted without renumbering later rows.
- Inclusive PPN uses `12/112`, rounds to integer rupiah, and reconciles with
  Total Nota plus PPN.
- The obsolete explanatory sentence is absent.

### Voice

- `1 LSN` plus a valid Harga PCS commit emits one request.
- The request uses unit `lsn` and the committed PCS price.
- Harga LSN still emits one request.
- Unchanged and invalid prices remain silent.
- Existing quantity revision behavior remains unchanged.

## Acceptance Criteria

- Each Nota A/B/C invoice is previewed separately.
- A page total of Rp112.000 displays Total Nota Rp100.000, PPN Rp12.000, and
  Total Transaksi Rp112.000.
- The removed PPN sentence is absent.
- Harga PCS on an LSN line triggers the expected voice request.
- Full unit/component verification, typecheck, packaging, Electron E2E,
  scope audit, and `git diff --check` pass before the `main` commit.
