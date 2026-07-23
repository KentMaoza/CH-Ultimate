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

- [ ] Add a failing test that expects the exact nine headers, fixed code `3A`,
  `JENIS`, distinct PCS/LSN prices, and transaction customer metadata.
- [ ] Run `npm test -- tests/unit/label-nota-ui.test.tsx` and confirm the old
  six-column table fails.
- [ ] Replace the old `NOTA` and combined price/unit cells with the nine
  approved columns.
- [ ] Render the current unit as an active read-only unit cell and keep missing
  prices as `—`.
- [ ] Add the three-column customer metadata block.
- [ ] Run the focused test and `npm run typecheck`.

### Task 2: Add the Full Grid and Readable Metadata

**Files:**
- Modify: `src/renderer/styles.css`
- Modify: `tests/unit/label-nota-ui.test.tsx`

**Interfaces:**
- Consumes: invoice table and metadata classes from Task 1.
- Produces: full cell borders, black header, stable column widths, and large identity values.

- [ ] Add assertions for metadata hooks and unit active state.
- [ ] Add namespaced CSS so every invoice header/body cell has a black border.
- [ ] Use a wide fixed table layout with larger item names and right-aligned
  numeric columns.
- [ ] Increase customer/place/date values independently of the configurable
  base invoice font size.
- [ ] Run the focused test and `git diff --check`.

### Task 3: Rendered QA and Integration

**Files:**
- Modify: `tests/e2e/app.spec.ts`

**Interfaces:**
- Consumes: final Invoice tab UI.
- Produces: Electron regression proof for A/B selection and the new grid.

- [ ] Extend E2E assertions for exact headers, full customer metadata, kind,
  PCS/LSN state, and independent prices.
- [ ] Run `npm run verify`.
- [ ] Run `npm run package` and `npm run test:e2e`.
- [ ] Inspect the rendered Invoice tab at desktop size for clipping, overlap,
  missing columns, and weak metadata hierarchy.
- [ ] Commit the branch and merge it into local `main`.
- [ ] Re-run verification on merged `main` and confirm a clean worktree.
