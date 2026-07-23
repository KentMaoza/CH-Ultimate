# CHU Companion Mobile SKU Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Windows share-recommendation rules to CHU Companion Mobile and let the user share exactly one recommended SKU through the Android share sheet.

**Architecture:** Reuse `buildShareRecommendationReport()` as the single recommendation engine. Add a focused mobile view and an injected `SkuSharePort`; the native adapter uses Capacitor Share plus a cache-only Filesystem file for the product image, with a browser Web Share fallback.

**Tech Stack:** React 19, TypeScript 5.9, Vitest/Testing Library, Capacitor 8, `@capacitor/share` 8.0.1, `@capacitor/filesystem` 8.1.2.

## Global Constraints

- Keep all business data session-only behind `OperationsGateway`.
- Do not add NAS, API, database, desktop synchronization, PDF export, or background work.
- Share one SKU per action: image, name, SKU number, and integer rupiah reference price.
- Never include stock in the shared text.
- Keep Indonesian UI copy, WITA dates, monochrome styling, 44 px touch targets, 360×800/390×844 support, and 200% text support.
- Preserve unrelated and pre-existing dirty-worktree changes.

---

### Task 1: Share Contract and Native Adapter

**Files:**
- Modify: `mobile/ports.ts`
- Modify: `mobile/bootstrap.ts`
- Modify: `mobile/native-adapters.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/unit/mobile-native-adapters.test.ts`
- Test: `tests/unit/mobile-bootstrap.test.ts`

**Interfaces:**
- Consumes: `Sku` from `src/domain/types.ts`.
- Produces: `SkuSharePort.shareSku(sku: Sku): Promise<void>`, `formatSkuShareText(sku: Sku): string`, and a `share` field on `MobilePorts`.

- [ ] **Step 1: Write failing adapter and bootstrap tests**

```ts
test('share text contains public SKU fields but never warehouse stock', () => {
  const sku = createMobileDemoState().skus[0]!;
  expect(formatSkuShareText(sku)).toBe(
    'Beras Hitam Premium 1 kg\nSKU: BRS-108-BLK\nHarga referensi: Rp42.000',
  );
  expect(formatSkuShareText(sku)).not.toContain(String(sku.stock));
});

test('native share writes one image to cache, shares one SKU, and deletes the cache file', async () => {
  await createNativeSkuShare(sharePlugin, filesystemPlugin, fetchImage).shareSku(sku);
  expect(sharePlugin.share).toHaveBeenCalledWith(expect.objectContaining({
    text: expect.stringContaining('SKU: BRS-108-BLK'),
    files: ['file:///cache/chu-share-BRS-108-BLK.svg'],
  }));
  expect(filesystemPlugin.deleteFile).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run tests/unit/mobile-native-adapters.test.ts tests/unit/mobile-bootstrap.test.ts
```

Expected: FAIL because `SkuSharePort`, `formatSkuShareText`, `createNativeSkuShare`, and the `share` mobile port do not exist.

- [ ] **Step 3: Implement the minimal port and native/browser adapters**

Add:

```ts
export interface SkuSharePort {
  shareSku(sku: Sku): Promise<void>;
}

export function formatSkuShareText(sku: Sku): string {
  return `${sku.name}\nSKU: ${sku.skuNumber}\nHarga referensi: ${formatRupiah(sku.referencePrice)}`;
}
```

The native adapter must:

```ts
const written = await filesystem.writeFile({
  path,
  data: base64,
  directory: Directory.Cache,
});
try {
  await share.share({ title: sku.name, text: formatSkuShareText(sku), files: [written.uri], dialogTitle: 'Bagikan SKU' });
} finally {
  await filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
}
```

If loading/writing the image fails, call `share.share()` with text only. The browser port uses `navigator.share({ title, text })` and throws a clear error when Web Share is unavailable.

- [ ] **Step 4: Install pinned plugins and sync lockfile**

Run:

```bash
npm install --save-exact @capacitor/share@8.0.1 @capacitor/filesystem@8.1.2
```

Expected: dependencies and lockfile include the exact versions.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/unit/mobile-native-adapters.test.ts tests/unit/mobile-bootstrap.test.ts
```

Expected: all focused tests pass.

### Task 2: Mobile Recommendation View

**Files:**
- Create: `mobile/components/ShareRecommendationsView.tsx`
- Modify: `mobile/components/Icons.tsx`
- Modify: `mobile/MobileApp.tsx`
- Test: `tests/unit/mobile-app.test.tsx`

**Interfaces:**
- Consumes: `buildShareRecommendationReport(state, asOf)`, `groupShareRecommendationItems(items)`, `SkuSharePort`, and existing `ProductImage`.
- Produces: a routed `recommendations` mobile view with date/tabs, per-supplier rows, detail navigation, and per-SKU share actions.

- [ ] **Step 1: Write failing component tests**

Add tests that assert:

```ts
fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));
expect(screen.getByRole('heading', { name: 'Rekomendasi Share' })).toBeInTheDocument();
expect(screen.getByRole('tab', { name: 'Rekomendasi Harian' })).toHaveAttribute('aria-selected', 'true');

fireEvent.click(screen.getByRole('button', { name: /Bagikan SKU Beras Lama CH009/ }));
await waitFor(() => expect(share.shareSku).toHaveBeenCalledWith(
  expect.objectContaining({ id: 'old' }),
));
expect(share.shareSku).toHaveBeenCalledTimes(1);
```

Also cover the urgent tab, supplier grouping, selected date, opening existing SKU detail, success status, and failure status.

- [ ] **Step 2: Run the mobile component test and verify RED**

Run:

```bash
npx vitest run tests/unit/mobile-app.test.tsx
```

Expected: FAIL because the shortcut, view, route, and injected share port do not exist.

- [ ] **Step 3: Implement the view and route**

Add `MainView = 'home' | 'skus' | 'prices' | 'recommendations'`, accept `share: SkuSharePort`, and render:

```tsx
<ShareRecommendationsView
  onBack={() => navigate('home')}
  onOpenSku={openSku}
  onShareSku={share.shareSku}
  snapshot={snapshot}
/>
```

`ShareRecommendationsView` owns only presentation state: selected date, `daily | urgent` tab, and one status message. It calculates the report with `useMemo`, renders groups as stacked mobile sections, and disables only the tapped SKU button while its share promise is pending.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/unit/mobile-app.test.tsx tests/unit/share-recommendations.test.ts
```

Expected: all recommendation and mobile component tests pass.

### Task 3: Dashboard Entry and Responsive Styling

**Files:**
- Modify: `mobile/components/DashboardView.tsx`
- Modify: `mobile/styles.css`
- Test: `tests/unit/mobile-app.test.tsx`

**Interfaces:**
- Consumes: `DashboardView.onOpenRecommendations`.
- Produces: a full-width dashboard shortcut and responsive recommendation layout.

- [ ] **Step 1: Add a failing dashboard-navigation test**

```ts
expect(within(screen.getByRole('region', { name: 'Aksi cepat' }))
  .getByRole('button', { name: 'Rekomendasi Share' })).toBeInTheDocument();
fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));
expect(screen.getByRole('heading', { name: 'Rekomendasi Share' })).toHaveFocus();
expect(within(screen.getByRole('navigation', { name: 'Navigasi utama' }))
  .getAllByRole('button')).toHaveLength(3);
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npx vitest run tests/unit/mobile-app.test.tsx
```

Expected: FAIL because the dashboard entry is missing.

- [ ] **Step 3: Add the shortcut and scoped CSS slice**

Keep the existing two-column actions and add a third `.quick-action.recommendations-action` spanning both columns. Add only `.share-view`, `.share-tabs`, `.share-summary`, `.share-group`, `.share-item`, and their 360 px/200% overflow rules. Reuse existing button, image, heading, and focus styles instead of introducing a second design system.

- [ ] **Step 4: Run component tests, typecheck, and mobile build**

Run:

```bash
npm run test:mobile
npm run typecheck
npm run mobile:build
```

Expected: all commands exit 0.

### Task 4: Native Sync, Visual QA, Regression, and Signed APK

**Files:**
- Modify: generated Android plugin registrations via `cap sync android`
- Verify: `android/`
- Verify: `out/android/CHU-Companion-Mobile-0.1.0-release.apk`

**Interfaces:**
- Consumes: completed web bundle and native share/filesystem plugins.
- Produces: a signed APK containing per-SKU Android sharing.

- [ ] **Step 1: Sync Android and run native checks**

Run:

```bash
npm run android:sync
npm run android:test
npm run android:lint
```

Expected: Capacitor reports Share and Filesystem plugins; Gradle test and lint exit 0.

- [ ] **Step 2: Verify visible behavior**

Run the mobile dev server, open the built-in browser first, and verify at 360×800 and 390×844:

- dashboard shortcut;
- date and both tabs;
- supplier grouping;
- one-SKU share success/failure with a test port;
- SKU detail route;
- no horizontal overflow;
- 200% text.

Capture the latest screenshot and compare with the accepted CHU Companion concept using `view_image`.

- [ ] **Step 3: Run the full regression suite**

Run:

```bash
npm run verify
npm run test:e2e
git diff --check
```

Expected: typecheck, all unit/component tests, all Electron E2E tests, and whitespace validation pass.

- [ ] **Step 4: Build and verify signed APK**

Load the existing external signing environment and run:

```bash
npm run android:release
shasum -a 256 out/android/CHU-Companion-Mobile-0.1.0-release.apk
apksigner verify --verbose --print-certs out/android/CHU-Companion-Mobile-0.1.0-release.apk
```

Expected: the release build succeeds, a new checksum is printed, and APK signature verification reports `Verifies`.

- [ ] **Step 5: Audit requirements and preserve user changes**

Confirm the final diff proves:

- exactly one SKU is passed to each share action;
- shared text excludes stock and PDF;
- image failure falls back to text;
- cache cleanup occurs;
- no NAS/API/persistence was added;
- unrelated Windows and inventory edits remain intact.
