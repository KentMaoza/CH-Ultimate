# Revenue Lock, Nota Voice, and Inventory Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Speak unnamed Nota rows without the word “rupiah”, protect Laporan Omzet with a session password configured in Settings, and support clickable local SKU image replacement with enlarged preview.

**Architecture:** Keep the Nota change inside its renderer-only resolver and commit validation. Add one focused renderer context for revenue access state, consumed by Settings and Revenue without changing `OperationsGateway` or `DemoState`. Reuse `updateSku` for an in-memory data URL and keep image-picker state local to `InventoryPage`.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Playwright, Electron Forge.

## Global Constraints

- Frontend-only and session-only.
- Do not add persistence, backend, database, networking, encryption claims, or production authentication.
- Preserve existing uncommitted work and do not edit CH Nota.
- Develop test-first and keep dense files surgical.

---

### Task 1: Revise Nota Voice Eligibility and Phrase

**Files:**
- Modify: `tests/unit/nota-voice.test.ts`
- Modify: `tests/unit/nota-voice-ui.test.tsx`
- Modify: `src/renderer/nota/nota-voice.ts`
- Modify: `src/renderer/nota/NotaGrid.tsx`

**Interfaces:**
- Consumes: `NotaVoiceRequest`.
- Produces: a clip sequence without `prices/rupiah.ogg`.

- [x] **Step 1: Write failing tests**

Add resolver assertions that no resolved path ends in `rupiah.ogg`, and add a
grid test that commits valid quantity and price on a row with blank description.

- [x] **Step 2: Run the tests and confirm the requirement failures**

Run:

```bash
npm test -- tests/unit/nota-voice.test.ts tests/unit/nota-voice-ui.test.tsx
```

Expected: resolver still includes `rupiah.ogg` and the unnamed row stays silent.

- [x] **Step 3: Implement the minimal voice changes**

Remove the final rupiah path from `resolveNotaVoice`. Remove only the
`line.description.trim()` eligibility check from `NotaGrid.numericBlur`.

- [x] **Step 4: Verify the slice**

Run:

```bash
npm test -- tests/unit/nota-voice.test.ts tests/unit/nota-voice-ui.test.tsx
```

Expected: all Nota voice tests pass.

### Task 2: Add Session Password Guard to Laporan Omzet

**Files:**
- Create: `src/renderer/revenue-access.tsx`
- Create: `tests/unit/revenue-access-ui.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/pages/RevenuePage.tsx`
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Produces: `RevenueAccessProvider`.
- Produces: `useRevenueAccess()` with `configured`, `unlocked`,
  `configurePassword(current, next): boolean`, `unlock(candidate): boolean`.
- Consumes: `RevenuePage.onOpenSettings`.

- [x] **Step 1: Write failing UI tests**

Cover no-password setup state, hidden metrics, initial password creation,
confirmation mismatch, wrong unlock, successful session unlock, navigation
persistence, rejected password change without the current password, accepted
change, and immediate relock.

- [x] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
npm test -- tests/unit/revenue-access-ui.test.tsx
```

Expected: the revenue access fields and provider do not exist.

- [x] **Step 3: Add the renderer-only access context**

Hold password and unlock state in React state. Reject blank passwords,
mismatched current passwords, and incorrect unlock attempts. Setting a password
must set `unlocked` to false.

- [x] **Step 4: Gate Revenue and add Settings controls**

Wrap `AppLayout` in `RevenueAccessProvider`. Render setup/locked forms instead
of reports until access is unlocked. Add a Settings card for create/change
password and label it `SESSION ONLY`.

- [x] **Step 5: Verify the slice**

Run:

```bash
npm test -- tests/unit/revenue-access-ui.test.tsx tests/unit/reports-ui.test.tsx tests/unit/app-shell.test.tsx
```

Expected: all access, reports, and shell tests pass.

### Task 3: Add Click-to-Replace SKU Images and Enlarged Preview

**Files:**
- Modify: `tests/unit/inventory-ui.test.tsx`
- Modify: `src/renderer/pages/InventoryPage.tsx`
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Consumes: `OperationsGateway.updateSku(id, { imageUrl })`.
- Produces: one hidden image file input and accessible thumbnail buttons.

- [x] **Step 1: Write failing inventory tests**

Assert that clicking `Ubah gambar <SKU>` opens the input, uploading an image
updates only that SKU to a data URL, the input resets, and the thumbnail exposes
large preview markup for hover/focus.

- [x] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
npm test -- tests/unit/inventory-ui.test.tsx
```

Expected: the accessible image button and file input are missing.

- [x] **Step 3: Implement the picker and preview**

Add one page-level target SKU, hidden `accept="image/*"` input, FileReader data
URL conversion, `updateSku`, and a thumbnail button containing an
`aria-hidden` fixed large preview.

- [x] **Step 4: Add namespaced image styles**

Keep the 38px table thumbnail. Show a 220px fixed preview on button hover or
focus-visible, with a white background, black border, and no pointer events.

- [x] **Step 5: Verify the slice**

Run:

```bash
npm test -- tests/unit/inventory-ui.test.tsx
```

Expected: all inventory tests pass.

### Task 4: Full Verification

**Files:**
- Modify only if a regression exposes a requirement gap.

- [x] **Step 1: Run static and unit verification**

Run:

```bash
npm run verify
```

Expected: TypeScript and all Vitest tests pass.

- [x] **Step 2: Rebuild and run Electron E2E**

Run:

```bash
npm run package
npm run test:e2e
```

Expected: package succeeds and all Playwright Electron tests pass.

- [x] **Step 3: Audit scope and formatting**

Run:

```bash
git diff --check
rg -n "localStorage|indexedDB|sqlite|createServer|ipcMain|ipcRenderer" src/renderer/revenue-access.tsx src/renderer/pages/RevenuePage.tsx src/renderer/pages/SettingsPage.tsx src/renderer/pages/InventoryPage.tsx
```

Expected: no whitespace errors and no persistence/backend/IPC additions.
