# Task 7 Report: Staged Catalogue Import and Bounded Image Cache

## Status

`DONE_WITH_CONCERNS`

The owner-only staged import, atomic MariaDB repository, exact workbook
preservation, bounded image worker, authenticated media route, native transport
allowlists, and desktop preview/commit flow are implemented.

The supplied workbook was verified directly from:

`/Users/hamlet/Downloads/SKU_Gudang20260730092414031.xlsx`

Its SHA-256 is
`64fcb734d84462060f76fa7f27495ee1e2dff6201ad2d7a2d13d5c6c27923817`.
The acceptance result is exactly 3,144 rows, 2,786 image jobs, 358 rows
without a valid image, 3 price mismatches, Rp276,267,011 selected-price total,
4,115 stock total, and 168 characters in the longest cell.

## Implemented behavior

- `POST /v1/imports/validate` accepts only authenticated owners, limits the
  JSON body specifically for one 5 MiB XLSX payload, validates the workbook,
  stores its exact bytes under its content hash, and returns a 24-hour staged
  preview.
- `POST /v1/imports/:id/commit` is owner-only and commits the staged workbook
  in one database transaction. A locked committed import returns the original
  receipt as an idempotent replay. A different full import is blocked after
  Nota, stock-movement, or non-import price activity exists.
- Migration 005 adds catalogue provenance, preview data, source metadata,
  content-addressed image assets, and serial image jobs.
- The repository preserves the original workbook path/hash, long primary SKU,
  product-code alias, source note, source creation value, approved source URL,
  selected price, and opening stock. It writes change-log and audit records in
  the same transaction.
- XLSX preflight rejects files above 5 MiB, more than 10,000 rows, text above
  16 KiB, formulas, macros/ActiveX, external links, duplicate identifiers,
  missing columns, traversal-shaped ZIP entries, unsupported ZIP structures,
  and actual expansion above 64 MiB. The expansion check inflates DEFLATE
  entries instead of trusting forged central-directory sizes.
- Sale price wins when positive; otherwise modal price is used. The preview
  exposes every mismatch row, warnings, totals, image count, and missing-image
  count.
- Only exact `https://res.bigseller.pro:443` image URLs are queued. The single
  worker re-resolves and pins public DNS on every hop, rejects any private,
  loopback, link-local, reserved, CGNAT/Tailscale, or multicast answer, allows
  at most three same-host HTTPS redirects, enforces a 10-second request
  timeout, streams at most 5 MiB, validates MIME, magic bytes, dimensions, and
  pixel count, and retries bounded transient failures without rolling back the
  catalogue.
- Image bytes are stored at private, traversal-safe SHA-256 paths and
  deduplicated by content hash. `GET /v1/images/:hash` authenticates every
  caller, verifies stored length/hash, and serves either binary media or the
  bounded JSON envelope used by native transports.
- Electron permits only the exact validate, commit, and SHA-256 image routes;
  larger request/response limits apply only to validate/image transfers.
  Android permits only the authenticated SHA-256 image read and has the same
  route-specific response ceiling.
- The Core gateway validates, previews, commits, reloads canonical bootstrap,
  and loads image bytes through the native transport. The inventory page keeps
  the existing demo import behavior for the mock gateway and uses an explicit
  Indonesian review dialog before a Core commit.

## TDD evidence

Observed RED before implementation included:

- missing catalogue service/storage/repository/routes;
- absent migration-005 schema and transactional writes;
- forged ZIP expansion accepted from falsified metadata;
- missing image downloader, cache, repository, timeout, and worker;
- strict Core schemas rejecting new provenance/image fields;
- missing staged gateway methods and native allowlist routes;
- the desktop path calling the legacy confirmation/import flow;
- imported image hashes not loading through the gateway;
- same-row identifier collision and custom-port image URL accepted;
- cached Core state rejecting the new optional image/source fields.

Each failure was followed by the smallest corresponding implementation and a
focused green run.

## Fresh verification

| Gate | Result |
| --- | --- |
| `npm run verify` | PASS — 51 files, 377 tests |
| `npm run mobile:build` | PASS — 587 modules |
| `npm run package` | PASS — Electron arm64 package |
| `npm --prefix server test` | PASS — 23 files, 146 tests; guarded acceptance skipped |
| supplied-workbook acceptance | PASS — 1 test with exact hash and totals |
| `npm --prefix server run typecheck` | PASS |
| `npm --prefix server run build` | PASS |
| Android `:app:testDebugUnitTest` | PASS |
| Android `:app:lintDebug` | PASS |
| `git diff --check` | PASS |

The root/mobile builds retain the existing Vite CJS-deprecation and
large-chunk warnings. Gradle retains its existing `flatDir` warning.

## Concern and deployment boundary

`CH_CORE_TEST_DATABASE_URL` was not configured, so the destructive integration
suite against an explicitly isolated `chu_test` MariaDB schema was not run.
Migration structure, SQL sequencing, rollback, idempotency, and live-activity
blocking are covered by unit tests, but a real MariaDB migration/commit is not
claimed here.

No NAS was accessed or modified. The implementation writes only through
`CH_CORE_PRIVATE_STORAGE_ROOT`; Task 11 must point that setting at the approved
private mounted volume and run the isolated MariaDB integration plus live
deployment verification before any NAS or production-readiness claim.
