# GitHub pilot release design

## Objective

Publish CH Ultimate source to a private GitHub repository and provide one
download page containing installable pilot artifacts for Windows and Android.
Every artifact must be built from the committed source and must pass the
relevant automated gates before publication.

This is a copied-data pilot distribution. It does not make CH Core the sole
production record or satisfy the remaining backup, restore, SMART, UPS,
stable-IP, soak, or physical-client gates.

## Considered approaches

### Recommended: private repository, GitHub Actions, GitHub Release

GitHub Actions builds a Windows Squirrel installer on Windows and an Android
debug APK on Linux. A release job publishes only artifacts produced by passing
jobs, plus SHA-256 checksums and installation notes. This is reproducible,
keeps binaries out of Git history, and gives both device types one download
location.

### Manual local build and manual Release upload

This avoids CI configuration, but the Windows installer cannot be reliably
built or tested from the current Mac environment. It also makes it easier for
source and binaries to drift. This approach is rejected.

### Commit installers directly to the repository

This is simple to download but bloats Git history, weakens provenance, and
makes it easy to distribute stale binaries. This approach is rejected.

## Repository and release model

- Create private repository `KentMaoza/CH-Ultimate` using the already
  authenticated `KentMaoza` GitHub account.
- Push the existing `codex/ch-core-nas-sync` history without rewriting it.
- Keep the current feature branch and open a draft pull request to the remote
  default branch after the release workflow is committed and verified.
- Build pilot artifacts through a manually dispatched GitHub Actions workflow.
  Do not publish automatically on every push.
- Publish one prerelease named `CH Ultimate Pilot 0.1.0` only after all required
  jobs succeed.

The repository is private because it contains business application source.
Users must sign in to the authorized GitHub account before downloading private
release assets.

## Client deployment configuration

Both clients use the fixed pilot endpoint:

`https://192.168.1.14:8443`

The public CH Core CA certificate is safe to distribute and is committed as a
client trust asset. The CA signing key, NAS leaf private key, MariaDB password,
device credentials, recovery credential, and user data are never committed or
uploaded to GitHub.

### Windows

The packaged app includes the fixed endpoint and public CA as Electron resource
files. On first packaged launch, the main process seeds a bounded deployment
configuration into Electron's user-data directory without exposing it to the
renderer. Existing device configuration and credentials are never silently
overwritten. Network requests continue through the narrow main-process HTTPS
transport and Electron `safeStorage`.

GitHub's Windows runner uses Electron Forge to build the Squirrel installer.
The pilot installer is not Authenticode-signed, so Windows may show an unknown
publisher or SmartScreen warning. That limitation is documented; bypassing TLS
validation is not permitted.

### Android

The Android package receives the fixed endpoint as a string resource and the
public CA as a raw resource. The native plugin continues to build its own TLS
context from that CA and keeps device tokens in Android Keystore.

The pilot uses a debug APK, which Android signs automatically with the workflow
runner's debug key. This requires enabling installation from the browser or
Files app. It is not a production-signed release. A future APK built in a new
workflow run may require uninstalling the old pilot because the ephemeral debug
signature can change; creating a persistent production signing identity remains
out of scope unless the owner later authorizes it.

## GitHub Actions gates

The workflow has four bounded jobs:

1. `source-gates` on Ubuntu runs dependency installation, tracked-secret and
   private-key scans, `npm run verify`, mobile tests/build, server tests and
   typecheck, Electron E2E, and patch hygiene.
2. `windows-installer` depends on `source-gates`, builds the Windows x64
   Squirrel installer on a Windows runner, records its checksum, and uploads a
   workflow artifact.
3. `android-apk` depends on `source-gates`, uses JDK 21, runs Android sync,
   unit tests, and lint, builds the debug APK, records its checksum, and uploads
   a workflow artifact.
4. `publish-prerelease` depends on both platform jobs and publishes the assets
   only for an explicitly requested manual prerelease run.

The exact `/chu_test` MariaDB integration suite remains a separate guarded gate
because GitHub has no approved MariaDB fixture or production credential. It is
not silently pointed at the NAS. NAS health, LAN isolation, and physical-device
tests remain acceptance steps outside GitHub Actions.

## Artifact names and installation notes

The prerelease contains:

- `CH-Ultimate-0.1.0-Setup.exe`
- `CHU-Companion-Mobile-0.1.0-pilot-debug.apk`
- `SHA256SUMS.txt`
- release notes describing same-Wi-Fi requirements, private GitHub sign-in,
  Windows publisher warnings, Android unknown-source permission, pairing, and
  the copied-data-only boundary.

## Verification and failure behavior

- A packaged Windows app and Android APK must report CH Core configured and
  unpaired before enrollment; they must never fall back to mock data.
- Correct private-CA validation must succeed against
  `192.168.1.14:8443`; missing or wrong trust must fail closed.
- GitHub publication is impossible unless source and both platform jobs pass.
- Release assets are checked against `SHA256SUMS.txt` after download.
- One Windows laptop and one Android phone are installed and paired before any
  remaining devices are enrolled.
- No claim of production readiness is made until the separate NAS acceptance
  ledger passes every remaining gate.

## Out of scope

- Public repository or public release assets
- Automatic application updates
- Authenticode code signing
- Permanent Android production signing
- Remote or Internet access to CH Core
- Changing the accepted DHCP pilot risk or remaining production gates
