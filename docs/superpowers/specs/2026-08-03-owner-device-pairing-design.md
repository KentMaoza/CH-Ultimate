# CH Core owner device-pairing design

Date: 2026-08-03 WITA

## Purpose

Make the existing CH Core pairing protocol usable from the installed Windows
owner application. The first Windows laptop is the sole owner/admin device.
The second Windows laptop and every Android phone are normal client devices.

`Nama perangkat` is a user-chosen installation label, such as `HP Kent` or
`Laptop Kasir 1`. It is trimmed, must contain 1-160 characters, and must not be
treated as a login, password, or human identity.

## User flow

1. Install the Windows pilot on the first laptop and use the existing owner
   bootstrap form once.
2. In **Pengaturan**, the paired owner selects **Buat kode pemasangan**.
3. Windows displays a one-use eight-digit code and its ten-minute expiry.
4. The client enters its chosen device name and that code, then selects
   **Pasangkan**.
5. The client displays **Menunggu persetujuan** and its pairing request ID.
6. The owner selects **Periksa permintaan**. Windows shows the claimed device
   name and platform from CH Core.
7. The owner visually confirms the intended physical device and selects
   **Setujui perangkat**.
8. The client selects **Periksa persetujuan**, receives its device credential,
   and opens the shared application data.

If the request has not yet been claimed, Windows says so without approving it.
Expired, consumed, malformed, unauthorized, or already-approved requests fail
closed. Reloading the owner screen may abandon the displayed request; the owner
creates a new code and the old request expires naturally.

## Server boundary

The existing owner-authenticated routes remain authoritative:

- `POST /v1/pairings` creates the one-use code.
- `POST /v1/pairings/:id/approve` approves a claimed request.

Add one narrow owner-authenticated route:

- `GET /v1/pairings/:id` returns a public status projection for the pairing
  created by the owner.

The projection contains only:

- pairing ID;
- state: `available`, `pending`, `approved`, `consumed`, or `expired`;
- expiry time;
- requested device name and platform only after a successful claim.

It never returns the code hash, claim hash/secret, installation ID, device
token, recovery credential, or database values. CH Core checks that the caller
is the active owner for create, inspect, and approve operations. Approval still
uses the existing transactional checks and audit/change events.

## Windows security boundary

Extend the narrow Electron bridge with three owner methods:

- `createOwnerPairing()`;
- `getOwnerPairing(pairingId)`;
- `approveOwnerPairing(pairingId)`.

The Electron main process reads the encrypted current device token and sends
the authenticated HTTPS requests through the pinned CH Core endpoint and
bundled private CA. The preload exposes only validated arguments and public
response fields. The bearer token and credential-store contents never enter
renderer JavaScript.

The IPC layer accepts no arbitrary path, method, header, origin, token, or
extra object key. Pairing IDs must be canonical UUIDs. Invalid server response
shapes fail closed with Indonesian user-facing copy.

## Windows interface

Add a focused `OwnerPairingCard` to the existing **Pengaturan** page when the
application is CH Core-backed. Keep it separate from the current small settings
component.

The card has these states:

- idle: explanation and **Buat kode pemasangan**;
- available: code, expiry, and **Periksa permintaan**;
- pending: claimed device name/platform plus **Setujui perangkat**;
- approved: instruction for the client to select **Periksa persetujuan**;
- expired/consumed/error: explicit status and a safe way to create a new code.

The card does not add device revocation, multiple pending requests, owner
transfer, pairing history, QR codes, or automatic approval. A non-owner server
response shows that pairing management is owner-only and exposes no details.

## Android behavior

The Android form and Keystore credential flow remain unchanged. The device name
continues to be any descriptive installation label within the existing length
rule. The eight-digit field accepts only a current owner-generated code; Wi-Fi,
router, NAS, DSM, and MariaDB passwords are never valid pairing inputs.

## Testing and acceptance

Develop every behavior test-first in bounded slices:

1. Server service and HTTP tests prove owner-only public status inspection,
   state transitions, response redaction, expiry, and malformed/not-found
   rejection.
2. Electron main/IPC/preload tests prove authenticated fixed-route requests,
   strict UUID/input validation, response validation, and token non-exposure.
3. Renderer tests prove code display, claim inspection, device confirmation,
   approval, owner-only/error copy, and no approval before a pending claim.
4. Existing desktop, mobile, server, Electron package, end-to-end, Android, and
   source-hygiene gates remain green.
5. Publish a new private pilot version rather than replacing `pilot-v0.1.2`.
   Independently download and verify the Windows installer, Android APK, and
   checksum manifest before asking the user to install them.

Physical acceptance uses one owner Windows laptop and one Android phone on the
CH Business LAN. It must demonstrate the exact eight-step flow above and one
small synchronized edit before broader enrollment. This feature does not close
the separate backup/restore, restart, external-isolation, permanent Android
signing, or soak gates.
