# Final review fix report

Status: `DONE_WITH_CONCERNS`

## Summary

- Added `stock_checks` to the MariaDB catalogue replacement live-activity
  guard. An unchanged stock check now causes `LIVE_TRANSACTIONS_EXIST` before
  any catalogue delete is attempted.
- Separated validated CH Core conflict responses from ordinary permanent HTTP
  rejections. Only a response whose `conflict` object passes the shared Core
  conflict schema enters the conflict workflow or can use its resolution route.
- Ordinary permanent 4xx Nota failures now remain in an explicit `blocked`
  state. Later work for the blocked entity stays ordered, unrelated entities
  continue, and desktop/mobile operators can retry or confirm a local discard.
- Replaced the operational PDF's fixed 48-character truncation and fixed row
  count with wrapped cells, calculated row/header heights, page-aware row
  placement, and bounded continuation segments for a single row taller than a
  page. The existing 300-row PDF cap is unchanged.

## Scope and assumptions

- Changes are limited to the three final-review findings and their focused
  regression coverage.
- No backend, database, deployment, NAS, device, publishing, or other external
  operation was performed.
- Discard is an explicit operator action guarded by Indonesian confirmation;
  removing a blocked command refreshes the projection so its optimistic local
  effect is removed.

## Test-first evidence

### Catalogue replacement guard

RED:

```sh
npm --workspace @ch-ultimate/core run test -- test/catalogue-repository.test.ts -t "unchanged stock check"
```

The new regression resolved the catalogue commit instead of rejecting it.

GREEN:

```text
npm --workspace @ch-ultimate/core run test -- test/catalogue-repository.test.ts test/catalogue-service.test.ts
2 files passed; 15/15 tests passed.
```

The regression also asserts the transaction is rolled back, the
`stock_checks` guard is queried, and no `DELETE FROM` statement executes.

### Permanent 4xx outbox handling

RED:

```sh
npm test -- --run tests/unit/core-outbox.test.ts -t "ordinary Nota 400"
```

The new Nota rejection regression received `conflict` instead of `blocked`.
The operator-surface regression subsequently could not find
`Nota ditolak: INVALID_NOTA` before the UI was added.

GREEN:

```text
npm test -- --run tests/unit/core-connection-ui.test.tsx tests/unit/core-outbox.test.ts
2 files passed; 35/35 tests passed.
```

Coverage proves a Nota 400 and a Nota 404 with malformed conflict metadata do
not create offline conflicts or call a conflict-resolution route, pumping does
not loop, unrelated stock work continues, and explicit retry/discard actions
target the blocked operation.

### Lossless PDF wrapping and pagination

RED:

The new long-value regressions initially could not find the terminal image
reference, hash, and note markers, and long rows retained the fixed page count.
After wrapping was introduced, a near-maximum image reference exposed an
oversized-row baseline at `-11.9055` points, below the 8 mm bottom margin.

GREEN:

```text
npm test -- --run tests/unit/operational-exports.test.ts
1 file passed; 6/6 tests passed.
```

Coverage verifies terminal markers for a near-maximum image reference, a long
hash, and long stock-check notes; dynamic pagination; a final baseline above
the bottom margin; and the existing 300-row cap.

### Combined focused regression

```text
npm test -- --run tests/unit/core-outbox.test.ts tests/unit/core-offline-gateway.test.ts tests/unit/core-operations-gateway-mutations.test.ts tests/unit/core-connection-ui.test.tsx tests/unit/operational-exports.test.ts tests/unit/operational-pdf-images.test.ts tests/unit/mobile-export-boundary.test.ts
7 files passed; 74/74 tests passed.
```

## Full repository-local verification

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS, exit 0 |
| `npm run server:typecheck` | PASS, exit 0 |
| `npm test` | PASS, 89 files / 624 tests |
| `npm run server:test` | PASS, 50 files / 338 tests; 1 opt-in real-MariaDB acceptance test skipped |
| `npm run mobile:build` | PASS, 603 modules transformed |
| `git diff --check` | PASS, no output |

Warnings retained as evidence:

- Vite reports its existing CJS Node API deprecation warning.
- The root suite passes but retains the known React `act(...)` warning in
  `nota-core-typing.test.tsx`.
- The mobile build passes but reports the existing >500 kB chunk warning; the
  largest reported chunk is 849.20 kB (249.85 kB gzip).

## Limits

- The opt-in real-MariaDB catalogue acceptance test was not run because no
  explicitly isolated test database was placed in scope. The repository-level
  regression proves SQL ordering and absence of delete calls in the harness.
- No physical-device, Windows package, Android release-signing, browser E2E,
  production database, or live CH Core deployment claim is made by this wave.

## Self-review

- Every changed tracked line maps to one of the three requested findings or
  its focused test/operator surface.
- Conflict metadata now comes only from the validated server payload; no
  synthetic fallback remains.
- The branch and linked worktree are preserved. This report is included in the
  requested single final-review commit; the handoff records the resulting hash.
