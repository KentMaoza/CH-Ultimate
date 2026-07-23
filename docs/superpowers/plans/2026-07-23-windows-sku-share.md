# Windows Per-SKU Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace desktop recommendation PDF export with one-SKU sharing that uses the system share sheet when available and an in-app copy/save fallback otherwise.

**Architecture:** Keep recommendation selection in the existing shared domain report. Move the public SKU share-text formatter into a renderer-neutral domain module, add a small Web Share adapter for desktop, and render fallback controls inside a focused dialog. Mobile reuses the shared formatter while retaining its Capacitor adapter.

**Tech Stack:** React 19, TypeScript 5.9, Electron 41 renderer, Web Share API, Clipboard API, Vitest, Testing Library, Playwright.

## Global Constraints

- Share exactly one SKU per action.
- Shared content contains product image when available, product name, SKU number, and integer rupiah reference price.
- Shared content must not contain stock, supplier, idle duration, or urgency.
- Keep `buildShareRecommendationReport` as the single recommendation engine for desktop and mobile.
- Remove desktop PDF export and `jsPDF` when no imports remain.
- Keep business data in memory; add no backend, persistence, NAS, or synchronization.
- Preserve Electron `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Do not include unrelated Nota/voice changes in feature commits.

---

### Task 1: Shared SKU Share Text

**Files:**
- Create: `src/domain/sku-share.ts`
- Modify: `mobile/ports.ts:1-45`
- Modify: `tests/unit/mobile-native-adapters.test.ts:1-220`
- Test: `tests/unit/sku-share.test.ts`

**Interfaces:**
- Produces: `formatSkuShareText(sku: Sku): string`
- Consumes: `Sku` from `src/domain/types`

- [ ] **Step 1: Write the failing formatter test**

```ts
import { expect, test } from 'vitest';
import { formatSkuShareText } from '../../src/domain/sku-share';
import type { Sku } from '../../src/domain/types';

test('formats only public SKU fields for sharing', () => {
  const sku: Sku = {
    id: 'share-1',
    skuNumber: 'SKU-001',
    aliases: [],
    name: 'Produk Contoh',
    referencePrice: 25_000,
    stock: 99,
    tracked: true,
    note: '',
    imageUrl: '',
    createdAt: '2026-07-23T00:00:00.000Z',
    archived: false,
  };

  expect(formatSkuShareText(sku)).toBe(
    'Produk Contoh\nSKU: SKU-001\nHarga referensi: Rp25.000',
  );
  expect(formatSkuShareText(sku)).not.toContain('99');
  expect(formatSkuShareText(sku)).not.toContain('Stok');
});
```

- [ ] **Step 2: Run the formatter test to verify RED**

Run: `npx vitest run tests/unit/sku-share.test.ts`

Expected: FAIL because `src/domain/sku-share.ts` does not exist.

- [ ] **Step 3: Add the formatter and switch mobile to it**

```ts
// src/domain/sku-share.ts
import type { Sku } from './types';

export function formatSkuShareText(sku: Sku): string {
  const price = `Rp${Math.round(sku.referencePrice).toLocaleString('id-ID')}`;
  return `${sku.name}\nSKU: ${sku.skuNumber}\nHarga referensi: ${price}`;
}
```

In `mobile/ports.ts`, import `formatSkuShareText` from `../src/domain/sku-share`, re-export it for compatibility, and remove the local formatter plus its `formatRupiah` import.

- [ ] **Step 4: Run shared and mobile share tests**

Run: `npx vitest run tests/unit/sku-share.test.ts tests/unit/mobile-native-adapters.test.ts`

Expected: PASS with no stock in the formatted text.

### Task 2: Desktop System Share Adapter

**Files:**
- Create: `src/renderer/sku-share.ts`
- Modify: `tests/unit/sku-share.test.ts`

**Interfaces:**
- Consumes: `formatSkuShareText(sku)`
- Produces: `shareSkuWithSystem(sku, shareNavigator?, loadFile?): Promise<'shared' | 'cancelled' | 'fallback'>`
- Produces: `loadSkuShareFile(sku, fetcher?): Promise<File | null>`
- Produces: `downloadSkuImage(sku, dependencies?): Promise<boolean>`

- [ ] **Step 1: Add failing adapter tests**

```ts
test('shares one SKU with an image file and public text', async () => {
  const share = vi.fn(async () => undefined);
  const file = new File(['image'], 'SKU-001.png', { type: 'image/png' });
  const result = await shareSkuWithSystem(sku, {
    share,
    canShare: () => true,
  }, async () => file);

  expect(result).toBe('shared');
  expect(share).toHaveBeenCalledOnce();
  expect(share).toHaveBeenCalledWith({
    title: 'Produk Contoh',
    text: 'Produk Contoh\nSKU: SKU-001\nHarga referensi: Rp25.000',
    files: [file],
  });
});

test('returns fallback when system share is unavailable', async () => {
  await expect(shareSkuWithSystem(sku, {})).resolves.toBe('fallback');
});

test('returns cancelled for AbortError without claiming success', async () => {
  const share = vi.fn(async () => {
    throw new DOMException('cancelled', 'AbortError');
  });
  await expect(shareSkuWithSystem(sku, { share })).resolves.toBe('cancelled');
});

test('falls back to text when the image cannot load', async () => {
  const share = vi.fn(async () => undefined);
  const result = await shareSkuWithSystem(
    { ...sku, imageUrl: '/missing.png' },
    { share, canShare: () => true },
    async () => null,
  );
  expect(result).toBe('shared');
  expect(share).toHaveBeenCalledWith(expect.not.objectContaining({ files: expect.anything() }));
});
```

- [ ] **Step 2: Run adapter tests to verify RED**

Run: `npx vitest run tests/unit/sku-share.test.ts`

Expected: FAIL because `src/renderer/sku-share.ts` and its exports do not exist.

- [ ] **Step 3: Implement the smallest Web Share adapter**

```ts
export type DesktopShareResult = 'shared' | 'cancelled' | 'fallback';

export interface ShareNavigator {
  share?(data: ShareData): Promise<void>;
  canShare?(data: ShareData): boolean;
}

export async function shareSkuWithSystem(
  sku: Sku,
  shareNavigator: ShareNavigator = navigator,
  loadFile: (sku: Sku) => Promise<File | null> = loadSkuShareFile,
): Promise<DesktopShareResult> {
  if (!shareNavigator.share) return 'fallback';
  const data: ShareData = { title: sku.name, text: formatSkuShareText(sku) };
  const file = sku.imageUrl ? await loadFile(sku).catch(() => null) : null;
  if (file && shareNavigator.canShare?.({ files: [file] })) data.files = [file];
  try {
    await shareNavigator.share(data);
    return 'shared';
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError'
      ? 'cancelled'
      : 'fallback';
  }
}
```

`loadSkuShareFile` must fetch the local image, reject non-OK responses, infer `png`, `jpg`, `webp`, or `svg` from MIME type, sanitize the SKU number, and return a `File`. `downloadSkuImage` must reuse that file, create one object URL, click one dated anchor download, and always revoke the URL.

- [ ] **Step 4: Run adapter tests to verify GREEN**

Run: `npx vitest run tests/unit/sku-share.test.ts`

Expected: PASS for image share, text fallback, cancellation, and unavailable API.

### Task 3: Per-SKU Desktop UI and Fallback Dialog

**Files:**
- Create: `src/renderer/components/SkuShareDialog.tsx`
- Modify: `src/renderer/pages/ShareRecommendationsPage.tsx:15-85`
- Modify: `src/renderer/styles.css:212-230`
- Modify: `tests/unit/share-recommendations-ui.test.tsx`

**Interfaces:**
- Consumes: `shareSkuWithSystem(sku)` and `formatSkuShareText(sku)`
- Produces: `SkuShareDialog({ sku, onClose })`

- [ ] **Step 1: Replace the PDF UI test with failing per-SKU tests**

```tsx
test('shares only the selected SKU without stock', async () => {
  const share = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  render(<App gateway={new MockOperationsGateway(() => state)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));

  fireEvent.click(screen.getByRole('button', { name: 'Bagikan SKU Kemeja Lama CH009' }));

  await waitFor(() => expect(share).toHaveBeenCalledOnce());
  expect(share).toHaveBeenCalledWith({
    title: 'Kemeja Lama CH009',
    text: expect.stringMatching(/^Kemeja Lama CH009\nSKU: SKU-old\nHarga referensi: Rp25\.000$/),
  });
  expect(JSON.stringify(share.mock.calls)).not.toContain('Stok');
});

test('opens the in-app fallback when system share is unavailable', async () => {
  Reflect.deleteProperty(navigator, 'share');
  render(<App gateway={new MockOperationsGateway(() => state)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));
  fireEvent.click(screen.getByRole('button', { name: 'Bagikan SKU Kemeja Lama CH009' }));

  const dialog = await screen.findByRole('dialog', { name: 'Bagikan SKU' });
  expect(within(dialog).getByText('Kemeja Lama CH009')).toBeInTheDocument();
  expect(within(dialog).queryByText(/Stok/i)).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Salin informasi' })).toBeEnabled();
});
```

- [ ] **Step 2: Run the UI test to verify RED**

Run: `npx vitest run tests/unit/share-recommendations-ui.test.tsx`

Expected: FAIL because rows have no `Bagikan SKU` button and the PDF button still exists.

- [ ] **Step 3: Implement row actions and fallback dialog**

`RecommendationRow` receives:

```ts
{
  item: ShareRecommendationItem;
  pending: boolean;
  onShare: (sku: Sku) => void;
}
```

It renders:

```tsx
<button
  className="button primary share-recommendation__share"
  disabled={pending}
  aria-label={`Bagikan SKU ${item.sku.name}`}
  onClick={() => onShare(item.sku)}
>
  {pending ? 'Membuka…' : 'Bagikan SKU'}
</button>
```

`ShareRecommendationsPage` stores `pendingSkuId`, `fallbackSku`, and a status message. It opens `SkuShareDialog` only for the `'fallback'` result, reports success only for `'shared'`, and reports cancellation neutrally.

`SkuShareDialog` renders a native `<dialog open>`-style accessible overlay with product image fallback, name, SKU number, formatted price, **Salin informasi**, optional **Simpan gambar**, and **Tutup**. Its copy action calls `navigator.clipboard.writeText(formatSkuShareText(sku))`; its save action calls `downloadSkuImage(sku)`.

- [ ] **Step 4: Add scoped desktop styles**

Extend the existing share recommendation grid with one action column. Add styles for:

```css
.share-recommendation__share { min-width: 112px; }
.sku-share-dialog { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: 24px; background: rgb(0 0 0 / 55%); }
.sku-share-dialog__panel { width: min(460px, 100%); border: 2px solid #111; background: #fff; box-shadow: 8px 8px 0 #111; }
.sku-share-dialog__actions { display: flex; justify-content: flex-end; gap: 8px; }
```

Keep controls at least 44 px high and retain the monochrome design.

- [ ] **Step 5: Run UI and adapter tests to verify GREEN**

Run: `npx vitest run tests/unit/sku-share.test.ts tests/unit/share-recommendations-ui.test.tsx tests/unit/mobile-native-adapters.test.ts`

Expected: PASS with one-SKU calls, no stock in share payloads, and a working fallback dialog.

### Task 4: Remove PDF Surface

**Files:**
- Delete: `src/renderer/pages/share-recommendations-pdf.ts`
- Delete: `tests/unit/share-recommendations-pdf.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`

**Interfaces:**
- Removes: `createShareRecommendationsPdf(report)`
- Keeps: `buildShareRecommendationReport(state, asOf, limit)`

- [ ] **Step 1: Add a source regression assertion**

In `tests/unit/share-recommendations-ui.test.tsx`, assert:

```ts
expect(screen.queryByRole('button', { name: /Ekspor PDF/i })).not.toBeInTheDocument();
expect(screen.getAllByRole('button', { name: /^Bagikan SKU / })).not.toHaveLength(0);
```

- [ ] **Step 2: Run the UI test and verify the PDF assertion fails before deletion**

Run: `npx vitest run tests/unit/share-recommendations-ui.test.tsx`

Expected: FAIL while the PDF button remains.

- [ ] **Step 3: Delete PDF code and dependency**

Remove the PDF import, `exportPdf`, and toolbar button. Delete the generator and its test. Run:

`npm uninstall jspdf`

Update README copy from PDF export to per-SKU share with system/fallback behavior.

- [ ] **Step 4: Verify no PDF runtime remains**

Run: `rg -n "jspdf|createShareRecommendationsPdf|Ekspor PDF rekomendasi" src mobile tests package.json package-lock.json`

Expected: no matches.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm run typecheck`

Run: `npx vitest run tests/unit/sku-share.test.ts tests/unit/share-recommendations-ui.test.tsx tests/unit/mobile-native-adapters.test.ts`

Expected: all commands exit 0.

### Task 5: Full Verification and Main Integration

**Files:**
- Modify as generated: `package-lock.json`
- Commit only files covered by this plan plus already-approved mobile companion work.

**Interfaces:**
- Produces: a tested `main` containing mobile companion and desktop per-SKU share.

- [ ] **Step 1: Run fresh verification**

Run:

```bash
npm run verify
npm run test:e2e
npm run package
npm run mobile:build
git diff --check
```

Expected: typecheck, all unit/component tests, Electron E2E, desktop package, mobile production build, and whitespace checks all exit 0.

- [ ] **Step 2: Audit scope before staging**

Run:

```bash
git status --short
git diff --name-only
git diff -- src/renderer/nota tests/unit/nota-voice.test.ts tests/unit/nota-voice-ui.test.tsx
```

Expected: Nota/voice files remain unstaged and are not part of the feature commit.

- [ ] **Step 3: Commit the implementation on the feature branch**

Stage only the shared recommendation engine, desktop/mobile share files, tests, package metadata, Android Capacitor sync files, README, and approved docs. Do not stage unrelated Nota/voice files.

Run: `git diff --cached --check`

Expected: exit 0.

Run: `git commit -m "feat: share recommendations one SKU at a time"`

Expected: one implementation commit on `codex/chu-companion-android`.

- [ ] **Step 4: Integrate into main without losing user changes**

Temporarily preserve all remaining unrelated tracked/untracked work in one named stash, switch to `main`, fast-forward merge `codex/chu-companion-android`, then restore that stash onto the updated `main` worktree. Never use `git reset --hard` or `git checkout --`.

Run:

```bash
git stash push --include-untracked -m "preserve unrelated work before Windows share merge"
git switch main
git merge --ff-only codex/chu-companion-android
git stash pop
git status --short --branch
```

Expected: `main` points at the implementation commit. Any unrelated user files are restored as unstaged/untracked work and remain uncommitted.

- [ ] **Step 5: Verify main**

Run: `npm run verify`

Expected: all tests and typecheck exit 0 from `main`.
