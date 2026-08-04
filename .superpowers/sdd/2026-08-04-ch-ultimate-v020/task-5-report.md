# Task 5 report: durable cross-device image synchronization

## Status

Implemented and verified on `codex/ch-ultimate-v020`.

Assumptions kept intentionally narrow:

- `/v1/images/:sha256` remains the authoritative download route.
- `/v1/skus/:id/image`, reached through `updateSku({ imageUrl: dataUrl })`, remains the authoritative cross-device upload route.
- Image bytes are device-local cache data. They never enter the gateway JSON snapshot or outbox.
- No stock UI, print/export behavior, release metadata, server schema, or Android-native source was changed.

## RED/GREEN evidence

### Slice 1: Blob cache and prefetch coordinator

RED:

- Added `core-image-cache-prefetch.test.ts` for cache-first reads, fetched Blob persistence, exact two-worker deduplication, pause/retry, quota isolation, and authoritative pruning.
- First valid RED run: 6/6 behaviors failed because the Blob storage seam, prefetch state, and controls did not exist. An initial fixture incorrectly retained old cross-entity references; it was corrected before implementation so failures represented missing image behavior.

GREEN:

- Added optional image methods to `CoreGatewayStorage` and a dedicated `CoreImageCacheCoordinator`.
- Cache keys accept only lowercase 64-character SHA-256 values.
- Automatic and on-demand network reads share a two-slot limit and hash-level in-flight deduplication.
- Missing work is derived from authoritative SKU hashes plus persisted cache keys on bootstrap, polling/reconnect, and restart.
- Quota failure pauses image work, increments failed progress, and does not change the business sync phase.
- Explicit retry remains paused while business sync is offline and sends no image request.
- Added changed-hash and two-device cache coverage.
- Focused result: 11/11 passed.

### Slice 2: IndexedDB v1 to v2

RED:

- Added `core-browser-image-storage.test.ts` before the test IndexedDB runtime and v2 store existed.
- RED failed at the missing `fake-indexeddb` dependency, then against the absent v2 Blob operations.

GREEN:

- Upgraded `ch-ultimate-core` database version from 1 to 2.
- Preserved the existing `gateway` store and `snapshot` key.
- Added the `images` object store with Blob values keyed directly by validated hashes.
- Added migration, read/write/list/delete, and lowercase-key tests.
- Focused result: 2/2 passed.

### Slice 3: cache-first loading, upload seeding, and byte boundary

RED:

- Added tests proving a successful upload must seed the acknowledged hash and a payload just over 5 MiB must fail before transport.
- RED exposed the prior durable image outbox and the prior large-regex/size boundary.

GREEN:

- `loadSkuImage` now reads the persistent Blob first and only reaches the server on a miss.
- Upload validates PNG/JPEG/GIF/WebP and decoded size at or below 5 MiB before transport.
- Image upload is sent directly with a fresh idempotency key, then the authoritative acknowledgement is persisted without its request bytes and the returned hash seeds the Blob cache.
- A lost upload response leaves no bytes in the outbox; the user can explicitly retry the selected file.
- Existing upload endpoint and `updateSku({ imageUrl: dataUrl })` entry point remain unchanged.

### Slice 4: shared image consumer

RED:

- Added `gateway-sku-image.test.tsx`; RED failed because the shared component did not exist.
- Added `recommendation-pdf-images.test.ts`; RED failed because gateway PDF hydration did not exist.

GREEN:

- Added one `GatewaySkuImage` component with hash-change reload and CHU fallback behavior.
- Replaced direct SKU image rendering in desktop inventory, price/quantity history, share recommendations, and Nota warehouse selection.
- Replaced direct SKU image rendering in mobile catalogue, detail, price history, dashboard, and recommendations.
- Recommendation PDFs hydrate product images through `OperationsGateway.loadSkuImage` with a two-worker bound.
- Missing image URLs remain fallbacks and are not counted as failures.

### Slice 5: desktop and mobile upload preprocessing

RED:

- Added desktop UI tests for unsupported MIME and files over 5 MiB; both failed against the previous permissive `image/*` check.
- Added `mobile-image-preprocessing.test.ts`; RED failed because the preprocessing module did not exist.

GREEN:

- Desktop accepts only PNG, JPEG, GIF, and WebP at or below 5 MiB.
- Mobile detail exposes capture/upload/replace.
- Mobile decoding requests EXIF orientation application via `createImageBitmap(..., { imageOrientation: 'from-image' })`.
- The longest edge is scaled to at most 1,600 px.
- JPEG encoding iterates quality from 0.9 through 0.4, then reduces dimensions if necessary, and never returns a result over 5 MiB.
- Focused preprocessing and desktop validation tests passed.

### Slice 6: progress and explicit controls

RED:

- Added desktop sync-status coverage for progress copy and pause/retry actions; RED showed no image status or controls.

GREEN:

- `SyncSnapshot.imagePrefetch` exposes `phase`, `total`, `serverAvailable`, `cached`, and `failed`.
- Desktop and mobile status surfaces show cache progress and explicit `Jeda gambar` / `Coba lagi gambar` controls.
- Progress remains separate from server source-image processing: only authoritative hashes are server-available; hashless/missing sources use fallback.

## Round 1 Important-finding remediation

### Reconnect failure classification

RED:

- The transient reconnect regression remained uncached after the authenticated change poll and timed out at `storage.images.has(HASH_A) === false`.
- A 404 source failure was incorrectly retried during reconnect, producing four requests instead of the expected three.

GREEN:

- Image failures are classified as transient network/server, non-transient source, or quota failures.
- Authenticated reconnect clears and requeues only transient failures. Explicit user pause and quota pause remain authoritative.
- A non-transient source failure remains visible in failed progress until `Coba lagi gambar` explicitly clears it.

### On-demand quota and shared failure state

RED:

- A successful cache-miss download rejected with `QuotaExceededError` when the Blob-store write failed, so the visible image could not render.
- An on-demand network failure left `failed: 0`, proving it bypassed the prefetch classifier.

GREEN:

- The shared Blob writer returns the fetched Blob even when persistence exceeds quota, records `failed: 1`, activates quota pause, leaves business sync online, and prevents queued prefetch from advancing.
- Automatic and on-demand downloads now share the same transient/source/quota state classifier and the same two-slot network limiter.

### Visibility-gated consumers and bounded PDF hydration

RED:

- Mounting 40 offscreen `GatewaySkuImage` consumers immediately called `loadSkuImage` 40 times.
- The observer-unavailable fallback had an `aria-label` but no accessible `img` role.
- All three bounded-PDF tests failed: the thumbnail function was absent, the supplied thumbnail result was ignored, and the 300-row path never entered the two-worker thumbnail stage.

GREEN:

- `GatewaySkuImage` waits for `IntersectionObserver` visibility with a `240px` root margin, disconnects on unmount, and keeps an immediate-load fallback with an accessible image role when the observer API is unavailable.
- Recommendation hydration uses two workers, converts each full image immediately to a JPEG thumbnail with longest edge at most 320 px and encoded size at most 96 KiB, and accumulates only bounded thumbnail data.
- The 300-row regression verifies maximum thumbnail concurrency of two and that no `ORIGINAL-` data URL survives in the hydrated plan.

### Prune time-of-check/time-of-use race

RED:

- A deterministic delayed-delete test showed the stale bootstrap prune deleting the newly authoritative seeded hash (`storage.images.has(HASH_B) === false`).

GREEN:

- Cache list/delete/write operations are serialized, authoritative refreshes are generation-checked, and a new seed invalidates an older prune generation before queued work resumes.
- The delayed-delete regression ends with the changed hash present and progress at `serverAvailable: 1`, `cached: 1`, `failed: 0`.

## Round 2 cache-hit prune remediation

RED:

- Added a separate delayed-enumeration regression with no upload, seed, or network image rewrite: bootstrap referenced hash A while already-cached hashes B and C became authoritative through a later change poll.
- Before releasing the stale enumeration, the newer authoritative refresh still exposed `serverAvailable: 0` instead of `2`, proving its reference set was blocked behind the older serialized prune work.

GREEN:

- Every refresh now advances its generation, derives its authoritative hashes, clears stale queued work, and publishes those references synchronously before entering serialized Blob storage work.
- After each awaited cache enumeration the refresh rejects stale generations. Immediately before delete, candidates are filtered again against the current authoritative references.
- The regression verifies B and C were never passed to `deleteImages`, both cached Blobs remain present, and progress settles at `serverAvailable: 2`, `cached: 2`, `failed: 0`.

## Verification

- Focused image/cache/prefetch/consumer/native adapter/upload suites passed.
- Final focused cache/prefetch regression after the shared two-slot limiter and offline retry guard: 11/11 passed.
- Renderer typecheck: `npm run typecheck` passed.
- Server typecheck: `npm run server:typecheck` passed.
- Full renderer suite: `npm test` passed, 76 files and 552 tests.
- Mobile production build: `npm run mobile:build` passed.
- Android tests were not run because no Android/native source changed.
- `git diff --check` passed.
- Round 1 focused cache/consumer/PDF/preprocessing result: 4 files, 27 tests passed.
- Round 1 renderer typecheck: `npm run typecheck` passed.
- Round 1 server typecheck: `npm run server:typecheck` passed.
- Round 1 full renderer suite: `npm test` passed, 76 files and 563 tests.
- Round 1 mobile production build: `npm run mobile:build` passed with the existing large-chunk warning.
- Round 2 focused image cache/storage result: 2 files, 21 tests passed.
- Round 2 renderer and server typechecks passed.
- Round 2 full renderer suite: `npm test` passed, 76 files and 564 tests.
- Round 2 mobile production build passed with the existing large-chunk warning.

## Remaining concerns

- Mobile orientation/canvas behavior is unit-tested through injected decoder/encoder boundaries and production-built, but was not exercised on a physical Android camera in this task.
- The mobile build retains its existing large-chunk warning; this task did not broaden into bundle splitting.
- The workspace audit currently reports pre-existing dependency vulnerabilities. No automatic audit fix was applied because it would be out of scope and potentially breaking.
