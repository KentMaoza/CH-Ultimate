# CH Ultimate pilot v0.1.2

This private prerelease moves the copied-data pilot clients to the CH Business
LAN endpoint. It is not a production-signed release or a disaster-recovery
boundary. The v0.1.0 and v0.1.1 pilot installers are superseded; their
historical release notes remain unchanged.

## Download

Sign in to the private `KentMaoza/CH-Ultimate` GitHub repository and open this
release. Download only the file for the device:

- Windows: `CH-Ultimate-0.1.2-Setup.exe`
- Android: `CHU-Companion-Mobile-0.1.2-pilot-debug.apk`
- Verification: `SHA256SUMS.txt`

Before installing or pairing, connect the laptop or phone to the
`CH-Business` Wi-Fi. These clients connect only to CH Core at
`https://192.168.50.14:8443`; they do not use the Internet, QuickConnect,
or Tailscale.

## Windows installation

1. Download the Windows installer from this private release.
2. Open it. Because this pilot has no Authenticode certificate, Windows may
   show an unknown-publisher warning. Choose **More info**, then **Run anyway**
   only after confirming the filename above.
3. Launch CH Ultimate. Its first status must be configured but unpaired; it
   must never silently open demo data.
4. Pair the installation using an owner-approved CH Core pairing code.

## Android installation

1. Download the pilot APK from this private release.
2. Android may ask for temporary permission for the browser or Files app to
   install unknown apps. Enable it only for this installation and disable it
   again afterward.
3. Install and launch CHU Companion Mobile. Its first status must be configured
   but unpaired; it must never silently open demo data.
4. Pair the installation using an owner-approved CH Core pairing code.

This pilot APK uses Android's debug signature. A later build produced by a
different runner may have a different debug signature; Android would then
require uninstalling this pilot before installing that later build. Uninstall
only after pending offline work is synchronized.

## Pilot boundary

- No automatic client updates are included.
- If `CH-Business` or the fixed CH Core endpoint is unavailable, the clients
  fail closed until a compatible build and trusted endpoint are available.
- Physical Windows/Android installation, synchronization, and the soak test
  remain required before broader rollout.
