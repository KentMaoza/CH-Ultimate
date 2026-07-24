# Nota Desktop and CHU Mobile Frontend Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add destination-aware desktop nota completion plus touch-first mobile Nota and archive screens without adding persistence or synchronization.

**Architecture:** Preserve `status: completed` as the posting lifecycle and add a separate completion destination. Reuse the shared nota domain and `OperationsGateway`; desktop and mobile render separate interfaces over their own in-memory gateway sessions.

**Tech Stack:** React 19, TypeScript 5.9, Vitest, Testing Library, Electron 41, Vite, Capacitor 8.

## Global Constraints

- Frontend-only and session-only through `MockOperationsGateway`.
- No backend, NAS, database, persistence, durable queue, or real sync.
- Indonesian copy, integer rupiah, WITA, and existing desktop page colors.
- Test-first; focused verification after every slice and full verification before feature commits.
- `/Users/hamlet/Documents/CH Nota` remains read-only.

---

### Task 1: Completion Destination and Selectors

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/nota.ts`
- Modify: `src/gateway/operations-gateway.ts`
- Modify: `src/renderer/nota/nota-workspace-utils.ts`
- Test: `tests/unit/nota-transactions.test.ts`
- Test: `tests/unit/nota-workspace-utils.test.ts`

**Interfaces:**
- Produces: `NotaCompletionDestination = 'archive' | 'finished'`
- Produces: `completeNotaTransaction(state, id, destination)`
- Produces: `OperationsGateway.completeNotaTransaction(id, destination)`
- Produces: `finishedPage(transactions, filters, page?, size?)`

- [ ] Write tests proving archive/finished destinations, legacy archive
  fallback, and unchanged stock/revenue posting.
- [ ] Run:

  ```bash
  npx vitest run tests/unit/nota-transactions.test.ts tests/unit/nota-workspace-utils.test.ts
  ```

  Expected: fail because the destination type, argument, and selector do not
  exist.

- [ ] Add:

  ```ts
  export type NotaCompletionDestination = 'archive' | 'finished';

  export interface NotaTransaction {
    completionDestination?: NotaCompletionDestination;
  }
  ```

  Set `completionDestination: destination` only after line validation and
  posting succeed. Treat missing destination as archive in selectors.

- [ ] Run the focused tests again; expected: pass.

### Task 2: Desktop Completion Result Dialog

**Files:**
- Create: `src/renderer/nota/CompleteNotaDialog.tsx`
- Modify: `src/renderer/nota/NotaWorkspace.tsx`
- Modify: `src/renderer/App.tsx`
- Test: `tests/unit/nota-workspace.test.tsx`
- Test: `tests/unit/nota-workspace-lifecycle.test.tsx`

**Interfaces:**
- Consumes: `gateway.completeNotaTransaction(id, destination)`
- Produces: `onOpenCompletionDestination(destination)` callback from Nota to the shell

- [ ] Write component tests that select both numbered choices, assert the
  destination-specific result, follow the result action, and retain the
  dialog with an exact gateway/domain error.
- [ ] Run the two focused test files; expected: fail because the choices and
  result state are absent.
- [ ] Implement a focused dialog state:

  ```ts
  type CompletionDialogState =
    | { phase: 'choice'; transactionId: string }
    | { phase: 'saving'; transactionId: string; destination: NotaCompletionDestination }
    | { phase: 'success'; destination: NotaCompletionDestination }
    | { phase: 'error'; transactionId: string; destination: NotaCompletionDestination; reason: string };
  ```

  Verify the gateway snapshot is completed with the requested destination
  before reporting success.

- [ ] Run focused tests; expected: pass.

### Task 3: Arsip, Selesai, and Sampah

**Files:**
- Modify: `src/renderer/pages/ArchiveNotaPage.tsx`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/App.tsx`
- Test: `tests/unit/app-shell.test.tsx`
- Test: `tests/unit/nota-workspace-lifecycle.test.tsx`

**Interfaces:**
- Extends: `ArchiveNotaViewState.tab` to `'archive' | 'finished' | 'trash'`
- Consumes: `archivePage`, `finishedPage`, and `trashPage`

- [ ] Write tests for tab order, bucket filtering, Selesai preview/reopen,
  destination-preserving Trash restore, and preserved filters.
- [ ] Run focused tests; expected: fail because Selesai is absent.
- [ ] Render Arsip and Selesai through the same list/preview path, with
  destination-specific empty states and headings. Keep Sampah restoration
  behavior and select the restored transaction’s original destination.
- [ ] Change the tab list to three equal columns and run focused tests;
  expected: pass.

### Task 4: Mobile Nota Editor and Barcode Flow

**Files:**
- Create: `mobile/components/MobileNotaView.tsx`
- Create: `mobile/components/mobile-nota.css`
- Modify: `mobile/MobileApp.tsx`
- Modify: `mobile/components/Icons.tsx`
- Test: `tests/unit/mobile-nota.test.tsx`
- Test: `tests/unit/mobile-app.test.tsx`

**Interfaces:**
- Consumes: `OperationsGateway`, `BarcodeScannerPort`, `notaPageTheme`
- Produces: mobile Nota view with metadata, page tabs, cards, free-text entry, scan, and completion

- [ ] Write tests proving:
  - free-text item creation;
  - SKU/alias scan;
  - archived/unknown errors;
  - duplicate scan increments the existing line;
  - the 16th unique item creates B and receives `1B`;
  - A/B/C use desktop colors;
  - successful completion enters archive and reports no desktop transfer.
- [ ] Run:

  ```bash
  npx vitest run tests/unit/mobile-nota.test.tsx tests/unit/mobile-app.test.tsx
  ```

  Expected: fail because the mobile Nota route and component are absent.

- [ ] Implement transaction-wide duplicate lookup:

  ```ts
  const existing = transaction.pages
    .flatMap((page) => page.lines.map((line) => ({ page, line })))
    .find(({ line }) => line.skuId === sku.id);
  ```

  Increment the existing quantity by one. For a new SKU, use the first empty
  line; create the next page when all 15 rows are populated.

- [ ] Keep free-text rows unlinked from SKU and edit only description, kind,
  quantity, unit, and the selected unit price.
- [ ] Run focused tests; expected: pass.

### Task 5: Mobile Archive and Navigation

**Files:**
- Create: `mobile/components/MobileNotaArchiveView.tsx`
- Create: `mobile/components/MobileMoreView.tsx`
- Modify: `mobile/MobileApp.tsx`
- Modify: `mobile/components/mobile-nota.css`
- Test: `tests/unit/mobile-nota.test.tsx`
- Test: `tests/unit/mobile-app.test.tsx`

**Interfaces:**
- Produces: bottom destinations `home | skus | nota | archive | more`
- Consumes: archive-destination completed transactions only

- [ ] Write tests that exclude finished/cancelled transactions, render the
  frontend-demo transfer badge, open read-only detail, and preserve access to
  recommendation and price screens through Lainnya.
- [ ] Run focused tests; expected: fail because archive/more routes are absent.
- [ ] Implement the five-item navigation, archive list/detail, and More view.
  Do not add transfer ports, storage adapters, or synchronization state.
- [ ] Run focused tests; expected: pass.

### Task 6: Regression and Delivery

- [ ] Run:

  ```bash
  npm run verify
  npm run test:e2e
  npm run test:mobile
  npm run mobile:build
  npm run android:test
  npm run android:lint
  git diff --check
  ```

  Expected: every command exits zero.

- [ ] Inspect mobile layouts at 360×800 and 390×844, then at 200% text. Confirm
  no horizontal overflow and all primary targets remain at least 44 px.
- [ ] Confirm `rg -n "NAS|database|desktop sync|terkirim ke desktop" src mobile`
  exposes no success claim or backend implementation.
- [ ] Commit only the approved frontend, tests, and documentation.
