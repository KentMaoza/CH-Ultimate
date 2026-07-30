# CH Core backup and clean-restore runbook

## Production gate

CH Core production is blocked until an independent encrypted backup,
integrity check, and clean restore drill all pass. RAID1 does not satisfy this
requirement. The Hyper Backup destination must be independent from the NAS
RAID1 pool, such as a dedicated external disk or a separate supported backup
target. A connected disk is not a backup until the job and restore are proven.

Never back up the private CA signing key to the NAS. It stays off-NAS in its
own encrypted recovery custody.

## Required backup set

Each versioned backup includes:

- MariaDB logical dump and its SHA-256 sidecar.
- `/var/lib/ch-core/private` content: original catalogue, staged evidence
  retained by policy, and content-addressed cached images.
- Checksums for private files.
- Sanitized deployment configuration and a separately protected copy of
  secrets needed for recovery.
- Public CA certificate, leaf certificate, and leaf private key material.
- Exact versioned source/deployment artifact or image identity.
- DSM firewall and reverse-proxy configuration evidence.
- This deployment and restore runbook.

Do not include the private CA signing key.

## Logical dump

Run operations through an authenticated DSM administrative workflow, such as
a restricted Task Scheduler task; routine recovery must have no SSH
dependency. Supply `CH_CORE_DATABASE_URL` in the task environment without
printing it.

Choose a new absolute path on the independent destination:

```sh
server/scripts/dump-database.sh /absolute/independent/path/chu-YYYYMMDD-HHMM.sql
server/scripts/verify-dump.sh /absolute/independent/path/chu-YYYYMMDD-HHMM.sql
```

The dump script refuses relative paths and existing dump/checksum files. It
does not put the password in process arguments or normal output. It writes a
temporary dump and SHA-256 sidecar, then renames them into place. Keep both.

Copy the private-file tree with metadata, then compute and retain a bounded
file manifest. Run Hyper Backup's integrity check and record job ID, target,
time, artifact version, dump hash, private-file hash result, and operator.

## Clean scratch restore

Never begin by restoring over `chu`. Work in an explicitly named new scratch
schema and separate empty scratch directory.

1. Mount or make available the independent backup read-only.
2. Verify the dump:

   ```sh
   server/scripts/verify-dump.sh /absolute/independent/path/chu-YYYYMMDD-HHMM.sql
   ```

3. Restore only to a new name matching `chu_restore_NAME`:

   ```sh
   server/scripts/restore-scratch.sh \
     /absolute/independent/path/chu-YYYYMMDD-HHMM.sql \
     chu_restore_YYYYMMDD
   ```

   The script refuses production-like names and any existing scratch schema.
   It never drops or overwrites the production schema.

4. Restore private files to a new empty scratch path. Verify every stored file
   hash before allowing the application to read it.
5. Start the matching saved CH Core artifact against the scratch schema and
   scratch private path on an isolated loopback port.
6. Compare the restored system with the signed backup receipt:

   - SKU count and identifier/alias counts.
   - stock ledger movement totals and resulting balances.
   - completed Nota count and posting snapshots.
   - omzet movement totals and report windows.
   - audit row count and latest timestamp.
   - latest ordered change cursor and retained range.
   - cached image references, content hashes, and missing-file count.

7. Exercise authenticated bootstrap and a read-only catalogue/Nota/image
   sample. Do not pair ordinary clients to the rehearsal instance.
8. Save the comparison output and restore receipt, then remove the isolated
   scratch resources through an explicitly reviewed cleanup action.

Production remains blocked until every invariant matches or every difference
has a written, accepted explanation.

## Pre-migration dump and rollback

Before any upgrade:

1. Stop or drain client writes.
2. Create and verify a new logical dump.
3. Save private-file hashes and the current deployment artifact identity.
4. Deploy only the new saved artifact; startup migrations remain serialized by
   the existing advisory lock.
5. Run health and bounded acceptance checks.

There are no down migrations. If migration or startup fails, stop the new
service and preserve logs. Redeploying the previous artifact is safe only when
the schema is still compatible. Otherwise restore the verified dump and
private files through a reviewed clean recovery; never improvise a reverse SQL
migration or overwrite production in place.

## Disaster recovery

For actual replacement hardware or a lost volume:

1. Secure the failed system and retain its evidence.
2. Rebuild DSM, storage, packages, firewall, reverse proxy, and leaf
   certificate from the approved deployment record.
3. Create an empty production database and empty private path.
4. Verify backup hashes before importing anything.
5. Restore the verified logical dump and private files.
6. Run the same business-invariant comparison used by the scratch drill.
7. Rotate device tokens and leaf material if credential exposure is possible.
8. Reopen client access only after health, isolation, reboot, and restore
   receipts are approved.
