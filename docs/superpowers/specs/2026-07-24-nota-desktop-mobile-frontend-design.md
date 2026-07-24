# Nota Desktop and CHU Mobile Frontend Revision

## Goal

Add an explicit delivery destination to completed desktop nota, add a
touch-first Nota and archive experience to CHU Mobile, and keep the entire
revision session-only behind `OperationsGateway`.

## Scope Boundaries

- Keep `MockOperationsGateway`; add no backend, NAS integration, database,
  persistence, offline queue, or real desktop/mobile synchronization.
- Keep Indonesian copy, integer rupiah, WITA dates, and the CH Nota visual
  language.
- Keep `/Users/hamlet/Documents/CH Nota` read-only.
- Existing completed nota without a destination remain visible in Arsip.

## Shared Nota Model

`status: 'completed'` continues to mean that stock and revenue have been
posted. A separate destination identifies the UI bucket:

```ts
export type NotaCompletionDestination = 'archive' | 'finished';

export interface NotaTransaction {
  completionDestination?: NotaCompletionDestination;
}
```

`completeNotaTransaction(transactionId, destination)` posts stock and revenue
once and records the selected destination. Reopening does not reverse the
posting. Recompletion posts only the delta and may replace the destination.
Cancellation retains the destination so restoration returns to the original
bucket.

## Desktop Experience

The completion dialog offers two numbered choices:

1. `Barang dikirim sekarang` saves to Arsip.
2. `Barang dikirim nanti` saves to Selesai.

The dialog becomes a result state after the operation. Success names the
destination and offers `Lihat Arsip` or `Lihat Selesai`. Failure preserves the
editable nota, shows the exact domain reason, and offers retry.

Arsip Nota has tabs in this order: `Arsip | Selesai | Sampah`. Arsip and
Selesai share filters, pagination, read-only preview, and reopen behavior.
There is no direct “mark shipped” action. A reopened nota may be completed to
either destination.

## Mobile Experience

The bottom navigation becomes `Beranda | SKU | Nota | Arsip | Lainnya`.
Recommendation and price-change destinations move under Lainnya.

Mobile Nota uses stacked item cards. Each page contains 15 numbered rows:
`1A–15A`, `1B–15B`, continuing through Z and then AA. The 16th unique item
creates the next page automatically. Operators may also add the next page
manually. Page accents reuse the desktop palette.

An active SKU barcode or alias fills the next row. Scanning a SKU that already
exists in the transaction increments that line by one using its current unit
and price. Archived and unknown codes show a clear reason. Items without a
barcode are entered as free-text lines and do not use SKU search.

Mobile completion always records destination `archive`. The success result
states that the nota is stored in the session-only mobile archive and has not
been sent to desktop because CH Core API is unavailable.

Mobile Arsip is read-only and contains only completed archive-destination
nota. It exposes no Selesai or Sampah tabs and labels every entry
`Belum terkirim ke desktop · frontend demo`.

## Verification

- Domain tests prove destination filtering, backward compatibility, posting,
  reopen/recomplete delta behavior, cancellation, and restoration.
- Desktop component tests prove both choices, success/failure result states,
  bucket navigation, tabs, preview, and reopen.
- Mobile tests prove free-text entry, barcode/alias handling, duplicate scans,
  page overflow, suffixes, colors, completion, archive filtering, and
  navigation.
- Full verification includes typecheck, unit/component tests, Electron E2E,
  mobile build, Android unit tests, and Android lint.
