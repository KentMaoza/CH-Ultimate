# CH Ultimate Share Rotation and Nota Price Voice Design

## Scope

This revision remains frontend-only and session-only. It changes only the deterministic share recommendation selector, its explanatory UI, Nota voice commit behavior, and bundled offline Piper clips. It does not add persistence, networking, a backend, or a runtime TTS model.

## Share Recommendation Rotation

Every active SKU with positive stock and a creation date on or before the selected WITA date remains eligible. The daily list still contains at most 300 unique SKU, but it is built by interleaving three queues:

1. SKU with a recorded reference-price change, newest change first.
2. SKU with a positive manual stock adjustment, newest restock first.
3. All eligible SKU ordered by oldest sale or creation movement.

Each queue is internally arranged with a deterministic round-robin across supplier codes extracted from the final `CH` suffix. The selected WITA date rotates the starting supplier so consecutive dates do not always begin with the same code. The three queues are consumed in price/restock/idle order, duplicates are skipped, and exhausted slots are filled from the remaining eligible SKU.

Each daily row exposes why it entered the rotation: `Harga diperbarui`, `Restock`, or `Stok lama`. A SKU can show more than one reason. The separate urgent list keeps its existing definition: its last sale or creation movement is more than eight calendar months old.

## Nota Voice Behavior

The approved price is the active unit price:

- PCS selected: use `pcsPrice`.
- LSN selected: use `lsnPrice`.
- The line total is not read.

Speech is committed when either the quantity or the active price loses focus after a real value change, but only when name, quantity, unit, and active price are all valid. This produces one phrase such as: “Satu A, empat picis, harga tiga puluh dua ribu rupiah.”

This means:

- Quantity entered before price stays silent until the price is committed.
- Quantity entered after an SKU supplied a valid price is read immediately.
- Revising quantity reads the complete phrase again.
- Revising the active price reads the complete phrase again.
- Revising the inactive unit price stays silent.
- Unit toggles, SKU selection, row deletion, archive preview, invalid input, quantity outside 1–48, and price outside 1–1,000,000 stay silent.

The newest speech request cancels the previous sequence exactly as it does now.

## Offline Price Clips

Piper remains generation-only. The app will not bundle Piper, Python, ONNX, or a network client.

To cover every integer price without one million files, the bundle adds:

- Full Indonesian number clips for `1–999`.
- Connector clips for `harga`, `seribu`, `ribu`, `satu juta`, and `rupiah`.

Prices are decomposed into at most two full number chunks plus connectors. For example, `845321` resolves to `845`, `ribu`, `321`, then `rupiah`. The resulting player sequence is row code, quantity/unit, `harga`, price chunks, and `rupiah`.

The manifest pins Piper 1.4.2 and the existing `id_ID-news_tts-medium` revision, records every prompt and SHA-256 checksum, and keeps the existing provenance warning.

## Verification

- Unit tests prove mixed recommendation sources, supplier round-robin, deterministic date rotation, uniqueness, 300 cap, and unchanged urgent behavior.
- Voice resolver tests cover prices `1`, `999`, `1.000`, `1.001`, `999.999`, and `1.000.000`, plus invalid boundaries.
- UI tests prove first price commit, quantity revision, price revision, inactive-price silence, and no duplicate blur speech.
- Asset tests prove the expanded manifest, paths, Ogg headers, checksums, and absence of runtime/model artifacts.
- `npm run verify`, `npm run test:e2e`, `npm run package`, packaged-ASAR inspection, and `git diff --check` must pass.
