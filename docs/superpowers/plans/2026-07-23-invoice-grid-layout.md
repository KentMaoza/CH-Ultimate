# Invoice Grid Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each single-page invoice use the same columns and visual grid as Nota while enlarging customer, place, and date metadata.

**Architecture:** Keep all derivation local to `InvoiceTemplateBuilder`. Render existing `NotaLine` fields directly into a semantic table and use namespaced invoice CSS for print-like layout, without changing domain or gateway contracts.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Playwright, Electron Forge.

## Global Constraints

- Frontend-only and session-only.
- One selected Nota page per invoice.
- No domain, gateway, persistence, backend, networking, or production print changes.
- Work on `codex/invoice-grid-layout`, verify, commit, then merge locally to `main`.

---

### Task 1: Lock the Invoice Data Contract

**Files:**
- Modify: `tests/unit/label-nota-ui.test.tsx`
- Modify: `src/renderer/pages/InvoiceTemplateBuilder.tsx`

**Interfaces:**
- Consumes: existing `NotaLine` fields and `lineTotal(line)`.
- Produces: semantic invoice table with `data-testid="invoice-items-grid"` and metadata values with stable test IDs.

- [x] Add a failing test that expects the exact nine headers, fixed code `3A`,
  `JENIS`, distinct PCS/LSN prices, and transaction customer metadata.
- [x] Run `npm test -- tests/unit/label-nota-ui.test.tsx` and confirm the old
  six-column table fails.
- [x] Replace the old `NOTA` and combined price/unit cells with the nine
  approved columns.
- [x] Render the current unit as an active read-only unit cell and keep missing
  prices as `—`.
- [x] Add the three-column customer metadata block.
- [x] Run the focused test and `npm run typecheck`.

### Task 2: Add the Full Grid and Readable Metadata

**Files:**
- Modify: `src/renderer/styles.css`
- Modify: `tests/unit/label-nota-ui.test.tsx`

**Interfaces:**
- Consumes: invoice table and metadata classes from Task 1.
- Produces: full cell borders, black header, stable column widths, and large identity values.

- [x] Add assertions for metadata hooks and unit active state.
- [x] Add namespaced CSS so every invoice header/body cell has a black border.
- [x] Use a wide fixed table layout with larger item names and right-aligned
  numeric columns.
- [x] Increase customer/place/date values independently of the configurable
  base invoice font size.
- [x] Run the focused test and `git diff --check`.

### Task 3: Rendered QA and Integration

**Files:**
- Modify: `tests/e2e/app.spec.ts`

**Interfaces:**
- Consumes: final Invoice tab UI.
- Produces: Electron regression proof for A/B selection and the new grid.

- [x] Extend E2E assertions for exact headers, full customer metadata, kind,
  PCS/LSN state, and independent prices.
- [x] Run `npm run verify`.
- [x] Run `npm run package` and `npm run test:e2e`.
- [x] Inspect the rendered Invoice tab at desktop size for clipping, overlap,
  missing columns, and weak metadata hierarchy.
- [x] Commit the branch and merge it into local `main`.
- [x] Re-run verification on merged `main` and confirm a clean worktree.

### Task 4: Combine Invoice Unit Display

**Files:**
- Modify: `tests/unit/label-nota-ui.test.tsx`
- Modify: `tests/e2e/app.spec.ts`
- Modify: `src/renderer/pages/InvoiceTemplateBuilder.tsx`
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Consumes: the existing `NotaLine.unit` value.
- Produces: one read-only `PCS/LSN` invoice column while preserving the two
  independent price columns and the unchanged operator-facing Nota grid.

- [x] Change the invoice tests to expect one `PCS/LSN` header and one plain
  unit cell, then run the focused unit test and confirm it fails against the
  previous two-column renderer.
- [x] Replace the two invoice unit columns with one cell that renders the
  active unit in uppercase.
- [x] Remove invoice-only active-unit block styling and preserve total table
  width by assigning the combined column the previous two-column width.
- [x] Run full verification, packaging, E2E, and `git diff --check`.
- [x] Commit on `codex/invoice-combined-unit-column`, merge locally to `main`,
  and verify the merged worktree.
