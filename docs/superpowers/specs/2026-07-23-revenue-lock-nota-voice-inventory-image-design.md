# CH Ultimate Revenue Lock, Nota Voice, and Inventory Image Design

## Scope

This revision remains frontend-only and session-only. It changes the Nota voice
sequence, adds a renderer-only access guard around Laporan Omzet, and lets an
operator replace warehouse SKU images from a local file. It does not add
persistence, encryption claims, a backend, network storage, or database fields.

## Nota Voice

Nota speech no longer requires Nama Barang. A row is eligible when its row code,
quantity, active unit, and active unit price are valid. Quantity remains limited
to 1–48 and price remains limited to 1–1,000,000.

The sequence becomes row code, quantity/unit, `harga`, and the compositional
price clips. The trailing `rupiah` clip is not resolved or played. The existing
`rupiah.ogg` asset stays in the offline pack so this surgical behavior change
does not rewrite the large checksum manifest.

## Laporan Omzet Access

A small renderer context owns the password and unlock state:

- No password is configured after reload.
- Laporan Omzet shows a locked setup notice and never renders its metrics until
  a password has been configured in Settings and entered correctly.
- Settings accepts a non-empty new password plus confirmation.
- Once configured, changing the password requires the current password.
- Saving or changing the password locks Laporan Omzet.
- A successful unlock remains valid while navigating during the current session.
- Reload clears the password and unlock state with all other demo state.

The password is held as plain renderer memory because this is explicitly a
session-only frontend demo. The UI must call it a session access guard, not
production security.

## SKU Gudang Images

Every warehouse thumbnail, including the CHU placeholder, becomes a button.
Clicking it opens one hidden `image/*` file input. The selected file is converted
to a data URL and sent through the existing `OperationsGateway.updateSku`
operation. Nothing is written to disk.

Hovering or keyboard-focusing the thumbnail shows a fixed large preview. The
fixed preview avoids clipping inside the scrollable table. Broken images still
fall back to CHU, and a new image resets the prior failure state.

## Verification

- Voice resolver and UI tests prove unnamed rows speak and no `rupiah` clip is
  played.
- Revenue tests prove setup, wrong-password rejection, unlock persistence,
  password-change authorization, relock, and hidden metrics while locked.
- Inventory tests prove placeholder and existing images are clickable, a local
  file updates only the target SKU in memory, and hover/focus preview markup is
  present.
- Run focused tests after every slice, then `npm run verify`,
  `npm run test:e2e`, `npm run package`, and `git diff --check`.
