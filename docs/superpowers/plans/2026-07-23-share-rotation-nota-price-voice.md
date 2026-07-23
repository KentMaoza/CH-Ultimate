# Share Rotation and Nota Price Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mix price updates, restocks, idle stock, and supplier codes in daily share recommendations, then read the active Nota price with the offline Piper voice after valid line commits.

**Architecture:** Keep recommendation selection as pure domain logic over `DemoState`. Extend the renderer-only Nota voice request with one active unit price, resolve that price into bundled compositional clips, and keep the gateway and Nota domain unchanged.

**Tech Stack:** TypeScript, React, Vitest, Playwright, Electron Forge, offline Piper-generated Ogg/Opus assets.

## Global Constraints

- Frontend-only and session-only; no persistence, backend, networking, or runtime TTS.
- Daily recommendation limit remains 300 unique SKU.
- Urgent remains strictly more than eight calendar months idle.
- Quantity range remains 1–48 and price range is 1–1,000,000 inclusive.
- Price means the active PCS or LSN unit price, never the line total.
- Preserve unrelated worktree changes.

---

### Task 1: Mixed Share Rotation

**Files:**
- Modify: `src/domain/share-recommendations.ts`
- Modify: `src/renderer/pages/ShareRecommendationsPage.tsx`
- Test: `tests/unit/share-recommendations.test.ts`
- Test: `tests/unit/share-recommendations-ui.test.tsx`

**Interfaces:**
- Consumes: `DemoState.priceChanges`, positive manual `DemoState.adjustments`, completed Nota transactions, and active SKU.
- Produces: `ShareRecommendationItem.reasons: Array<'price-updated' | 'restocked' | 'idle'>` and a deterministic `daily` list.

- [x] **Step 1: Write failing domain tests**

Add cases proving a recently repriced SKU and a positively restocked SKU are interleaved with idle SKU, supplier codes alternate, duplicate SKU appear once, consecutive WITA dates rotate the supplier start, and the result never exceeds 300.

- [x] **Step 2: Verify the tests fail**

Run: `npm test -- tests/unit/share-recommendations.test.ts`

Expected: FAIL because `reasons` and mixed supplier rotation do not exist.

- [x] **Step 3: Implement the minimal pure selector**

Build latest-event maps on or before the report date, create price/restock/idle queues, apply deterministic supplier round-robin, interleave the queues while deduplicating IDs, and fill remaining capacity from eligible SKU.

- [x] **Step 4: Add reason badges and revise copy**

Render `Harga diperbarui`, `Restock`, and `Stok lama` from `item.reasons`; replace copy that says recommendations always start with the oldest stock.

- [x] **Step 5: Verify the slice**

Run: `npm test -- tests/unit/share-recommendations.test.ts tests/unit/share-recommendations-ui.test.tsx`

Expected: PASS.

### Task 2: Price-Aware Nota Voice Contract

**Files:**
- Modify: `src/renderer/nota/nota-voice.ts`
- Modify: `src/renderer/nota/NotaGrid.tsx`
- Modify: `src/renderer/nota/NotaWorkspace.tsx`
- Test: `tests/unit/nota-voice.test.ts`
- Test: `tests/unit/nota-voice-ui.test.tsx`

**Interfaces:**
- Produces: `NotaVoiceRequest` with `price: number`.
- Produces: `resolveNotaVoice(request): string[] | null`.
- Produces: `NotaGrid.onLineCommitted(request)`.

- [x] **Step 1: Write failing resolver and UI tests**

Assert exact clip sequences at price boundaries and assert speech fires when the active price or quantity changes after both are valid. Assert inactive price, invalid values, formatting-only edits, and delete actions stay silent.

- [x] **Step 2: Verify the tests fail**

Run: `npm test -- tests/unit/nota-voice.test.ts tests/unit/nota-voice-ui.test.tsx`

Expected: FAIL because requests have no price and only quantity blur commits.

- [x] **Step 3: Implement price decomposition**

Add a helper that maps `1–999` to `prices/values/<n>.ogg`, maps `1.000–999.999` to a thousands chunk plus `ribu` and optional remainder, and maps `1.000.000` to `satu-juta.ogg`.

- [x] **Step 4: Implement one commit path for quantity and active price**

Track focus-entry values per line and numeric field. On blur, detect a semantic change, select `pcsPrice` or `lsnPrice` from the active unit, validate the full request, and call one shared callback. Do not speak for the inactive price field.

- [x] **Step 5: Verify the slice**

Run: `npm test -- tests/unit/nota-voice.test.ts tests/unit/nota-voice-ui.test.tsx`

Expected: PASS.

### Task 3: Piper Price Asset Pack

**Files:**
- Modify: `public/assets/nota-voice/manifest.json`
- Modify: `public/assets/nota-voice/NOTICE.txt`
- Create: `public/assets/nota-voice/prices/values/1.ogg` through `999.ogg`
- Create: `public/assets/nota-voice/prices/harga.ogg`
- Create: `public/assets/nota-voice/prices/seribu.ogg`
- Create: `public/assets/nota-voice/prices/ribu.ogg`
- Create: `public/assets/nota-voice/prices/satu-juta.ogg`
- Create: `public/assets/nota-voice/prices/rupiah.ogg`
- Test: `tests/unit/nota-voice-assets.test.ts`

**Interfaces:**
- Consumes: the paths produced by `resolveNotaVoice`.
- Produces: 1,505 checksum-declared offline Ogg clips.

- [x] **Step 1: Make the asset test fail**

Expect 1,505 unique clips and the full `prices` path set while retaining the no-WAV/model/Python assertion.

- [x] **Step 2: Generate the clips outside the repository**

Load Piper 1.4.2 and the pinned Indonesian ONNX model once, synthesize number prompts `1–999` plus the five connector prompts, encode mono Ogg/Opus, and compute SHA-256 checksums.

- [x] **Step 3: Validate then copy**

Before touching the repository, assert every generated file begins with `OggS`, exceeds 500 bytes, decodes with FFmpeg, and matches its checksum. Copy only after all 1,004 new clips pass.

- [x] **Step 4: Update provenance**

Append the price clips to `manifest.json`, retain the pinned engine/model revision and provenance warning, and state that no runtime model is bundled.

- [x] **Step 5: Verify the slice**

Run: `npm test -- tests/unit/nota-voice-assets.test.ts`

Expected: PASS with 1,505 clips.

### Task 4: Full Verification

**Files:**
- Modify only if a regression test exposes a requirement gap.

- [x] **Step 1: Run static and unit verification**

Run: `npm run verify`

Expected: typecheck and all Vitest files PASS.

- [x] **Step 2: Run desktop behavior verification**

Run: `npm run test:e2e`

Expected: all Playwright Electron tests PASS.

- [x] **Step 3: Package and inspect**

Run: `npm run package`

Expected: Electron Forge succeeds. Inspect `app.asar` for the Piper manifest and price clips; confirm no `.onnx`, `.py`, `.wav`, checkpoint, or CUDA file exists.

- [x] **Step 4: Audit the worktree**

Run: `git diff --check` and compare `git status --short` with the pre-task snapshot.

Expected: no whitespace errors and unrelated pre-existing modifications remain intact.
