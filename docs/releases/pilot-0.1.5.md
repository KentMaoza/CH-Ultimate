# CH Ultimate pilot v0.1.5

This LAN pilot stabilizes the real CH Core client on Android and
Windows. It fixes the Android white screen after pairing, keeps rapid Nota
typing responsive while writes synchronize, and shows a recovery screen if a
client render fails. The CH Core service and MariaDB data on the NAS are not
changed by this client release.

It remains a copied-data pilot, not the sole production record or a completed
backup-and-restore boundary.

## Download

Open the `KentMaoza/CH-Ultimate` GitHub Releases page and download:

- Windows: `CH-Ultimate-0.1.5-Setup.exe`
- Android: `CHU-Companion-Mobile-0.1.5-release.apk`
- Verification: `SHA256SUMS.txt`

All clients connect only to `https://192.168.50.14:8443` while on the business
LAN. They do not use QuickConnect, Tailscale, or a public Internet API.

## Upgrade

- Windows can install v0.1.5 over v0.1.4 without deleting application data.
- The currently installed Android v0.1.4 used a different debug signer. It must
  be uninstalled once before installing this permanently signed v0.1.5 build.
- That one Android uninstall removes only the phone's local pairing credential
  and cache. Shared CH Core data stays on the NAS.
- Pair Android again with a fresh one-use 8-digit code from the owner Windows
  app. Future Android builds signed with the same permanent key can update in
  place.

## Fixed in this build

- Stable snapshots prevent the React maximum-update-depth white screen.
- A visible Indonesian recovery screen replaces a permanently blank client.
- Rapid header and line edits are rebased after earlier acknowledgements.
- Desktop and phone Nota fields remain editable during network saves.
- Rejected mobile mutations are shown as alerts instead of becoming unhandled
  promise failures.

## Pilot boundary

- Never share the owner bootstrap code, device token, recovery credential,
  Android signing secrets, or database password.
- Android is signed with the permanent CH Ultimate pilot key. Windows is not
  Authenticode-signed.
- No automatic client updates are included.
- Physical pairing, synchronized-edit timing, restart persistence, backup and
  restore, and the seven-client soak remain separate acceptance gates until
  their results are recorded.
