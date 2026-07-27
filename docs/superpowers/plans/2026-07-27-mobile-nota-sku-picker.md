# Mobile Nota SKU Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a touch-friendly, inline SKU catalogue to CHU Mobile Nota so operators can add products without scanning a barcode.

**Architecture:** Keep the feature inside `MobileNotaView` and reuse the existing in-memory `OperationsGateway`, `searchMobileSkus`, Nota slot selection, and barcode entry path. The picker owns only local visibility and query state; selecting a card passes the SKU number into the same row-update behavior used by a successful scan.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Vite, existing CHU mobile CSS.

## Global Constraints

- Keep all business data in memory and session-only.
- Do not add a backend, persistence, NAS access, or real desktop synchronization.
- Keep the renderer behind `OperationsGateway`; no new gateway method is required.
- Use Indonesian UI copy, integer rupiah, and the existing monochrome CH Nota-inspired mobile design.
- Show only active SKUs; zero, negative, and untracked stock remain selectable.
- Selecting an existing SKU increments its current row by one and speaks the updated row request.
- The picker stays open after selection and targets the currently selected Nota section.
- Treat `/Users/hamlet/Documents/CH Nota` as read-only.

## File Structure

- Modify `mobile/components/MobileNotaView.tsx`: picker state, filtering, toggle behavior, SKU cards, and catalogue selection.
- Modify `mobile/styles.css`: three-action layout and compact vertical SKU picker.
- Modify `tests/unit/mobile-nota-ui.test.tsx`: real component coverage for picker visibility, filtering, section placement, duplicate handling, and voice feedback.

No new component or domain file is needed. The picker is specific to the Nota editor, and extracting it would add an interface without a second consumer.

---

### Task 1: Inline Picker, Search, and Mutual Exclusion

**Files:**
- Modify: `tests/unit/mobile-nota-ui.test.tsx:1-194`
- Modify: `mobile/components/MobileNotaView.tsx:1-62`
- Modify: `mobile/components/MobileNotaView.tsx:266-285`
- Modify: `mobile/styles.css:867-891`

**Interfaces:**
- Consumes: `searchMobileSkus(skus: Sku[], query: string): Sku[]`
- Produces: local `skuPickerOpen: boolean`, local `skuQuery: string`, and an inline region named `Tambah barang dengan SKU`

- [ ] **Step 1: Write the failing picker behavior test**

Add this test to `tests/unit/mobile-nota-ui.test.tsx`:

```tsx
test('SKU picker toggles inline, filters active demo SKUs, and is mutually exclusive with manual entry', async () => {
  renderNota();
  await screen.findByRole('heading', { name: 'Nota Barang' });

  fireEvent.click(screen.getByRole('button', { name: 'Tambah barang dengan SKU' }));
  const picker = screen.getByRole('region', { name: 'Tambah barang dengan SKU' });
  expect(within(picker).getByText('Target nomor 1A')).toBeInTheDocument();
  expect(within(picker).getByText('5 SKU aktif')).toBeInTheDocument();
  expect(within(picker).queryByText('Minuman Serbuk Cokelat')).not.toBeInTheDocument();

  fireEvent.change(within(picker).getByRole('searchbox', { name: 'Cari SKU untuk nota' }), {
    target: { value: 'DRESS-MERAH' },
  });
  expect(within(picker).getByText('Dress Katun Merah')).toBeInTheDocument();
  expect(within(picker).queryByText('Beras Hitam Premium 1 kg')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Tambah barang tanpa barcode' }));
  expect(screen.queryByRole('region', { name: 'Tambah barang dengan SKU' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Barang tanpa barcode' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Tambah barang dengan SKU' }));
  expect(screen.queryByRole('region', { name: 'Barang tanpa barcode' })).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('region', { name: 'Tambah barang dengan SKU' })).getByRole('button', { name: 'Lipat daftar SKU' }));
  expect(screen.queryByRole('region', { name: 'Tambah barang dengan SKU' })).not.toBeInTheDocument();
});
```

This test catches removal of the new action, archived-SKU leakage, broken alias filtering, incorrect target numbering, or overlapping manual and SKU editors.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- tests/unit/mobile-nota-ui.test.tsx
```

Expected: FAIL because the button `Tambah barang dengan SKU` does not exist.

- [ ] **Step 3: Add picker state and filtered active results**

Change the mobile-demo-state import:

```tsx
import { findSkuByScanCode, searchMobileSkus } from '../../src/domain/mobile-demo-state';
```

Add state beside `manualOpen`:

```tsx
const [skuPickerOpen, setSkuPickerOpen] = useState(false);
const [skuQuery, setSkuQuery] = useState('');
```

Add filtered results beside the existing totals:

```tsx
const skuResults = useMemo(
  () => searchMobileSkus(snapshot.skus, skuQuery),
  [snapshot.skus, skuQuery],
);
```

Rename `nextManualLabel` to `nextItemLabel` and retain the existing calculation:

```tsx
const nextItemLabel = transaction
  ? nextSlot
    ? `${nextSlot.page.lines.findIndex((line) => line.id === nextSlot.line.id) + 1}${nextSlot.page.suffix}`
    : `1${noteSuffixFromIndex(transaction.nextNoteIndex)}`
  : '';
```

Use `nextItemLabel` for the manual item number and the picker target.

- [ ] **Step 4: Render the three actions and inline picker**

Replace the existing two-action block with:

```tsx
<div className="mobile-nota-actions">
  <button className="primary-action mobile-nota-actions__scan" disabled={busy} onClick={() => void scan()}>
    <ScanIcon />Scan barcode
  </button>
  <button
    className="secondary-action"
    aria-expanded={skuPickerOpen}
    disabled={busy}
    onClick={() => {
      setSkuPickerOpen((open) => !open);
      setManualOpen(false);
    }}
  >
    Tambah barang dengan SKU
  </button>
  <button
    className="secondary-action"
    disabled={busy}
    onClick={() => {
      setManualOpen((open) => !open);
      setSkuPickerOpen(false);
    }}
  >
    Tambah barang tanpa barcode
  </button>
</div>
```

Render this region immediately after the action block:

```tsx
{skuPickerOpen && <section className="mobile-nota-sku-picker" aria-label="Tambah barang dengan SKU">
  <header>
    <div>
      <strong>SKU GUDANG</strong>
      <span>Target nomor {nextItemLabel}</span>
    </div>
    <button aria-label="Lipat daftar SKU" onClick={() => setSkuPickerOpen(false)}>Lipat</button>
  </header>
  <label className="mobile-nota-sku-search">
    <span>Cari SKU</span>
    <input
      aria-label="Cari SKU untuk nota"
      role="searchbox"
      placeholder="Cari nama / nomor SKU / alias"
      value={skuQuery}
      onChange={(event) => setSkuQuery(event.currentTarget.value)}
    />
  </label>
  <p>{skuResults.length} SKU aktif</p>
  <div className="mobile-nota-sku-results">
    {skuResults.map((sku) => <article key={sku.id}>
      <span className="mobile-nota-sku-mark">CHU</span>
      <div><strong>{sku.skuNumber}</strong><span>{sku.name}</span></div>
      <div><b>{formatRupiah(sku.referencePrice)}</b><span>{sku.tracked ? `Stok ${sku.stock}` : 'Stok tidak dilacak'}</span></div>
    </article>)}
    {!skuResults.length && <p className="mobile-nota-empty">Tidak ada SKU aktif yang cocok.</p>}
  </div>
</section>}
```

- [ ] **Step 5: Add the mobile-adjusted layout**

Replace the two-column action styling and append picker styling in `mobile/styles.css`:

```css
.mobile-nota-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
.mobile-nota-actions button { min-height: 52px; margin: 0; line-height: 1.2; white-space: normal; }
.mobile-nota-actions__scan { grid-column: 1 / -1; }
.mobile-nota-actions svg { width: 21px; height: 21px; margin-right: 6px; vertical-align: middle; }
.mobile-nota-sku-picker { display: grid; overflow: hidden; gap: 10px; border: 1px solid #aaa; border-radius: 14px; background: #fff; }
.mobile-nota-sku-picker > header { display: flex; padding: 12px; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid #ccc; }
.mobile-nota-sku-picker > header strong, .mobile-nota-sku-picker > header span { display: block; }
.mobile-nota-sku-picker > header span { margin-top: 2px; color: #666; font-size: .72rem; font-weight: 750; }
.mobile-nota-sku-picker > header button { min-height: 44px; padding: 8px 12px; border: 1px solid #111; background: #fff; font-weight: 800; }
.mobile-nota-sku-search { display: grid; padding: 0 12px; gap: 5px; }
.mobile-nota-sku-search > span { color: #666; font-size: .7rem; font-weight: 800; text-transform: uppercase; }
.mobile-nota-sku-search input { width: 100%; min-height: 46px; padding: 9px 10px; border: 1px solid #888; border-radius: 9px; font: inherit; }
.mobile-nota-sku-picker > p { margin: 0; padding: 0 12px; color: #666; font-size: .75rem; font-weight: 750; }
.mobile-nota-sku-results { display: grid; overflow-y: auto; max-height: 320px; border-top: 1px solid #ddd; }
.mobile-nota-sku-results article { display: grid; min-height: 72px; padding: 10px 12px; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 9px; border-bottom: 1px solid #ddd; }
.mobile-nota-sku-results article > div:last-child { text-align: right; }
.mobile-nota-sku-results strong, .mobile-nota-sku-results span, .mobile-nota-sku-results b { display: block; }
.mobile-nota-sku-results article span { color: #555; font-size: .74rem; }
.mobile-nota-sku-mark { display: grid !important; width: 38px; height: 38px; place-items: center; border: 1px solid #111; color: #111 !important; font-weight: 900; }
```

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```bash
npm test -- tests/unit/mobile-nota-ui.test.tsx
```

Expected: all mobile Nota tests PASS.

- [ ] **Step 7: Commit the picker surface**

```bash
git add mobile/components/MobileNotaView.tsx mobile/styles.css tests/unit/mobile-nota-ui.test.tsx
git commit -m "feat: add mobile Nota SKU picker"
```

---

### Task 2: SKU Selection, Section Placement, Duplicate Increment, and Voice

**Files:**
- Modify: `tests/unit/mobile-nota-ui.test.tsx:1-240`
- Modify: `mobile/components/MobileNotaView.tsx:88-155`
- Modify: `mobile/components/MobileNotaView.tsx:285-330`
- Modify: `mobile/styles.css:885-930`

**Interfaces:**
- Consumes: current `addSkuCode(rawCode: string): Promise<void>`
- Produces: updated `addSkuCode(rawCode: string, source?: 'barcode' | 'catalogue'): Promise<void>`, `addSkuFromPicker(skuNumber: string): Promise<void>`, and clickable SKU result cards

- [ ] **Step 1: Write the failing selected-section test**

Add:

```tsx
test('SKU picker adds the selected product to the active B section and keeps the picker open', async () => {
  const gateway = renderNota();
  await screen.findByRole('heading', { name: 'Nota Barang' });
  fireEvent.click(screen.getByRole('button', { name: 'Tambah Bagian B' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tambah barang dengan SKU' }));

  const picker = screen.getByRole('region', { name: 'Tambah barang dengan SKU' });
  fireEvent.click(within(picker).getByRole('button', { name: 'Tambah Beras Hitam Premium 1 kg (BRS-108-BLK)' }));

  const row = await screen.findByRole('region', { name: /Beras Hitam Premium 1 kg/ });
  expect(row).toHaveTextContent('1B');
  expect(gateway.getSnapshot().notaTransactions[0]?.pages[1]?.lines[0]).toMatchObject({
    skuId: 'sku-1',
    quantity: 1,
    unit: 'pcs',
    pcsPrice: 42_000,
    lsnPrice: 504_000,
  });
  expect(screen.getByRole('region', { name: 'Tambah barang dengan SKU' })).toBeInTheDocument();
  expect(voice.speak).toHaveBeenLastCalledWith({
    rowNumber: 1,
    suffix: 'B',
    quantity: 1,
    unit: 'pcs',
    price: 42_000,
  });
});
```

This test catches placement that silently returns to section A, incorrect SKU prices, picker auto-close, and missing voice feedback.

- [ ] **Step 2: Write the failing duplicate-increment test**

Add:

```tsx
test('selecting the same SKU twice increments its existing row and rereads the updated quantity', async () => {
  const gateway = renderNota();
  await screen.findByRole('heading', { name: 'Nota Barang' });
  fireEvent.click(screen.getByRole('button', { name: 'Tambah barang dengan SKU' }));
  const picker = screen.getByRole('region', { name: 'Tambah barang dengan SKU' });
  const skuButton = within(picker).getByRole('button', { name: 'Tambah Beras Hitam Premium 1 kg (BRS-108-BLK)' });

  fireEvent.click(skuButton);
  await screen.findByRole('region', { name: /Beras Hitam Premium 1 kg/ });
  fireEvent.click(skuButton);

  await waitFor(() => expect(gateway.getSnapshot().notaTransactions[0]?.pages[0]?.lines[0]?.quantity).toBe(2));
  expect(screen.getAllByRole('region', { name: /Beras Hitam Premium 1 kg/ })).toHaveLength(1);
  expect(voice.speak).toHaveBeenLastCalledWith({
    rowNumber: 1,
    suffix: 'A',
    quantity: 2,
    unit: 'pcs',
    price: 42_000,
  });
});
```

This test catches duplicate row creation, wrong quantity, and stale voice output.

- [ ] **Step 3: Run both tests and verify RED**

Run:

```bash
npm test -- tests/unit/mobile-nota-ui.test.tsx
```

Expected: FAIL because SKU results are not buttons and do not add Nota rows.

- [ ] **Step 4: Reuse the barcode entry path with an explicit source**

Change the function signature:

```tsx
async function addSkuCode(rawCode: string, source: 'barcode' | 'catalogue' = 'barcode') {
```

Change only the new-item notice:

```tsx
setNotice(`${sku.name} ditambahkan dari ${source === 'catalogue' ? 'SKU Gudang' : 'barcode'}.`);
```

Add:

```tsx
async function addSkuFromPicker(skuNumber: string) {
  if (busy) return;
  setBusy(true);
  setNotice('');
  try {
    await addSkuCode(skuNumber, 'catalogue');
  } finally {
    setBusy(false);
  }
}
```

This preserves the existing slot creation, duplicate lookup, prices, section switching, notices, and voice behavior instead of copying them into a second path.

- [ ] **Step 5: Make each SKU result a touch-friendly button**

Replace each result `<article>` with:

```tsx
<button
  key={sku.id}
  className="mobile-nota-sku-card"
  aria-label={`Tambah ${sku.name} (${sku.skuNumber})`}
  disabled={busy}
  onClick={() => void addSkuFromPicker(sku.skuNumber)}
>
  <span className="mobile-nota-sku-mark">CHU</span>
  <span className="mobile-nota-sku-identity"><strong>{sku.skuNumber}</strong><span>{sku.name}</span></span>
  <span className="mobile-nota-sku-value"><b>{formatRupiah(sku.referencePrice)}</b><span>{sku.tracked ? `Stok ${sku.stock}` : 'Stok tidak dilacak'}</span></span>
</button>
```

Update the result selectors:

```css
.mobile-nota-sku-card { display: grid; width: 100%; min-height: 72px; margin: 0; padding: 10px 12px; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 9px; border: 0; border-bottom: 1px solid #ddd; border-radius: 0; background: #fff; text-align: left; }
.mobile-nota-sku-card:active { background: #f1f1f1; }
.mobile-nota-sku-value { text-align: right; }
.mobile-nota-sku-identity strong, .mobile-nota-sku-identity span, .mobile-nota-sku-value b, .mobile-nota-sku-value span { display: block; }
.mobile-nota-sku-identity span, .mobile-nota-sku-value span { color: #555; font-size: .74rem; }
```

Remove the superseded `article` selectors introduced in Task 1.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npm test -- tests/unit/mobile-nota-ui.test.tsx
```

Expected: all mobile Nota tests PASS, including selected-B placement and duplicate increment.

- [ ] **Step 7: Commit selection behavior**

```bash
git add mobile/components/MobileNotaView.tsx mobile/styles.css tests/unit/mobile-nota-ui.test.tsx
git commit -m "feat: add SKU catalogue selection to mobile Nota"
```

---

### Task 3: Regression Verification and Live Phone Preview

**Files:**
- Verify: `mobile/components/MobileNotaView.tsx`
- Verify: `mobile/styles.css`
- Verify: `tests/unit/mobile-nota-ui.test.tsx`

**Interfaces:**
- Consumes: completed inline SKU picker
- Produces: verified frontend-only implementation and a live phone preview

- [ ] **Step 1: Run the focused mobile Nota suite**

```bash
npm test -- tests/unit/mobile-nota-ui.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 2: Run full TypeScript and unit verification**

```bash
npm run verify
```

Expected: typecheck and all unit tests PASS.

- [ ] **Step 3: Run the mobile regression suite**

```bash
npm run test:mobile
```

Expected: all mobile tests PASS.

- [ ] **Step 4: Build the production mobile bundle**

```bash
npm run mobile:build
```

Expected: Vite completes and writes `dist-mobile`.

- [ ] **Step 5: Inspect the live preview at phone widths**

Open the mobile preview and check at `360×800` and `390×844`:

- Scan barcode spans the full action width.
- Both fallback buttons remain at least 44 px tall and their labels wrap without clipping.
- The picker target matches the selected section.
- Search and result cards stay horizontally contained.
- The result list scrolls vertically without moving the bottom navigation.
- Selecting a result adds or increments a row while the picker stays open.

- [ ] **Step 6: Check the final diff and worktree**

```bash
git diff --check
git status --short --branch
git log -3 --oneline
```

Expected: no whitespace errors, no unrelated changes, and the design plus implementation commits are present.
