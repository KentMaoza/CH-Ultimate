# LSN Total and Transaction Invoice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calculate LSN totals from a PCS price when no explicit LSN price exists, and render all active Nota pages as one readable transaction invoice with informational 12% PPN.

**Architecture:** Keep the price fallback in the pure Nota domain so the grid, page totals, revenue, archives, and invoice all share one calculation. Keep invoice grouping and presentation inside `InvoiceTemplateBuilder`, deriving rows from the existing in-memory transaction without changing `OperationsGateway` or persisted types.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Playwright, Electron Forge.

## Global Constraints

- Frontend-only and session-only.
- Do not add persistence, backend services, IPC, networking, or production printing.
- Preserve explicit LSN price overrides and existing PCS behavior.
- PPN is informational and must not change Nota totals, revenue, or stock.
- Preserve all pre-existing dirty worktree changes; do not stage unrelated files.

---

### Task 1: Add the LSN PCS-Price Fallback

**Files:**
- Modify: `tests/unit/nota-domain.test.ts`
- Modify: `tests/unit/nota-workspace.test.tsx`
- Modify: `src/domain/nota.ts:19-22`

**Interfaces:**
- Consumes: `NotaLine`.
- Produces: `selectedPrice(line: NotaLine): number` with explicit-LSN-price precedence.
- Produces: `lineTotal(line: NotaLine): number` using the derived selected price.

- [x] **Step 1: Write the failing domain test**

Add:

```ts
test('derives an lsn total from twelve pieces when only a pcs price is entered', () => {
  const fallbackLine = {
    id: 'fallback', description: 'Barang', kind: '', quantity: 5,
    unit: 'lsn' as const, pcsPrice: 165_000, lsnPrice: 0,
  };
  const overrideLine = { ...fallbackLine, lsnPrice: 1_900_000 };

  expect(selectedPrice(fallbackLine)).toBe(1_980_000);
  expect(lineTotal(fallbackLine)).toBe(9_900_000);
  expect(selectedPrice(overrideLine)).toBe(1_900_000);
  expect(lineTotal(overrideLine)).toBe(9_500_000);
  expect(linePieces(fallbackLine)).toBe(60);
});
```

- [x] **Step 2: Write the failing grid regression test**

Add a focused UI test that opens Nota, clears row 3, enters quantity `5`,
selects LSN, enters only `165000` in Harga PCS, and asserts:

```ts
expect(screen.getByLabelText('Total baris 3')).toHaveTextContent('9.900.000');
```

- [x] **Step 3: Run the focused tests and verify RED**

Run:

```bash
npm test -- tests/unit/nota-domain.test.ts tests/unit/nota-workspace.test.tsx
```

Expected: the new fallback expectations fail because `selectedPrice` returns
zero for an LSN line with `lsnPrice: 0`.

- [x] **Step 4: Implement the minimal fallback**

Replace `selectedPrice` with:

```ts
export function selectedPrice(line: NotaLine): number {
  if (line.unit === 'pcs') return line.pcsPrice;
  return line.lsnPrice > 0 ? line.lsnPrice : line.pcsPrice * 12;
}
```

Do not mutate `lsnPrice`.

- [x] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/unit/nota-domain.test.ts tests/unit/nota-workspace.test.tsx
```

Expected: all domain and Nota workspace tests pass.

---

### Task 2: Render a Whole-Transaction Invoice

**Files:**
- Modify: `tests/unit/label-nota-ui.test.tsx`
- Modify: `src/renderer/pages/InvoiceTemplateBuilder.tsx`
- Modify: `src/renderer/styles.css:126-136`

**Interfaces:**
- Consumes: `state.notaTransactions[0]`, `lineTotal`, and `selectedPrice`.
- Produces: active page sections with fixed row codes, page subtotals,
  transaction total, and informational PPN.

- [x] **Step 1: Write the failing invoice test**

Seed page B with a populated first line and leave row 2 of page A empty so the
test proves fixed row numbering. Render Invoice and assert:

```ts
expect(preview).toHaveTextContent('Nota A');
expect(preview).toHaveTextContent('1A');
expect(preview).toHaveTextContent('Nota B');
expect(preview).toHaveTextContent('1B');
expect(within(preview).getByTestId('invoice-page-subtotal-A')).toHaveTextContent('Rp 47.000');
expect(within(preview).getByTestId('invoice-page-subtotal-B')).toHaveTextContent('Rp 9.900.000');
expect(within(preview).getByTestId('invoice-transaction-total')).toHaveTextContent('Rp 9.947.000');
expect(within(preview).getByTestId('invoice-ppn')).toHaveTextContent('Rp 1.193.640');
```

Also assert that the transaction total remains `Rp 9.947.000`, proving PPN is
not added.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- tests/unit/label-nota-ui.test.tsx
```

Expected: Nota B, fixed item codes, page subtotals, and PPN test IDs are absent.

- [x] **Step 3: Derive pages and prices in the builder**

Import `selectedPrice`. Replace the single-page `lines` derivation with:

```ts
const pages = transaction?.pages
  .filter((page) => page.status === 'active')
  .map((page) => ({
    ...page,
    rows: page.lines
      .map((line, rowIndex) => ({ line, rowIndex }))
      .filter(({ line }) => line.description.trim()),
  })) ?? [];
const transactionTotal = pages.reduce(
  (sum, page) => sum + page.rows.reduce((pageSum, { line }) => pageSum + lineTotal(line), 0),
  0,
);
const ppn = Math.round(transactionTotal * 0.12);
```

For the visible price:

```ts
function invoicePrice(line: NotaLine) {
  return line.unit === 'lsn' && line.lsnPrice <= 0
    ? { amount: line.pcsPrice, unit: 'pcs' as const }
    : { amount: selectedPrice(line), unit: line.unit };
}
```

- [x] **Step 4: Render transaction metadata and active page sections**

Render the transaction base number, customer, place, and date. For each active
page, render a section labelled `Nota ${page.suffix}` and a table with:

```text
NO | NOTA | NAMA BARANG | JUMLAH | HARGA | TOTAL
```

Use `${rowIndex + 1}${page.suffix}` for `NO`, `Nota ${page.suffix}` for
`NOTA`, and include all populated rows without slicing to four.

Add:

```tsx
<strong data-testid={`invoice-page-subtotal-${page.suffix}`}>
  {formatRupiah(pageSubtotal)}
</strong>
```

- [x] **Step 5: Render final total and informational PPN**

At the bottom render two distinct rows:

```tsx
<div data-testid="invoice-transaction-total">
  <span>Total transaksi</span>
  <strong>{formatRupiah(transactionTotal)}</strong>
</div>
<div data-testid="invoice-ppn">
  <span>PPN 12% (informasi)</span>
  <strong>{formatRupiah(ppn)}</strong>
</div>
```

Do not add `ppn` to `transactionTotal`.

- [x] **Step 6: Add readable monochrome styles**

Namespace new rules under `.invoice-paper`. Make page headings, item codes,
item names, prices, subtotals, and final totals bold. Keep black borders and
allow horizontal scrolling through the existing `.invoice-preview-wrap`.

- [x] **Step 7: Verify GREEN**

Run:

```bash
npm test -- tests/unit/label-nota-ui.test.tsx tests/unit/nota-domain.test.ts tests/unit/nota-workspace.test.tsx
npm run typecheck
```

Expected: all focused tests and TypeScript pass.

---

### Task 3: Desktop Regression and Scope Verification

**Files:**
- Modify: `tests/e2e/app.spec.ts`

**Interfaces:**
- Consumes: the packaged Invoice UI and Nota grid.
- Produces: end-to-end evidence for LSN fallback and multi-page invoice output.

- [x] **Step 1: Extend the Electron E2E flow**

In the existing Invoice test, assert that both `Nota A` and `Nota B`, row code
`1A`, transaction total, and informational PPN are visible. In a Nota flow,
enter `5` LSN and `165000` only in Harga PCS, then assert total `9.900.000`.

- [x] **Step 2: Run full unit and static verification**

Run:

```bash
npm run verify
git diff --check
```

Expected: typecheck and all Vitest tests pass; no whitespace errors.

- [x] **Step 3: Package and run Electron E2E**

Run:

```bash
npm run package
npm run test:e2e
```

Expected: packaging succeeds and all Electron E2E tests pass.

- [x] **Step 4: Audit frontend-only scope**

Run:

```bash
rg -n "localStorage|indexedDB|sqlite|createServer|ipcMain|ipcRenderer" \
  src/domain/nota.ts src/renderer/pages/InvoiceTemplateBuilder.tsx
```

Expected: no matches.

- [x] **Step 5: Review the final diff**

Confirm every changed production line traces to LSN fallback or Invoice output.
Do not stage or commit unrelated pre-existing worktree changes.
