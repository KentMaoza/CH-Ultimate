# CH Ultimate v0.2.2 Real-Use Readiness Plan

> **Execution:** Follow the Superpowers executing-plans workflow. Perform one
> gate at a time, retain sanitized evidence, and stop on the first mismatch.

**Goal:** Publish CH Ultimate v0.2.2 Windows and Android clients
usable against an authoritative CH Core v2 on the business LAN, load the
approved catalogue, and hand off verified installers for owner-managed manual
installation and physical workflow checks.

**Architecture:** Keep Windows and Android as device-resident clients. CH Core
is the only write authority, reached through CA-validated LAN HTTPS at
`https://192.168.50.14:8443`; MariaDB and raw Core ports remain inaccessible
from client devices. Preserve `OperationsGateway`, server-generated revisions,
idempotency, audit records, and the offline-outbox boundary.

**Superseded release:** GitHub prerelease `pilot-v0.2.1`, client/server source
commit `2c569db25ada195e00ef220e99d6b05909a46768`. It must not be deployed because
the runtime audit found a critical jsPDF dependency. The live NAS still runs
Core v1; publish and verify v0.2.2 before any Core deployment.

## Owner decisions and non-negotiable boundaries

- Backup and business data remain on the NAS. Do not copy either to the Mac.
- Record this as an accepted pilot risk: a same-NAS backup protects against a
  bad migration or logical corruption, but not loss of the NAS/volume itself.
- Do not expose CH Core through QuickConnect, Tailscale, WAN port forwarding,
  UPnP, guest Wi-Fi, or TLS bypass.
- The owner already uninstalled both clients. Android is directly verified;
  Windows is owner-confirmed. Record both old outboxes as
  `UNAVAILABLE_AFTER_OWNER_UNINSTALL`, never as zero.
- Do not clear the live database. Import the workbook transactionally and
  reconcile existing rows; never overwrite established Nota/stock history.
- Credentials are entered or rotated by the owner in DSM. They must never
  appear in terminal output, screenshots, repository files, or receipts.
- Full database rollback is available only before the first Core v2 write or
  outbox replay. After that boundary, quiesce and forward-fix.
- No four-day pilot is part of this execution; the owner explicitly removed it.
- The owner installs both clients manually from the private GitHub release. The
  operator does not install, uninstall, or clear either client remotely.

## Definition of done

The release is ready for controlled real use only when all of these are true:

1. CH Core returns an authenticated bootstrap with `apiSchemaVersion: 2`, a
   present `stockChecks` array, and authoritative non-empty catalogue data.
2. A fresh NAS logical dump and private-file manifest pass checksums, and a
   clean scratch restore on the NAS reproduces all required counts/invariants.
3. Windows and Android both run v0.2.2, remain paired, show `online`, and drain
   their outboxes without duplicate writes.
4. The approved workbook is imported with 3,144 SKU and 6,288 identifiers;
   import counts, selected prices, stock baseline, and image jobs match the
   reviewed preview or have an accepted exception receipt.
5. Nota editing, image synchronization, share recommendations, stock check and
   barcode adjustment, printing, PDF/XLSX export, Android Back, offline/reconnect,
   and restart recovery pass on the actual Windows laptop and Samsung phone.
6. The owner receives exact installer links, checksums, version/signing
   expectations, installation order, and a post-install acceptance checklist.

Because there is no independent backup, passing this plan means **controlled
internal real use with an accepted disaster-recovery risk**, not full
disaster-resilient production readiness.

## Task 1: Freeze release inputs and prepare the maintenance window

**Evidence files:**

- Update: `docs/releases/pilot-0.2.2-evidence.md`
- Update: `docs/ch-core-acceptance-status.md`

1. Publish, re-download, and verify the Windows installer, Android APK, and
   `SHA256SUMS.txt` from `pilot-v0.2.2`; verify exact hashes, package/version
   metadata, and the pinned Android signing certificate.
2. Verify the staged Core v2 source archive is the reviewed commit and hash,
   includes migration `010_stock_checks.sql`, and leaves migrations 001-009
   byte-identical to the live Core lineage.
3. Reconfirm the current NAS project/image and retain its exact source archive,
   image identity, Compose configuration, and sanitized rollback receipt.
4. Record both clients as uninstalled and quiesced. Preserve the unavailable
   outbox disposition; do not infer that deleted local queues were empty.
5. Verify no installed CH Ultimate process/package remains before maintenance.
6. Announce the maintenance window and record WITA start time and operator.

**Gate:** Both outboxes have an accepted disposition, all clients are closed,
the exact old/new artifacts are frozen, and rollback is still available.

## Task 2: Rotate exposed credentials through an owner handoff

1. The owner creates a separate random MariaDB application account for v0.2.2
   using DSM's approved administration path and writes it only to the new
   untracked Compose environment. Keep the old account and live environment
   unchanged until cutover succeeds; retire the old account afterward.
2. Confirm an owner already exists and determine whether the encrypted Windows
   owner credential survived package uninstall. Do not assume uninstall erased
   or preserved application data. If the credential is unavailable, stop:
   v0.2.2 cannot accept a manually entered recovery credential and a new
   bootstrap cannot replace an existing owner.
3. Keep the backup account read-only and the restore account scratch-only. Do
   not reuse the application account for either job.
4. Run a sanitized configuration validation that reports only presence,
   minimum-length/shape, target host/schema, UID/GID, and PASS/BLOCKED—not
   credential values.

**Gate:** The owner confirms rotation, no secret appears in evidence, and the
new runtime configuration validates before any container is started.

## Task 3: Create and prove the NAS-only recovery point

1. Through a bounded one-time DSM task, capture exact counts for every table in
   `docs/ch-core-v0.2-maintenance-rollback.md`, the highest migration, and the
   live `schema_migrations` rows. Treat absent pre-v2 `stock_checks` as an
   expected schema fact, not as count zero.
2. Create one new timestamped bundle under the NAS backup share using
   `/opt/ch-core-ops/dump-database.sh`. Never reuse the old bundle name.
3. Run `/opt/ch-core-ops/verify-dump.sh`; record `COMPLETE`, exact structure,
   size, and SHA-256 without storing dump contents in the repository.
4. Produce a checksummed manifest of the CH Core private-file tree, including
   image assets and retained import evidence. Do not include the private CA
   signing key.
5. Create a new empty scratch schema with scratch-only credentials, restore the
   dump, run `/opt/ch-core-ops/compare-scratch.sh`, and require an identical
   canonical-dump SHA-256 plus matching identity, catalogue, Nota, stock, omzet,
   audit, cursor, and image-reference counts/invariants.
6. Preserve the verified bundle and scratch-restore receipt on the NAS. Cleanup
   of scratch data is a separate reviewed action after cutover evidence is
   retained.

**Smallest verification:** Exact database counts and private-file hashes match
between source and scratch. Any unexplained difference stops deployment.

## Task 4: Deploy CH Core v2 with a hard rollback boundary

1. Re-run CA-validated `/health/live` and `/health/ready` immediately before
   maintenance; never use `-k`.
2. Stop the old Core container while retaining its image, source, configuration,
   and logs. Do not modify MariaDB data manually.
3. Build/deploy exactly the reviewed Core v2 archive and allow the existing
   advisory migration lock to apply migration 010 once.
4. Require one healthy Core container, read-only root filesystem, dropped Linux
   capabilities, bounded RAM/CPU/PIDs, loopback raw API, and no MariaDB TCP.
5. Verify migration rows and checksums 001-010. Confirm that no unreviewed
   migration or schema drift exists.
6. Before allowing the first v2 business write, verify authenticated bootstrap
   contains `apiSchemaVersion: 2` and `stockChecks`, health passes through the
   bundled CA, and a v0.1.5 client fails closed without attempting a write.

**Failure rule:** Before any v2 write/replay, restore or return to the retained
compatible artifact only through the reviewed rollback procedure. After a v2
write/replay, preserve data and use a test-first forward-fix.

## Task 5: Prove backend operational safety

1. Verify business Wi-Fi can reach only `8443`; raw `18080` and MariaDB `3306`
   remain unreachable from clients.
2. Verify guest Wi-Fi, mobile data, WAN, QuickConnect, and Tailscale cannot reach
   CH Core. Confirm DSM firewall allow-then-deny order directly.
3. Reboot only within the approved gate, then prove the NAS retains `.50.14`,
   the certificate remains valid, Core auto-starts, and acknowledged data is
   unchanged.
4. Confirm UPS detection and safe-shutdown signaling in DSM. Record the result;
   do not claim protection merely because power hardware is connected.
5. Complete extended SMART tests for both drives and retain the results.
6. Run a one-hour load/soak with the planned client count. Require no Core
   restart/OOM/sustained swap, p95 reads under 500 ms, and p95 writes under one
   second. If the DS223j fails, move only the Node service to a small LAN host;
   keep MariaDB and private files on the NAS.

## Task 6: Import the approved SKU workbook transactionally

**Approved source:** `SKU_Gudang20260804080716145.xlsx`, SHA-256
`f1f4675327fac107ef9f78c114b8afe86389d5543b204540ed45e74f9b15e49c`.

1. Re-run preview and require 3,144 SKU, 6,288 identifiers, 2,786 image
   references, 358 missing-image sources, 3 Modal selections, Rp276,285,615
   selected-price total, and 3,988 PCS baseline stock.
2. Use the reviewed rule: positive `Modal Referensi`; only a missing or
   non-positive Modal value falls back to positive `Harga Jual Referensi`.
3. Reconcile the five existing Core SKU by stable SKU code/identifier. Update
   only matching catalogue fields; preserve IDs and any real history. Any
   unmatched existing test row is reported for explicit disable/archive review,
   not deleted automatically.
4. Execute one idempotent transactional import. A duplicate identifier, invalid
   row, count mismatch, or unexpected existing activity rolls back the import.
5. Verify authoritative counts and sample prices/units on the API. Queue image
   jobs separately so source failures remain retry-visible and cannot roll back
   the catalogue transaction.
6. Verify the stock baseline exactly once. Subsequent workbook edits must never
   overwrite live stock, Nota, price history, or audit activity.

## Task 7: Hand off manual installation and pairing

1. Give the owner the private GitHub release URL and exact SHA-256 values for
   the Windows installer, Android APK, and checksum manifest.
2. **Windows owner action:** verify the installer checksum, perform a clean
   package installation, and confirm product version 0.2.2. Test whether the
   encrypted owner identity retained in Windows application data reconnects;
   package uninstall alone is not evidence that this state was erased.
3. **Android owner action:** verify package ID `com.tokoch.chucompanion`,
   versionName 0.2.2, versionCode 9, and the permanent signer; perform a clean
   installation because the prior package was already removed by the owner.
4. If the Windows owner identity reconnects, use it to approve the named
   Samsung device. If it does not reconnect, stop and use the separately
   reviewed owner-recovery path; never attempt first-owner bootstrap over an
   existing owner row and never enter an owner bootstrap credential on the phone.
5. After the owner reports installation complete, verify both devices reach
   `online`, report the same Core revision and SKU count, and do not render a
   valid-looking empty state during failures. This verification does not
   authorize the operator to install either client.

The current Windows installer is suitable for a controlled internal pilot when
downloaded from the private release and checksum-verified, but it is not
Authenticode-signed. Obtain Windows code signing before broad unattended or
multi-user distribution; do not hide or bypass SmartScreen warnings.

## Task 8: Physical feature acceptance

Test one behavior at a time and record pre/post revision, audit reference, and
the second device's observed state:

1. Edit Nama Barang and Jenis; select PCS and LSN; verify focus remains usable.
2. Create/edit/complete/reopen one clearly named pilot Nota and prove no
   duplicate posting under idempotent replay.
3. Upload/replace one SKU image on one device and verify the other device shows
   the same content hash; force one controlled failure and verify retry-visible
   status.
4. Verify newly created and newly stocked SKU enter share recommendations.
5. Scan a known barcode, show current stock, change the quantity, and verify
   `last checked` WITA plus the stock audit on both devices.
6. Open the Windows print dialog and print to the actual target printer; verify
   logo/layout. Export PDF and XLSX, then open both and reconcile SKU, stock,
   image/reference, Nota, and date fields.
7. Verify Android Back returns from notifications, scanner, SKU detail, archive
   edit, recommendations, and export; only top-level Beranda may exit.
8. Exercise controlled offline/reconnect. Offline state must never say
   `Tersinkronisasi`; queued operations must drain once and conflicts must remain
   explicit.
9. Restart both clients and Core in separate approved steps and prove no
   acknowledged transaction, identity, image, or outbox is lost.

**Gate:** Every requested feature passes on physical hardware. Any Critical or
High issue stops the rollout and is fixed test-first in a patch release.

## Task 9: Production handoff or stop

1. Publish `pilot-v0.2.2` through the tested GitHub workflow and retain its
   exact checksums. There is no time-based pilot gate.
2. Keep v0.2.1 as superseded history; do not replace its assets or deploy its
   Core source bundle.
3. Enroll additional Windows/Android devices only after physical acceptance passes and
   each device has a named owner approval and signer/version receipt.
4. Preserve the NAS backup, migration receipt, physical acceptance receipt, and
   final go/no-go decision. Never commit secrets or business-data dumps.
5. Report two separate statuses honestly:
   - `Operational real-use PASS` when Core, devices, and the owner-run physical
     feature checklist pass.
   - `Disaster-recovery BLOCKED` while backup remains only on the NAS.
