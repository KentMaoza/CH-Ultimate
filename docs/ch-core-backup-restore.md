# CH Core backup and clean-restore runbook

## Production gate

CH Core production is blocked until an independent encrypted backup,
integrity check, and clean restore drill all pass. RAID1 does not satisfy this
requirement. The Hyper Backup destination must be independent from the NAS
RAID1 pool, such as a dedicated external disk or a separate supported backup
target. A connected disk is not a backup until the job and restore are proven.

Never back up the private CA signing key to the NAS. It stays off-NAS in its
own encrypted recovery custody.

## One runnable operations context

Database operations run only in the dedicated Docker `ops` target through the
opt-in Compose service `ch-core-ops`. That image contains Node 24, the committed
scripts, `mariadb`, and `mariadb-dump`. The normal CH Core runtime image does
not contain the MariaDB client or backup scripts.

The ops profile does not run by default. It uses host networking without
published ports, a read-only root, dropped capabilities, no-new-privileges,
bounded CPU/RAM/PIDs/tmpfs/logs, and the same explicit
`CH_CORE_RUNTIME_UID:CH_CORE_RUNTIME_GID` as the normal service. Its only
writable bind is `/backup`, sourced from `CH_CORE_BACKUP_HOST_PATH`.

Run the commands below from the directory containing `server/compose.yaml`
through an authenticated Container Manager project action or a bounded DSM
Task Scheduler Compose job. The job invokes the container; it does not assume
that the DSM host itself has unqualified `node`, `mariadb`, or
`mariadb-dump`. Routine operations have no SSH dependency.

Before any dump, prove the restricted `ch_core_service` identity can create,
write, and delete one reviewed test file under `/backup`. The deployment
runbook defines the service-user UID/GID and ACL receipt.

## Separate least-privilege credentials

The untracked `.env` has two different URLs:

- `CH_CORE_BACKUP_DATABASE_URL` uses a read-only account and must target exact
  `/chu` on `127.0.0.1:3306`. Grant only privileges required to read and dump
  that schema; it must not create or modify business data.
- `CH_CORE_RESTORE_DATABASE_URL` uses a scratch-only account and its URL path
  must match exact `chu_restore_[a-z0-9_]+` on `127.0.0.1:3306`.

Before a rehearsal, an administrator uses the approved authenticated DSM
database-administration workflow to create a NEW empty scratch schema and a
new account granted only to that exact schema. Do not reuse `chu_app`, the
backup account, or an administrator credential. The restore script verifies
the schema already exists and is empty. It also rejects global, role, proxy,
and other-schema grants. The committed scripts do not `CREATE DATABASE` or
`DROP DATABASE`.

Credentials remain in the untracked Compose environment. The scripts write
the selected credential to a mode-0600 temporary MariaDB defaults file; a
password is never supplied in an argument or normal output.

## Required backup set

Each versioned backup includes:

- Completed MariaDB logical dump bundle.
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

## Completed dump bundle

Choose exactly one new direct child named
`/backup/<safe-name>.bundle`; never reuse a name. The safe name may contain
only ASCII letters, digits, `.`, `_`, and `-`, must not begin with `.`, and
must not contain spaces, `..` traversal, slashes, or nested directories.
`/backup` must resolve canonically without symlink ancestors, and neither the
bundle target nor any bundle entry may be a symlink:

```sh
docker compose --profile ops run --rm ch-core-ops \
  /opt/ch-core-ops/dump-database.sh \
  /backup/chu-YYYYMMDD-HHMM.bundle
```

The script atomically reserves the new bundle with `mkdir`; if the directory
already exists, it stops without changing it. Inside the reserved directory it
writes mode-0600 `dump.sql`, then `dump.sql.sha256`, then publishes mode-0600
`COMPLETE` last. It never uses a replacement move and never recursively
cleans a failed bundle.

Verify it in a separate one-off container:

```sh
docker compose --profile ops run --rm ch-core-ops \
  /opt/ch-core-ops/verify-dump.sh \
  /backup/chu-YYYYMMDD-HHMM.bundle
```

Verification requires exactly the three expected regular non-symlink files, a
valid completion marker, and a matching SHA-256. An incomplete bundle, extra
entry, symlink, invalid marker, or checksum mismatch is rejected. Preserve a
failed/incomplete bundle as evidence or remove that exact reviewed directory
through a separate cleanup approval; never retry into it.

Copy the private-file tree with metadata, then compute and retain a bounded
file manifest. Run Hyper Backup's integrity check and record job ID, target,
time, artifact version, bundle name, dump hash, private-file hash result, and
operator.

## Clean scratch restore

Never begin by restoring over `chu`. After the administrator has created the
new empty scratch schema/account and set `CH_CORE_RESTORE_DATABASE_URL`, mount
the independent backup read-only at its host boundary while keeping the
one-off container's `/backup` bind available.

Verify first:

```sh
docker compose --profile ops run --rm ch-core-ops \
  /opt/ch-core-ops/verify-dump.sh \
  /backup/chu-YYYYMMDD-HHMM.bundle
```

Then import into the URL-derived existing empty scratch schema:

```sh
docker compose --profile ops run --rm ch-core-ops \
  /opt/ch-core-ops/restore-scratch.sh \
  /backup/chu-YYYYMMDD-HHMM.bundle
```

The restore command accepts no schema-name argument. The exact scratch name
comes only from `CH_CORE_RESTORE_DATABASE_URL`, and production `/chu` is
structurally invalid. The script never creates, drops, or overwrites a schema.

If an import fails, the scratch schema may be partial. Stop. Discard it through
reviewed DBA cleanup, create a NEW scratch schema/name and new scratch-only
credential, update the URL, and begin again. Never retry into the partial
schema.

Restore private files to a new empty scratch path and verify every stored file
hash. Start the matching saved CH Core artifact against the scratch schema and
scratch private path on an isolated loopback port. Compare:

- SKU count and identifier/alias counts.
- stock ledger movement totals and resulting balances.
- completed Nota count and posting snapshots.
- omzet movement totals and report windows.
- audit row count and latest timestamp.
- latest ordered change cursor and retained range.
- cached image references, content hashes, and missing-file count.

Exercise authenticated bootstrap and a read-only catalogue/Nota/image sample.
Do not pair ordinary clients to the rehearsal instance. Save the comparison
output and restore receipt. Production remains blocked until every invariant
matches or every difference has a written, accepted explanation.

## Pre-migration dump and rollback

Before any upgrade:

1. Stop or drain client writes.
2. Create and verify a new completed bundle through `ch-core-ops`.
3. Save private-file hashes and the current deployment artifact identity.
4. Deploy only the new saved artifact; startup migrations remain serialized by
   the existing advisory lock.
5. Run health and bounded acceptance checks.

There are no down migrations. If migration or startup fails, stop the new
service and preserve logs. Redeploying the previous artifact is safe only when
the schema is still compatible. Otherwise restore the verified bundle and
private files through a reviewed clean recovery; never improvise a reverse SQL
migration or overwrite production in place.

## Disaster recovery

For actual replacement hardware or a lost volume:

1. Secure the failed system and retain its evidence.
2. Rebuild DSM, storage, packages, service UID/GID, ACLs, firewall, reverse
   proxy, and leaf certificate from the approved deployment record.
3. Create an empty production database and empty private path using the
   approved administrator workflow.
4. Verify backup hashes before importing anything.
5. Restore the verified logical dump and private files.
6. Run the same business-invariant comparison used by the scratch drill.
7. Rotate device tokens and leaf material if credential exposure is possible.
8. Reopen client access only after health, isolation, reboot, and restore
   receipts are approved.
