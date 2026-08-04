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

## Verification

- Focused image/cache/prefetch/consumer/native adapter/upload suites passed.
- Final focused cache/prefetch regression after the shared two-slot limiter and offline retry guard: 11/11 passed.
- Renderer typecheck: `npm run typecheck` passed.
- Server typecheck: `npm run server:typecheck` passed.
- Full renderer suite: `npm test` passed, 76 files and 552 tests.
- Mobile production build: `npm run mobile:build` passed.
- Android tests were not run because no Android/native source changed.
- `git diff --check` passed.

## Remaining concerns

- Mobile orientation/canvas behavior is unit-tested through injected decoder/encoder boundaries and production-built, but was not exercised on a physical Android camera in this task.
- The mobile build retains its existing large-chunk warning; this task did not broaden into bundle splitting.
- The workspace audit currently reports pre-existing dependency vulnerabilities. No automatic audit fix was applied because it would be out of scope and potentially breaking.
