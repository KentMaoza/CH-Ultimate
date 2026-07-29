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
