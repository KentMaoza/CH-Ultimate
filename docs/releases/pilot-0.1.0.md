# CH Ultimate pilot v0.1.0

This private prerelease contains the copied-data pilot installers for CH
Ultimate. It is not yet the sole production record.

## Download

Sign in to the private `KentMaoza/CH-Ultimate` GitHub repository and open this
release. Download only the file for the device:

- Windows: `CH-Ultimate-0.1.0-Setup.exe`
- Android: `CHU-Companion-Mobile-0.1.0-pilot-debug.apk`
- Verification: `SHA256SUMS.txt`

The laptop or phone must be connected to the same business Wi-Fi as CH Core at
`192.168.1.14`. The app does not connect to CH Core through the Internet,
QuickConnect, or Tailscale.

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
   but unpaired.
4. Pair the installation using an owner-approved CH Core pairing code.

This pilot APK uses Android's debug signature. A later build produced by a
different runner may have a different debug signature; Android would then
require uninstalling this pilot before installing that later build. Uninstall
only after pending offline work is synchronized.

## Pilot boundary

- Keep the original business record available during the pilot.
- No automatic client updates are included.
- If the NAS address changes from `192.168.1.14`, these installers fail closed
  until a new build is published for the new address.
- Production rollout still requires the documented backup/restore, device,
  soak, and operational acceptance gates.
