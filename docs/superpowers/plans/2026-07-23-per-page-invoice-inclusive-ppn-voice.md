# Per-Page Invoice, Inclusive PPN, and LSN PCS Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preview one Nota page per invoice, display inclusive PPN totals, and speak PCS price commits on LSN lines.

**Architecture:** Keep invoice page selection local to `InvoiceTemplateBuilder` and derive totals from the selected page only. Adjust the existing NotaGrid commit gate so valid price edits are spoken based on the field the operator committed, without changing gateway/domain state.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Playwright, Electron Forge.

## Global Constraints

- Frontend-only and session-only.
- No persistence, backend, networking, new IPC, or production print path.
- Test first and preserve existing active work.
- Commit the fully verified intended working tree to local `main`.

---

### Task 1: Per-Page Invoice and Inclusive PPN

**Files:**
- Modify: `tests/unit/label-nota-ui.test.tsx`
- Modify: `src/renderer/pages/InvoiceTemplateBuilder.tsx`
- Modify: `src/renderer/styles.css`

- [x] Write failing tests for A/B selection, one-page-only rows, `12/112` PPN,
  exact total order, and removed explanatory copy.
- [x] Run the focused Invoice test and confirm it fails for the current
  all-pages preview.
- [x] Add selected-page state with active-page fallback.
- [x] Calculate `transactionTotal`, rounded inclusive PPN, and net Total Nota
  from the selected page only.
- [x] Render the page selector and exact three-row total stack.
- [x] Update monochrome styles for selector and emphasized final total.
- [x] Run the focused Invoice tests and typecheck.

### Task 2: Speak Harga PCS on LSN Lines

**Files:**
- Modify: `tests/unit/nota-voice-ui.test.tsx`
- Modify: `src/renderer/nota/NotaGrid.tsx`

- [x] Write a failing test for quantity `1`, unit LSN, and Harga PCS commit
  producing one voice request with price `165000`.
- [x] Run the focused voice test and confirm the current active-price gate
  suppresses the request.
- [x] Accept a changed valid PCS or LSN price field and pass the committed
  price to the voice request.
- [x] Preserve quantity-commit selection and all existing range checks.
- [x] Run Nota voice and workspace tests plus typecheck.

### Task 3: E2E, Verification, and Main Commit

**Files:**
- Modify: `tests/e2e/app.spec.ts`

- [x] Update Electron E2E to switch Invoice A/B, verify separate content and
  inclusive totals, and verify the LSN PCS total remains correct.
- [x] Run `npm run verify` and `git diff --check`.
- [x] Run `npm run package` and `npm run test:e2e`.
- [x] Audit target files for persistence/backend/IPC additions.
- [x] Review Git status and exclude generated or unrelated files.
- [x] Commit the intended CH Ultimate working tree to local `main`.
