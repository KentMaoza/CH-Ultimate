# CH Ultimate — LSN Total and Transaction Invoice Design

## Goal

Fix Nota totals when an operator selects LSN but enters only a PCS price, and
make the Invoice template preview represent every active Nota page in one
transaction.

## Scope

- Renderer/domain changes remain frontend-only and session-only.
- Do not add persistence, backend services, IPC, networking, or production
  printing.
- Keep Label responsible for SKU barcode configuration.
- Keep Invoice responsible for configuring the future printed Nota output.
- Preserve existing configurable invoice size, font, logo, bank account,
  address, phone number, and identity-element order.

## Nota LSN Calculation

`lineTotal` will use the following price precedence:

1. PCS lines use `pcsPrice`.
2. LSN lines use `lsnPrice` when it is greater than zero.
3. If an LSN line has no `lsnPrice`, it derives one dozen from
   `pcsPrice × 12`.

This keeps an explicit LSN override intact while supporting the operator flow
that enters a per-piece price only.

Example:

```text
Quantity: 5 LSN
PCS price: Rp165.000
LSN price: blank
Total: 5 × 12 × Rp165.000 = Rp9.900.000
Stock effect: 5 × 12 = 60 pcs
```

The derived fallback is only used for calculations and display. It does not
write a new LSN price into the line or alter the SKU master price.

## Invoice Data Source

The preview uses the first available Nota transaction in the session, matching
the existing demo behavior. It includes every page whose status is `active`,
in page order, and excludes cancelled pages.

Within each page, it includes populated lines in their original fixed row
positions. Empty rows are omitted without renumbering populated rows.

## Invoice Content

One invoice represents the whole transaction and contains:

- the existing configurable business identity header;
- transaction base number, customer, place, and date;
- one section for every active page, labelled `Nota A`, `Nota B`, and so on;
- each item row's fixed code such as `1A` or `2B`;
- item name;
- quantity and unit;
- active unit price;
- row total;
- a subtotal for each Nota page;
- the final transaction total;
- `PPN 12% (informasi)` calculated from the transaction total.

For an LSN line using the PCS fallback, the price column explicitly displays
the PCS price with `/ pcs`, while the row total uses twelve pieces per LSN.
When an explicit LSN price is present, it displays that price with `/ lsn`.

PPN is rounded to the nearest integer rupiah for display. It is informational
only and does not change page subtotals, transaction revenue, stock effects, or
the amount shown as `Total transaksi`.

## Presentation

- Use strong black borders, bold section labels, and bold totals.
- Keep the configured base font size, but make item codes, page names, item
  names, prices, and totals at least `font-weight: 700`.
- Use a full-width table that remains readable in the existing scrollable
  preview.
- Do not introduce color or change the monochrome CHU design.

## Error and Empty States

- If no transaction exists, keep a clearly labelled demo placeholder.
- If a transaction has no populated lines, show an empty-item message and zero
  totals.
- Invalid or negative prices remain governed by existing Nota validation.

## Testing

### Domain

- LSN with only `pcsPrice` calculates `quantity × 12 × pcsPrice`.
- Explicit `lsnPrice` continues to override the PCS fallback.
- PCS calculation remains unchanged.
- Stock pieces remain `quantity × 12` for LSN.

### Invoice UI

- Shows Nota A and Nota B in one invoice.
- Preserves fixed item codes such as `1A`, `3A`, and `1B`.
- Shows item name, quantity/unit, active price, and row total.
- Shows a subtotal for each Nota page.
- Shows transaction total and informational 12% PPN.
- Confirms PPN does not change the displayed transaction total.
- Excludes cancelled pages and empty lines.
- Existing business identity configuration and element reordering continue to
  work.

## Acceptance Criteria

- `5 LSN` at `Rp165.000 / pcs` displays `Rp9.900.000`.
- A single invoice preview can show all active Nota A/B/C sections.
- Every printed row has its fixed row code and Nota code.
- Page subtotals and transaction total reconcile with the visible line totals.
- PPN 12% is visible but excluded from the payable total.
- Focused tests, the full verification suite, Electron packaging, E2E, and
  `git diff --check` pass.
