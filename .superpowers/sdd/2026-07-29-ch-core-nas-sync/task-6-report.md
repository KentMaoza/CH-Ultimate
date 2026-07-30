# Task 6 Report: Secure Android Transport and Mobile Connection UI

## Status

`DONE_WITH_CONCERNS`

The Android transport, native credential boundary, native-only CH Core
bootstrap, connection/pairing screen, and synchronization status are
implemented. The checked-in app deliberately has no production endpoint or
private CA: it fails closed until Task 11 supplies the reserved deployment
resources.

## Scope and behavior

- `CoreApiPlugin` exposes only `request`, `credentialStatus`,
  `claimPairing`, `completePairing`, and `rotateToken`.
- JavaScript sends only the existing `CoreApiRequest` shape with an approved
  method, relative route, optional body, and optional idempotency key. It
  cannot provide an origin, endpoint, certificate, authorization header, or
  token.
- Native code owns the endpoint and private CA resource lookup, creates an
  explicit TLS context from that CA only, retains normal hostname
  verification, injects authorization internally, and rejects cleartext,
  redirects, oversized bodies, non-JSON responses, absolute routes,
  traversal, and routes outside the shared operation allowlist.
- Device and pending identity state is encrypted with an Android Keystore
  AES-GCM key before storage in app-private preferences. An unavailable or
  unusable Keystore fails closed without plaintext fallback.
- The manifest sets `android:allowBackup="false"` and
  `android:usesCleartextTraffic="false"`. Android 12+ data-extraction rules
  exclude every app-data domain from cloud backup and device transfer.
- Native startup checks credential/configuration status before constructing
  the synchronized gateway and never invokes the demo gateway factory.
  Browser startup remains an explicit mock demo and is visibly labelled
  `Demo lokal`.
- The existing mobile feature screens were not redesigned. Only root startup,
  full-screen connection/pairing state, and the scoped synchronization status
  were added.
- No backend, database, NAS access, production printing, or live endpoint was
  added.

## Deployment convention

Task 11 must add both of these release resources:

- `android/app/src/main/res/values/ch_core_config.xml` containing the reserved
  string `ch_core_endpoint`.
- `android/app/src/main/res/raw/ch_core_ca.pem` containing the production
  private CA public certificate as resource `ch_core_ca`.

If either resource is absent, the plugin returns a public `missing`
configuration state and performs no network request. No development CA,
placeholder IP, system-trust fallback, certificate bypass, or test endpoint is
committed.

## TDD evidence

### TypeScript adapter and native bootstrap RED

```text
npm test -- --run tests/unit/mobile-core-api-adapter.test.ts
Test Files  1 failed (1)
Tests       6 failed (6)
```

All six tests failed on the intentional unimplemented adapter/bootstrap
errors. After the minimum bridge and bootstrap implementation:

```text
Test Files  1 passed (1)
Tests       6 passed (6)
```

### Connection and status UI RED

```text
npm test -- --run tests/unit/mobile-core-connection-ui.test.tsx
Test Files  1 failed (1)
Tests       11 failed (11)
```

The null component stubs could not render any required state. After the
full-screen connection screen and root status implementation:

```text
Test Files  1 passed (1)
Tests       11 passed (11)
```

### Platform bootstrap RED

```text
npm test -- --run tests/unit/mobile-bootstrap.test.ts
Tests       1 failed | 1 passed (2)
TypeError: createMobileRuntime is not a function
```

After centralizing native bridge selection in the existing mobile bootstrap:

```text
Test Files  1 passed (1)
Tests       2 passed (2)
```

### JVM security boundary RED

With JDK 21 and the Android SDK configured:

```text
./gradlew testDebugUnitTest \
  --tests com.tokoch.chucompanion.CoreSecurityBoundaryTest
Tests run: 4, Failures: 4
```

The four intentional failures covered HTTPS-only endpoint policy, the
operation path allowlist, Keystore-unavailable failure, and token/endpoint
non-exposure. After the native security implementation:

```text
Tests run: 4, Failures: 0
BUILD SUCCESSFUL
```

## Fresh verification

The final Android commands used:

```text
JAVA_HOME=/Applications/Android Studio.app/Contents/jbr/Contents/Home
ANDROID_HOME=/Users/hamlet/Library/Android/sdk
```

| Gate | Result |
| --- | --- |
| `npm run test:mobile` | PASS — 9 files, 82 tests |
| `npm run mobile:build` | PASS — 587 modules |
| `npm run typecheck` | PASS |
| `npm run android:sync` | PASS — 5 Capacitor plugins |
| `npm run android:test` | PASS — 5 app tests in debug and 5 in release |
| `npm run android:lint` | PASS — 0 errors |
| `git diff --check` | PASS |

The mobile build retains the pre-existing Vite CJS deprecation and large-chunk
warnings. Android lint retains two intentional `getIdentifier` warnings
because the production endpoint/CA resources must not exist before Task 11,
plus existing/generated Gradle, resource, launcher, and splash warnings.

## Files changed

- `mobile/core-api-native.ts`
- `mobile/core-api-bootstrap.ts`
- `mobile/bootstrap.ts`
- `mobile/main.tsx`
- `mobile/MobileApp.tsx` (root/status only)
- `mobile/components/CoreConnectionScreen.tsx`
- `mobile/components/OperationsSyncStatus.tsx`
- `mobile/styles.css` (scoped append only)
- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/java/com/tokoch/chucompanion/MainActivity.java`
- Android transport, endpoint/request policy, identity, credential, and
  Keystore classes under
  `android/app/src/main/java/com/tokoch/chucompanion/`
- `android/app/src/main/res/xml/network_security_config.xml`
- `android/app/src/main/res/xml/data_extraction_rules.xml`
- `tests/unit/mobile-bootstrap.test.ts`
- `tests/unit/mobile-core-api-adapter.test.ts`
- `tests/unit/mobile-core-connection-ui.test.tsx`
- `android/app/src/test/java/com/tokoch/chucompanion/CoreSecurityBoundaryTest.java`
- `package.json`

## Self-review

- Native startup receives a demo factory only as an inert dependency; focused
  tests prove it is never invoked for missing, unpaired, or paired native
  states.
- Public native status includes only configuration/credential state and public
  device or pairing IDs. Focused TypeScript and JVM tests prove unexpected
  endpoint/token fields do not cross the bridge.
- The Android request policy matches the Electron transport allowlist,
  including the canonical changes query and strict UUID routes. Pairing and
  token-rotation routes remain native-only identity methods and cannot be
  called through generic JavaScript requests.
- The TLS client has no certificate bypass or system-trust fallback. With
  deployment resources absent, configuration loading returns before any
  network client can be created.
- An initial full mobile run found an ARIA status-role collision with existing
  screens; the synchronization badge retained its visible state without
  claiming the page-wide status role. An initial lint run found an API-33-only
  URL-decoder overload; it was replaced with the API-26-compatible overload.

## Concerns

No live CH Core TLS connection or physical-device Keystore flow can be claimed
until Task 11 supplies the real private CA and reserved endpoint. The build,
JVM boundary, TypeScript bridge, browser demo boundary, and fail-closed missing
configuration behavior are verified locally. No NAS was accessed.

---

## Fix Round 1: Reject HTTPS redirects

The native HTTPS client now disables automatic redirect following immediately
after opening each connection. It also rejects every HTTP status from 300
through 399 before selecting or reading a response stream. Consequently, a
CH Core response cannot cause `HttpsURLConnection` to issue a second request
whose route or origin bypassed the native allowlist.

Only these implementation artifacts changed:

- `android/app/src/main/java/com/tokoch/chucompanion/CoreApiClient.java`
- `android/app/src/test/java/com/tokoch/chucompanion/CoreApiRedirectPolicyTest.java`

### Focused RED

Command against commit `8d871b5` after adding the regression test:

```sh
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' \
ANDROID_HOME='/Users/hamlet/Library/Android/sdk' \
./gradlew testDebugUnitTest \
  --tests com.tokoch.chucompanion.CoreApiRedirectPolicyTest
```

Expected result:

```text
CoreApiRedirectPolicyTest.java:21: error: cannot find symbol
CoreApiClient.disableRedirects(connection);
CoreApiRedirectPolicyTest.java:28: error: cannot find symbol
CoreApiClient.requireNonRedirectStatus(redirectStatus)
4 errors
BUILD FAILED
```

This proved the current client had neither the per-connection redirect disable
step nor the explicit 3xx rejection policy.

### Focused GREEN

The same focused command after the minimal implementation:

```text
CoreApiRedirectPolicyTest: 1 test, 0 failures, 0 errors
BUILD SUCCESSFUL in 1s
135 actionable tasks: 5 executed, 130 up-to-date
```

The test starts with a fake `HttpsURLConnection` whose instance redirect
setting is enabled, proves the client disables it, rejects every status in the
inclusive 300–399 range, and continues to accept adjacent non-redirect
statuses 299 and 400.

### Amended-code verification

Environment:

```text
JAVA_HOME=/Applications/Android Studio.app/Contents/jbr/Contents/Home
ANDROID_HOME=/Users/hamlet/Library/Android/sdk
```

| Command | Result |
| --- | --- |
| `npm run android:test` | PASS — 6 app tests in debug and 6 in release; `BUILD SUCCESSFUL in 8s`; 270 tasks |
| `npm run android:lint` | PASS — 0 errors; `BUILD SUCCESSFUL in 4s`; 316 tasks |
| `git diff --check` | PASS — no output |

No TypeScript, mobile renderer, manifest, resource, dependency, or deployment
configuration changed, so the unrelated mobile build/typecheck/sync gates were
not rerun.

### Fix self-review

- Redirect following is disabled before TLS socket configuration, headers,
  request bodies, or response-code access.
- Every 3xx status is rejected before either `getInputStream()` or
  `getErrorStream()` can consume a redirect response.
- The existing endpoint, private-CA, hostname-verification, request allowlist,
  authentication, timeout, body-size, and JSON boundaries are unchanged.
- The regression uses only a local fake connection; it adds no endpoint,
  certificate, network access, or production credential.
- Task 11 remains responsible for the real endpoint/private CA and live TLS
  verification. No NAS was accessed.
