# CH Ultimate — Invoice Grid Layout Design

## Goal

Make the single-Nota invoice preview mirror the Nota operator grid and make
customer identity readable for both the store and the customer.

## Scope

- Keep the application frontend-only and session-only.
- Keep one selected Nota page per invoice.
- Keep production Print and PDF actions disabled.
- Do not change Nota totals, stock, revenue, gateway, or persistence behavior.

## Invoice Identity

The store identity remains at the top in the configurable element order. Below
it, the invoice shows the full Nota number plus a bordered customer block with
three columns:

- `Pelanggan`
- `Tempat`
- `Tanggal`

Labels remain compact. Values are large, bold, and high-contrast. Missing
values retain the existing fallbacks.

## Nota-Matched Grid

The selected page renders these columns in this exact order:

1. `NO`
2. `NAMA BARANG`
3. `JENIS`
4. `JUMLAH`
5. `PCS/LSN`
6. `HARGA PCS`
7. `HARGA LSN`
8. `TOTAL`

Only populated fixed rows are printed, and their original row codes remain
unchanged. The combined unit cell displays only the active unit (`PCS` or
`LSN`) as plain text, with no selected-state block. PCS and LSN prices are
shown independently, matching the Nota data. Zero prices display as a dash.
Totals remain integer rupiah. The operator-facing Nota grid retains separate
PCS and LSN controls.

The table uses a collapsed full grid: every header and body cell has visible
vertical and horizontal black borders. Headers use the existing black bar with
white uppercase text.

## Responsive Preview

The invoice keeps its configured physical width. The surrounding preview panel
may scroll horizontally when the configured paper or eight-column grid is wider
than the available desktop viewport. Columns must not disappear or overlap.

## Verification

- Unit tests assert exact header order, fixed row code, kind, independent
  prices, plain combined unit text, and customer metadata.
- E2E verifies the rendered Invoice tab after editing Nota A/B.
- Visual QA checks the invoice at a desktop viewport against the supplied
  references.
- Full typecheck, tests, Electron packaging, and `git diff --check` pass.
