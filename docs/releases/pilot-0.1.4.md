# CH Ultimate pilot v0.1.4

This private prerelease fixes the blank Windows screen that appeared immediately
after the first owner was successfully enrolled. The CH Core service and
MariaDB data on the NAS do not need to be changed for this client hotfix.

It remains a copied-data LAN pilot, not a production-signed release or a
disaster-recovery boundary.

## Download

Sign in to the private `KentMaoza/CH-Ultimate` GitHub repository and download:

- Windows: `CH-Ultimate-0.1.4-Setup.exe`
- Android: `CHU-Companion-Mobile-0.1.4-pilot-debug.apk`
- Verification: `SHA256SUMS.txt`

All clients connect only to `https://192.168.50.14:8443` while on the business
LAN. They do not use QuickConnect, Tailscale, or a public Internet API.

## Repair an already-enrolled Windows owner

1. Close the blank CH Ultimate window.
2. Run `CH-Ultimate-0.1.4-Setup.exe` without deleting application data.
3. Open CH Ultimate. The existing encrypted owner credential should open the
   shared CH Core application directly.
4. Do not enter the private owner bootstrap code again.
5. Open **Settings**, find **PEMASANGAN PERANGKAT**, and select
   **Buat kode pemasangan**.

The generated 8-digit code is one-use and expires after 10 minutes.

## Pair the Android phone

The existing v0.1.3 Android pilot remains protocol-compatible with this fix; it
does not need to be reinstalled just to pair with the repaired Windows owner.

1. Enter any recognizable **Nama perangkat** on the phone.
2. Enter the active **Kode pemasangan 8 angka**, then select **Pasangkan**.
3. On Windows, select **Periksa permintaan** and verify the name and platform.
4. Select **Setujui perangkat** on Windows.
5. On Android, select **Periksa persetujuan**.
6. Make one small shared edit and verify it appears on the other foreground
   device within three seconds.

## Pilot boundary

- Never share the owner bootstrap code, device token, recovery credential, or
  database password.
- The Android APK uses a debug signature and the Windows installer has no
  Authenticode certificate.
- No automatic client updates are included.
- Physical pairing, synchronized-edit timing, restart persistence, backup and
  restore, and the seven-client soak remain separate acceptance gates.
