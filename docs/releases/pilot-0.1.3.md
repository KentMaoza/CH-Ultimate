# CH Ultimate pilot v0.1.3

This private prerelease adds an explicit owner-approved device-pairing flow to
the copied-data CH Business LAN pilot. Install it only after the compatible CH
Core service has been upgraded on the NAS. It is not a production-signed
release or a disaster-recovery boundary.

## Download

Sign in to the private `KentMaoza/CH-Ultimate` GitHub repository and download
only the file for the device:

- Windows: `CH-Ultimate-0.1.3-Setup.exe`
- Android: `CHU-Companion-Mobile-0.1.3-pilot-debug.apk`
- Verification: `SHA256SUMS.txt`

Connect every device to `CH-Business` Wi-Fi before opening the app. These
clients use only `https://192.168.50.14:8443`; they do not use QuickConnect,
Tailscale, or an Internet API.

## Set up the first Windows owner

Use the first Windows laptop as the only owner/admin device:

1. Install and open CH Ultimate. Confirm it does not silently open demo data.
2. Under **Siapkan pemilik pertama**, enter the private owner bootstrap code
   supplied by the administrator and choose a recognizable **Nama perangkat**.
3. Select **Siapkan pemilik**. Do this bootstrap exactly once. Do not enter the
   bootstrap code on phones or the second laptop.
4. Open **Settings**, find **PEMASANGAN PERANGKAT**, and select
   **Buat kode pemasangan**.

The generated 8-digit code is one-use and expires after 10 menit. Generate a
separate code for every client.

## Pair an Android phone or another Windows laptop

1. Install and open the v0.1.3 client on the device.
2. Enter any recognizable **Nama perangkat**. This is only a label, for
   example `HP Gudang Kent` or `Laptop Kasir 2`.
3. Enter the current **Kode pemasangan 8 angka**, then select **Pasangkan**.
4. On the owner laptop, select **Periksa permintaan**. Confirm both the claimed
   nama perangkat and platform (`android` or `windows`) belong to the device in
   front of you. Reject the flow by letting the code expire if either is wrong.
5. Only after that check, select **Setujui perangkat** on the owner laptop.
6. On the client, select **Periksa persetujuan**. Wait until the shared CH Core
   data opens; do not re-enter the code or create a second installation.
7. Make satu perubahan kecil on one device and confirm it appears on the other
   foreground device within three seconds. Keep this as copied-data pilot
   evidence; do not treat it as production acceptance.

An existing v0.1.2 debug APK may require uninstall before v0.1.3 because GitHub
debug signers can differ between runs. The current phone is belum dipasangkan,
so tidak ada shared data or offline work to preserve before that uninstall.
Once a phone contains paired or pending offline work, synchronize it before
uninstalling any future build.

## Pilot boundary

- Codes, device names, and approval status are not passwords. Never share the
  private owner bootstrap code, device token, recovery credential, or database
  password.
- The server upgrade, physical Windows/Android installation, owner bootstrap,
  pairing, synchronized edit, restart persistence, and soak evidence remain
  incomplete until performed and recorded on the real devices.
- The Android APK uses a debug signature and the Windows installer has no
  Authenticode certificate. Neither is a production-signed release.
- No automatic client updates are included.
