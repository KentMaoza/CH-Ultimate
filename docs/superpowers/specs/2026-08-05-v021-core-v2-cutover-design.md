# CH Ultimate v0.2.1 and CH Core v2 coordinated cutover design

Date: 2026-08-05 WITA

## Purpose

Repair the confirmed v0.2.0 client regressions without weakening the strict API
v2 boundary, publish replacement Windows and Android clients, and then upgrade
the currently deployed CH Core v1 only after the documented backup and restore
gates pass.

The observed connection failure is a coordinated-version problem. CH Ultimate
v0.1.5 accepts CH Core schema v1, while v0.2.0 correctly requires schema v2.
The currently deployed Core still serves v1. A compatible release therefore
requires new clients and a controlled Core v2 cutover; silently accepting either
schema would expose v2 stock-check clients to an incomplete contract.

## Release and compatibility boundary

- The replacement client release is `0.2.1`; Android uses `versionCode 8` and
  the existing permanent signer and application ID.
- CH Core v2 remains `apiSchemaVersion: 2` and always emits `stockChecks`, using
  an empty array when no checks exist.
- v0.2.1 remains fail-closed against Core v1 or malformed Core v2. Editing is
  enabled only after a valid v2 bootstrap reaches `online`.
- v0.1.5 remains usable only before the maintenance cutover. After Core v2 is
  live it must fail closed and must not be used for writes.
- The `pilot-v0.2.0` prerelease is preserved. Publishing creates a distinct
  `pilot-v0.2.1` prerelease and distinct artifact names.

## Truthful synchronization state

All Core-backed status copy derives from `SyncStatus.phase`, not from the
`coreBacked` configuration flag. A shared presentation helper owns the mapping:

| Phase | Primary Indonesian state |
| --- | --- |
| `online` | `Tersinkronisasi` |
| `connecting` | `Menghubungkan` |
| `syncing` | `Menyinkronkan` |
| `offline` | `Offline` |
| `conflict` | `Konflik perlu diselesaikan` |
| `revoked` | `Akses perangkat dicabut` |
| `upgrade-required` | `Perlu pembaruan` |

Desktop Nota, mobile dashboard, mobile Nota, and mobile archive receive this
derived state. Only `online` may display text containing `Tersinkronisasi`.
Non-Core demo mode retains its current session-only copy.

`upgrade-required` is a blocking compatibility state on both clients. The app
does not render an ordinary dashboard, empty catalogue, `0 SKU`, image `0/0`,
Nota editor, or other business module behind it. It displays:

> Versi CH Core tidak kompatibel. Perbarui CH Core, lalu coba hubungkan kembali.

This release deliberately does not present cached data during a schema mismatch.
That avoids making an incompatible snapshot appear current. Existing offline
behavior for a compatible cache is unchanged.

## Diagnostic boundary

Bootstrap schema errors keep their detailed parser cause out of the user
interface. `CorePollingCoordinator` receives an optional diagnostic sink. The
desktop and mobile production bootstraps provide a sink that logs the technical
error; unit tests can use the default no-op or an injected spy. UI state receives
only the Indonesian compatibility message.

The sink accepts structured, non-secret metadata. It must not log bearer tokens,
pairing secrets, credential-store contents, full business snapshots, or image
bytes.

## Android Back behavior

Add the official Capacitor App plugin behind a narrow `AppBackButtonPort`. The
React app owns navigation decisions and the native adapter owns `backButton`
subscription plus `exitApp()`.

Back navigation follows these rules in order:

1. An open SKU detail closes to the screen from which it was opened.
2. An open scanner closes to its originating CH Ultimate screen.
3. An archived Nota being edited returns to Archive.
4. Prices, Recommendations, or Data Export return to the recorded originating
   top-level screen (`Beranda` or `Lainnya`).
5. Any other non-home top-level screen returns to `Beranda`.
6. Only top-level `Beranda`, with no overlay or detail, calls native `exitApp()`.

The latest handler is held in a ref so a long-lived native listener never uses
stale React state. Browser/mobile-preview behavior uses a no-op port and remains
testable without Capacitor.

## Windows packaged logo

The sidebar mark becomes a Vite-managed source import rather than a root public
URL. Vite emits a packaged relative asset URL, so Electron `file://` resolves it
inside the renderer bundle. A source test rejects a root-absolute mark and the
Electron packaged end-to-end test asserts that the rendered image completes
with a positive natural width.

## Verification and release

Each behavior is developed RED-GREEN in a bounded slice. Focused tests cover:

- valid v2 bootstrap including `stockChecks: []` reaches `online`;
- malformed/v1 bootstrap shows the Indonesian blocking state and never a valid
  zero-inventory presentation;
- no non-online Core phase displays synchronized copy;
- Nama Barang, Jenis, PCS, and LSN stay usable after an online bootstrap;
- Android Back returns from notification prices and every subordinate flow;
- only home requests native exit;
- the packaged Electron renderer loads the sidebar mark;
- version, filenames, tag, notes, Android code, and signer contract all agree on
  v0.2.1.

Before publication, run the full desktop, mobile, server, Android, Electron
package, and Electron end-to-end gates. After publication, independently
download all three GitHub assets and verify SHA-256, package/version metadata,
and the Android certificate digest before installation.

## Guarded CH Core v2 cutover

`docs/ch-core-v0.2-maintenance-rollback.md` remains authoritative. Client
publication happens first. The live maintenance action may begin only when all
of these gates are measured and recorded:

- users are notified and writes are quiesced;
- client outboxes and active write requests are known;
- `/health/live` and `/health/ready` pass with the repository CA;
- exact counts and migration checksums are captured;
- a new completed logical dump passes its repository verifier;
- an approved independent copy has the same SHA-256;
- a clean scratch restore matches counts and invariants using the exact reviewed
  Core artifact.

No workbook clear/import is part of this repair. Migration `010_stock_checks.sql`
and the full reviewed Core v2 artifact deploy together. After deployment, an
authenticated bootstrap must contain schema marker 2 and `stockChecks`; limited
read/write/idempotency checks then run on explicitly named pilot data.

Full binary/database rollback is allowed only before any v2 write or offline
outbox replay. After the first v2 write, the only safe recovery path is quiesce
and forward-fix.

## Four-day pilot meaning

The four-day pilot is a copied-data LAN observation window that begins only
after both installed v0.2.1 clients and Core v2 pass physical acceptance. It is
not the four-day recommendation priority rule and it is not a claim of
production readiness.

For four consecutive WITA calendar days, the operator records connection/sync
state, blocked or replayed outbox items, Nota edits, image availability, stock
checks, print/PDF/XLSX results, restarts, and any retry-visible errors. The pilot
uses copied/test data, retains rollback evidence, and does not authorize broader
device enrollment or production data migration.

## Explicit non-goals

- Do not loosen schema validation or make `stockChecks` optional.
- Do not add a second compatibility API or a hidden v1 write path.
- Do not clear/import the approved workbook during this bug repair.
- Do not change pairing identity, app ID, Android signer, or local credentials.
- Do not claim physical Windows, Android, printing, deployment, or four-day soak
  success from automated tests alone.
