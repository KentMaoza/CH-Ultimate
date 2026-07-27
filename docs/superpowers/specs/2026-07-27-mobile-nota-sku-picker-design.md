# CHU Mobile Nota SKU Picker Design

## Summary

CHU Mobile Nota will gain a third item-entry action named **Tambah barang dengan SKU**. It provides a session-only fallback when barcode scanning is unavailable by exposing the active SKU catalogue directly inside the Nota editor.

The picker remains behind the existing `OperationsGateway` boundary and uses the current in-memory demo state. It does not add persistence, a backend, NAS access, or real desktop synchronization.

## Interaction Design

The Nota entry actions are:

1. **Scan barcode** as the primary action.
2. **Tambah barang dengan SKU** as a secondary action.
3. **Tambah barang tanpa barcode** as a secondary action.

The scan action remains visually dominant. The two fallback actions use touch-friendly outlined controls that can wrap their labels on narrow screens.

Selecting **Tambah barang dengan SKU** toggles an inline picker below the action controls. Selecting it again or selecting **Lipat** closes the picker. Opening the SKU picker closes the manual-item form, and opening the manual-item form closes the SKU picker.

The picker stays open after a product is selected so the operator can add several products without reopening it.

## Mobile SKU Picker

The picker adapts the desktop **SKU Gudang** section into a vertical smartphone layout:

- Header: **SKU Gudang**
- Target label: the next number in the currently selected section, such as **Target nomor 3A**
- **Lipat** control
- Search input with placeholder **Cari nama / nomor SKU / alias**
- Active-SKU result count
- One touch-friendly card per SKU

Each card shows:

- SKU number
- Product name
- PCS reference price
- Stock value, **Stok tidak dilacak**, or the current negative/zero value

Only active SKUs appear. Active SKUs with zero, negative, or untracked stock remain selectable, matching the desktop behavior. Archived SKUs do not appear.

Search uses the existing mobile SKU search behavior for name, SKU number, and alias. An empty search shows all active demo SKUs. No pagination is required for the current session-only demo catalogue; the result area may scroll within a bounded height.

## Adding an SKU to Nota

Selecting an SKU uses the same business behavior as a successful barcode scan:

- If the SKU is not yet present, it fills the next available row in the currently selected section.
- The row uses quantity `1`, unit `PCS`, the SKU reference price as the PCS price, and twelve times the reference price as the LSN price.
- If the selected section is full, the existing automatic section-creation behavior chooses the next section.
- If the SKU already exists anywhere in the transaction, its quantity increases by one in the existing row instead of creating a duplicate row.
- When a duplicate is incremented, the editor switches to the section containing that row.
- A successful selection reads the row number, updated quantity, unit, and selected price using the existing Nota voice player.
- The existing success notice identifies whether the item was added or incremented.

The picker must not post stock or revenue. Those effects remain tied to the existing Nota completion flow.

## Component Boundaries

The change stays inside the existing mobile frontend:

- `MobileNotaView` owns picker visibility, query state, target placement, and selection behavior.
- `searchMobileSkus` supplies filtered active SKU results.
- The existing Nota gateway methods update transaction rows.
- Existing Nota helpers determine the selected section, next available slot, row price, and numbering.
- Mobile CSS adds the compact vertical picker and three-action layout.

No new gateway method or domain abstraction is needed.

## Error and Empty States

- When no active SKU matches the search, show **Tidak ada SKU aktif yang cocok.**
- SKU selection is disabled while another Nota operation is busy.
- Existing Nota validation and capacity behavior remain authoritative.
- Archived items remain absent rather than appearing as disabled results.

## Test Strategy

Focused component tests will prove:

1. **Tambah barang dengan SKU** opens and closes the inline picker.
2. Opening the picker and manual form is mutually exclusive.
3. Search filters by SKU details and archived SKUs stay absent.
4. Selecting an SKU places it in the currently selected section with the expected number and prices.
5. Selecting an existing SKU increments its quantity instead of creating another row.
6. New and repeated selections trigger the existing voice feedback with the correct row, quantity, unit, and price.

After focused tests pass, run the full frontend and mobile verification suites, production mobile build, and inspect the live phone preview at a smartphone viewport.

## Acceptance Criteria

- The new button is visible and usable at phone widths without reducing the scan action’s prominence.
- The picker resembles the desktop SKU catalogue while remaining easy to use on a smartphone.
- Operators can find and add an active SKU without scanning a barcode.
- Section placement, duplicate handling, numbering, pricing, and voice behavior match barcode entry.
- All data remains session-only demo data.
