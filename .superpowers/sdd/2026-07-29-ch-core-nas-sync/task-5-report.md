# Task 5 Partial Report: Secure Desktop CH Core Transport Foundation

## Status

Paused at the user-requested safe checkpoint. This is a coherent foundation,
not a completed Task 5 desktop integration.

The secure main-process transport, encrypted credential store, caller-held
identity workflow, typed IPC contract/registration helper, fail-closed renderer
bootstrap helper, and standalone connection/sync status components are
implemented and focused-test green. They are not yet wired into Electron
startup, Forge preload packaging, or the existing App shell.

Because startup wiring is intentionally absent, the current packaged renderer
still follows the pre-Task-5 demo bootstrap and can instantiate
`MockOperationsGateway`. No claim of production readiness, live CH Core TLS,
NAS connectivity, or packaged fail-closed behavior is made.

## Completed foundation

- Endpoint configuration accepts only an exact `https://<IP literal>:8443`
  origin plus an absolute CA file path. Missing, unknown, malformed, hostname,
  credential-bearing, path, query, and fragment configurations fail closed.
- The generic renderer operation surface accepts only current bootstrap/change
  and centralized business method/path combinations. Absolute URLs,
  protocol-relative paths, traversal (including encoded traversal), control
  characters, unknown fields, arbitrary headers/origin/token fields,
  noncanonical changes queries, identity routes, and the removed
  `/v1/notas/:id/transfer` route are rejected before credential or network use.
- Node HTTPS uses the supplied private CA, `rejectUnauthorized: true`, fixed
  endpoint, bounded request/response bodies, JSON-only responses, timeout
  destruction, and no redirect following. Authorization is attached only
  inside main and is omitted entirely for unauthenticated owner/pairing calls.
- Electron `safeStorage` persistence fails closed when unavailable or when
  encryption is disabled. One encrypted credential envelope is atomically
  promoted in userData with restrictive permissions; no plaintext fallback
  exists. Decryption errors are generic.
- Owner bootstrap, pairing claim, pairing completion, and token rotation
  generate canonical caller-held secrets in main and save pending state before
  network use. Dropped-response retries reuse the same claim/device/next-token
  secrets. Rotation promotes only after acknowledgement and retains the old
  token for overlap retry.
- The bridge contract contains exactly six methods: `request`,
  `credentialStatus`, `enrollOwner`, `claimPairing`, `completePairing`, and
  `rotateToken`. IPC registration binds to the intended webContents and exact
  top frame, rejects malformed identity input before service/credential use,
  and exposes no raw IPC.
- Renderer bootstrap refuses mock fallback when a production bridge reports
  production or when production has no bridge. The only mock path requires
  explicit test mode, `allowTestMock: true`, and an injected mock factory.
- Standalone Indonesian connection/status UI covers `Menghubungkan`,
  `Terhubung`, `Menyinkronkan`, `Tidak terhubung`, `Konflik data`,
  `Akses dicabut`, `Perlu pembaruan`, and actionable `Coba lagi`.
- Browser cache uses IndexedDB for business cache only. Foreground/resume
  visibility logic exists only in the renderer clock adapter.

## TDD evidence

Observed RED before each implementation slice:

- Missing endpoint/allowlist module.
- Missing HTTPS client.
- Missing safeStorage credential store.
- Missing identity coordinator.
- Missing bridge contract and IPC registration.
- Transfer route accepted before its focused rejection correction.
- Untrusted/missing top-frame IPC and malformed identity input reached service
  before their focused rejection corrections.
- Extra renderer headers/origin fields reached the operation sender before
  strict request-shape validation.
- Missing desktop service, renderer bootstrap, and connection/status
  components.

Fresh checkpoint verification:

- Focused Task 5 tests: 8 files, 38 tests passed.
- `npm run typecheck`: passed.
- `git diff --check`: passed.
- Production files are below 300 lines; largest is
  `src/electron/core-identity-main.ts` at 266 lines.

`npm test` and `npm run package` were not run at this pause checkpoint because
the user explicitly stopped work before the Electron/renderer integration
slice. No package result is claimed.

## Exact remaining Task 5 work

1. Create `src/preload.ts` and expose the tested six-method bridge through
   `contextBridge`; create/register its Vite preload build in Forge.
2. Wire `src/main.ts` after BrowserWindow creation: construct the safeStorage
   credential store in userData, load the local production config/CA, create
   the desktop service, and register handlers against that window's
   `webContents`/top frame while retaining `contextIsolation: true`,
   `nodeIntegration: false`, and `sandbox: true`.
3. Add the production config template as a packaged resource with placeholders
   only; do not add a fake IP, CA, certificate, or secret.
4. Declare `window.chCore` in `src/types.d.ts`.
5. Integrate `bootstrapDesktopGateway` in `src/renderer/main.tsx`; render
   `CoreConnectionScreen` for bridge/config/credential setup states and never
   instantiate a mock in packaged/production startup.
6. Remove the implicit mock fallback from the production
   `OperationsProvider`/`App` path. Update component tests to inject
   `MockOperationsGateway` explicitly.
7. Add `OperationsSyncStatus` to App shell/status only and add connection/status
   CSS only. Do not redesign feature pages.
8. Run focused integration tests, full `npm test`, `npm run typecheck`,
   `npm run package`, and `git diff --check`; inspect the packaged output to
   verify the preload/config template is present and no live TLS claim is made.

No NAS was accessed or modified.

---

# Task 5 Completion Report: Packaged Electron Integration

## Final status

Task 5 is complete for the local desktop/package boundary. The packaged
Electron startup now builds and loads the narrow preload bridge, constructs
the `safeStorage` credential store after `app.whenReady()`, reads production
configuration only from
`path.join(app.getPath('userData'), 'ch-core-config.json')`, creates the CH
Core desktop service, and registers the fixed IPC handlers only after the
`BrowserWindow` exists. The handlers are bound to that window's
`webContents`/top frame and removed when the trusted window closes.

The renderer now bootstraps only through `bootstrapDesktopGateway`. Missing
bridge/configuration/credentials fail closed to `CoreConnectionScreen` in
packaged, web, and development startup. `OperationsProvider` and `App` require
an injected gateway; no production renderer path imports or constructs
`MockOperationsGateway`. The sole mock bootstrap remains the existing
explicit test-only combination of `mode: 'test'`, `allowTestMock: true`, and
an injected `mockFactory`.

The CH Core-backed shell shows `OperationsSyncStatus` and replaces the stale
demo/session badges with `CH ULTIMATE / CH CORE`. Demo labels remain only for
explicit mock-backed tests/demo rendering. Feature pages were not redesigned.
CSS changes are scoped to the desktop connection screen and shell sync status.

Forge now builds `src/preload.ts` as `.vite/build/preload.js` and packages
`resources/ch-core-config.example.json` as an external resource. The example
contains only:

```json
{
  "endpoint": "https://<CH_CORE_IP_ADDRESS>:8443",
  "caFile": "<ABSOLUTE_PATH_TO_CH_CORE_CA_PEM>"
}
```

It contains no live IP, certificate, token, secret, or usable endpoint.

## TDD evidence

### Slice 1: actual preload bridge

RED:

```text
$ npm test -- tests/unit/electron-preload-surface.test.ts
FAIL tests/unit/electron-preload-surface.test.ts
Error: Failed to resolve import "../../src/preload"
Test Files  1 failed (1)
Tests       no tests
```

The failure was the intended missing production preload module.

GREEN after adding only the `contextBridge` adapter:

```text
$ npm test -- tests/unit/electron-preload-surface.test.ts
Test Files  1 passed (1)
Tests       5 passed (5)
```

### Slice 2: trusted-window IPC cleanup

RED:

```text
$ npm test -- tests/unit/electron-preload-surface.test.ts
FAIL CH Core main IPC registration > returns cleanup for the fixed handlers
TypeError: unregister is not a function
Test Files  1 failed (1)
Tests       1 failed | 5 passed (6)
```

GREEN after returning cleanup for exactly the six fixed channels:

```text
$ npm test -- tests/unit/electron-preload-surface.test.ts
Test Files  1 passed (1)
Tests       6 passed (6)
```

### Slice 3: Electron ready/window/service ordering

RED:

```text
$ npm test -- tests/unit/electron-main-startup.test.ts
FAIL Electron CH Core startup > waits for app readiness and binds IPC to the created window
AssertionError: expected "spy" to be called 1 times, but got 0 times
Test Files  1 failed (1)
Tests       1 failed (1)
```

GREEN after adding the preload path, post-ready credential/service creation,
exact userData config path, hardened web preferences, trusted sender
registration, and window-close cleanup:

```text
$ npm test -- tests/unit/electron-main-startup.test.ts tests/unit/electron-preload-surface.test.ts
Test Files  2 passed (2)
Tests       7 passed (7)
```

The asserted call order is `window`, `store`, `service`, `register`.

### Slice 4: required production gateway injection

RED:

```text
$ npm test -- tests/unit/app-shell.test.tsx
FAIL requires an explicitly injected operations gateway
AssertionError: expected [Function] to throw an error
Test Files  1 failed (1)
Tests       1 failed | 2 passed (3)
```

GREEN after removing the implicit provider mock:

```text
$ npm test -- tests/unit/app-shell.test.tsx
Test Files  1 passed (1)
Tests       3 passed (3)
```

All existing component tests that relied on the old default now inject
`MockOperationsGateway` explicitly.

### Slice 5: fail-closed normal renderer startup

RED:

```text
$ npm test -- tests/unit/desktop-renderer-startup.test.tsx
Error: OperationsGateway is required.
FAIL desktop renderer startup > fails closed to the connection screen when the preload bridge is absent
Unable to find role="heading" and name "Tidak terhubung"
Test Files  1 failed (1)
Tests       1 failed (1)
```

GREEN after wiring `bootstrapDesktopGateway`, connection rendering, retry
generation control, and Core gateway disposal:

```text
$ npm test -- tests/unit/desktop-renderer-startup.test.tsx
Test Files  1 passed (1)
Tests       1 passed (1)
```

The final clean focused rerun contained no React `act` warning.

### Slice 6: CH Core shell status without demo labels

RED:

```text
$ npm test -- tests/unit/app-shell.test.tsx tests/unit/desktop-renderer-startup.test.tsx
FAIL shows synchronization status without stale demo labels for CH Core
Unable to find an element with the text: Terhubung
Test Files  1 failed | 1 passed (2)
Tests       1 failed | 4 passed (5)
```

GREEN after the shell-only integration:

```text
$ npm test -- tests/unit/app-shell.test.tsx tests/unit/desktop-renderer-startup.test.tsx tests/unit/core-connection-ui.test.tsx
Test Files  3 passed (3)
Tests       15 passed (15)
```

### Focused integration gate

```text
$ npm test -- tests/unit/electron-preload-surface.test.ts tests/unit/electron-main-startup.test.ts tests/unit/electron-core-api-main.test.ts tests/unit/electron-core-https.test.ts tests/unit/electron-credential-store.test.ts tests/unit/electron-identity-main.test.ts tests/unit/electron-desktop-service.test.ts tests/unit/core-desktop-bootstrap.test.ts tests/unit/core-connection-ui.test.tsx tests/unit/desktop-renderer-startup.test.tsx tests/unit/app-shell.test.tsx
Test Files  11 passed (11)
Tests       47 passed (47)
```

This includes a paired production bridge initializing the real Core gateway
from a bootstrap response and reaching `online` revision `4`.

### Typecheck repair and GREEN

The first integration typecheck correctly caught three wiring issues:

```text
$ npm run typecheck
src/main.ts: TS7016 electron-squirrel-startup ambient declaration not visible
src/renderer/main.tsx: TS2339 Property 'env' does not exist on type 'ImportMeta'
tests/unit/nota-workspace.test.tsx: TS2322 optional mock gateway is not assignable
```

After the minimal declaration/test-helper corrections:

```text
$ npm run typecheck
> tsc --noEmit
exit 0
```

## Fresh final verification

Full unit suite:

```text
$ npm test
Test Files  49 passed (49)
Tests       344 passed (344)
exit 0
```

Typecheck:

```text
$ npm run typecheck
> tsc --noEmit
exit 0
```

Package:

```text
$ npm run package
✔ Building src/preload.ts target
✔ Building src/main.ts target
✔ Built target main_window
✔ Packaging for arm64 on darwin
✔ Packaging application
exit 0
```

Packaged artifact inspection:

```text
$ asar list ".../Contents/Resources/app.asar" | rg ...
/.vite/build/main.js
/.vite/build/preload.js
/.vite/renderer/main_window/index.html

$ find out -name 'ch-core-config.example.json' -print
out/CH Ultimate-darwin-arm64/CH Ultimate.app/Contents/Resources/ch-core-config.example.json
```

Built-file inspection confirmed:

- `preload.js` calls `contextBridge.exposeInMainWorld("chCore", ...)` and
  contains exactly the six fixed channel names.
- `main.js` contains `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, `preload.js`, `safeStorage`, the exact
  `ch-core-config.json` userData join, and window-bound IPC registration.
- `rg "MockOperationsGateway|CH Core API belum tersedia" .vite/build
  .vite/renderer/main_window` returned no matches.
- `rg "MockOperationsGateway" src/renderer src/main.ts src/preload.ts`
  returned no matches.
- The packaged example config contains placeholders only.
- `git diff --check` passed.

## Self-review and boundaries

- Every production change traces to the remaining Task 5 brief.
- `App.tsx` changes are limited to required injection and shell/status markup.
- `styles.css` changes are limited to connection/status selectors.
- The private CA path is still read only from validated local configuration.
- Credentials remain main-process-only and encrypted through `safeStorage`;
  no plaintext fallback was added.
- No live CH Core TLS endpoint, MariaDB service, packaged Windows build,
  physical desktop installation, or NAS connection is claimed by this work.
- No NAS was accessed or modified.
- `/Users/hamlet/Documents/CH Nota` was not accessed or modified.

No known Task 5 blocker remains at the local packaged-Electron boundary.

---

# Task 5 Fix Round 1/5: Desktop Boundary Hardening

## Status

The seven requested desktop security/startup findings are fixed at the local
Electron boundary. The endpoint parser now accepts only usable hosts in the
approved `192.168.1.0/24` subnet, persisted artifacts are read with explicit
size bounds, durable credential state and server-returned IDs are strictly
validated, IPC authorization includes the exact renderer URL, unexpected
navigation and window creation are denied, partial gateway startup is disposed
on failure, and the connection UI is actionable without echoing arbitrary
main/server errors.

The neutral default device name is `Perangkat Gudang`. The only detailed
credential error surfaced by the renderer is the known safe-storage-unavailable
message, either directly or inside Electron's exact fixed identity-channel
invoke wrapper. Other errors retain the generic Indonesian copy.

## RED/GREEN evidence

### Approved desktop subnet

RED: endpoint cases outside the approved subnet, including another private
subnet, public, loopback, link-local, multicast, CGNAT/Tailscale, and unusable
network/broadcast addresses, were accepted (`1 failed | 4 passed`).

GREEN: `parseCoreEndpointConfig` now accepts only
`192.168.1.1` through `192.168.1.254` on HTTPS port 8443
(`1 file, 5 passed`).

### Bounded local artifact reads

RED: oversized config/CA fixtures and an oversized encrypted credential
artifact were accepted; the credential artifact reached decryption.

GREEN: a shared file-handle reader rejects non-files, pre-existing oversized
files, and growth during the bounded read. Config is capped at 16 KiB; CA and
encrypted credential artifacts are capped at 256 KiB. The oversized credential
test also proves decryption is not called (`2 files, 9 passed` at this slice).

### Strict durable credentials and server IDs

RED: unknown fields, malformed UUIDs, impossible pending-state combinations,
and structurally plausible but noncanonical secrets were accepted. Separate
server-response tests accepted an empty pairing ID and a non-UUID device ID
(`2 failed | 4 passed` for the server-ID slice).

GREEN: Zod strict schemas now enforce exact state shape, valid UUIDs, valid
pending enrollment/pairing/rotation combinations, and canonical 32-byte
base64url persisted device, claim, recovery, and rotation secrets. Pairing and
device IDs are validated before persistence (`3 files, 17 passed`).

### Renderer-origin IPC and navigation boundary

RED: the trusted `webContents` could invoke CH Core handlers after its top
frame URL changed, and Electron startup supplied no expected renderer URL or
navigation/window denial (`2 failed | 6 passed`).

GREEN: every invoke now requires the intended sender, exact current top frame,
and exact normalized packaged or development renderer URL. Main denies
unexpected `will-navigate` destinations and all window-open requests
(`2 files, 8 passed`).

### Gateway initialization failure

RED: a rejected cache load escaped bootstrap with an active scheduler/resume
subscription, while an unexpected bootstrap rejection left the renderer on
`Menghubungkan` and produced an unhandled rejection (`2 failed | 5 passed`).

GREEN: bootstrap disposes a partially initialized Core gateway and returns
`CH Core tidak dapat dimulai. Coba lagi.`. The renderer also catches unexpected
rejections and renders an actionable fail-closed state (`2 files, 7 passed`).

### Connection UI error safety and neutral naming

RED: the form defaulted to `Mac Gudang`, hid the safe-storage enrollment cause,
and an intermediate broad fix echoed arbitrary secret-bearing process errors.
The negative error-safety run failed both the wrapped safe-storage mapping and
generic fallback assertions (`2 failed | 10 passed`).

GREEN: the form defaults to `Perangkat Gudang`; the known safe-storage message
is mapped through the exact identity-channel wrapper; arbitrary errors render
only `CH Core belum dapat dihubungkan. Coba lagi.` and the secret-leak
assertion remains negative (`2 files, 19 passed` with credential-store coverage).

## Fresh verification

```text
$ npm test -- <11 focused Task 5 files>
Test Files  11 passed (11)
Tests       58 passed (58)

$ npm test
Test Files  49 passed (49)
Tests       355 passed (355)

$ npm run typecheck
> tsc --noEmit
exit 0

$ npm run package
✔ Building src/preload.ts target
✔ Building src/main.ts target
✔ Built target main_window
✔ Packaging for arm64 on darwin
✔ Packaging application
exit 0

$ git diff --check
exit 0
```

Packaged artifact inspection found the placeholder-only
`ch-core-config.example.json` in the app resources and the production bundles
contain the bounded reader, approved-subnet check, normalized renderer URL,
navigation/window denial, and neutral device copy.

No NAS or live CH Core endpoint was contacted. `/Users/hamlet/Documents/CH Nota`
was not accessed or modified. No production NAS, physical-device, or live TLS
claim is made.
