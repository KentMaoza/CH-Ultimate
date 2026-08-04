# CH Core NAS deployment runbook

## Stop gate: production rollout is blocked

This document is a preparation runbook plus a copied-data pilot receipt. The
CH Core runtime is deployed on the NAS, but it is not a production endpoint.
Do not import the catalogue, configure client access, or enroll production
clients until every remaining item in the blocking checklist is completed and
recorded.

## Current live-readiness boundary (2026-08-02)

The historical evidence below is retained as dated evidence; it is not a
statement that every older PASS condition is still current. A business-LAN
partial live receipt now records the Mac at `192.168.50.174`, the NAS at
`192.168.50.14` with Ethernet MAC `90:09:D0:9F:7C:1F`, and CA-validated live
and ready health at `https://192.168.50.14:8443`.

The served leaf has SAN `IP:192.168.50.14`, SHA-256 fingerprint
`22:08:62:71:10:7F:61:65:E6:34:B3:70:12:20:C3:16:BC:E1:B8:87:5A:20:E8:AA:21:26:59:DB:04:90:E5:88`,
and expires 2027-09-02. Raw API port 18080 and MariaDB port 3306 were
unreachable from the Mac. The firewall rule order, external isolation paths,
EW/NAS reboot persistence, backup/restore, and physical-client gates remain
open. See `docs/ch-core-business-lan.md`; this partial receipt is not a
production-readiness claim.

## Authenticated read-only preflight (2026-07-30)

No setting or package was changed during this preflight.

| Area | Confirmed state |
| --- | --- |
| NAS | Synology DS223j; DSM 7.4.1-90080 |
| CPU / RAM | Realtek RTD1619B, 4 cores at 1.7 GHz; 1 GB RAM |
| LAN | DHCP `192.168.1.14/24`, MAC `90:09:D0:9F:7C:1F`, 1 Gbps full duplex |
| Storage | Healthy RAID1 Storage Pool 1; healthy Btrfs Volume 1; about 1.7 TB total and 6.7 GB used |
| Disks | Two Seagate ST2000VN003 2 TB disks, healthy at 38 C / 40 C; no SMART self-test logs |
| Scrub | Last scrub completed 2026-07-27 14:58 |
| Containers | Container Manager 24.0.2-1606 installed/current; zero projects, containers, and images |
| Packages | Tailscale installed; MariaDB 10 absent; Hyper Backup absent |
| Power | UPS absent; UPS support disabled |
| Network controls | DSM firewall disabled; reverse proxy list empty |
| Resource sample | CPU about 22%, memory about 39%, swap 532.4 MB / 2 GB (26%); current swap I/O 0 KB/s |

The connected USB Seagate Ultra Slim disk is not assumed to be a configured,
independent backup.

Subsequent owner updates on 2026-07-31 do not change the historical preflight
snapshot above: external UPS hardware is reported connected, but DSM signaling
and safe shutdown are unverified. Drive 2's extended SMART test was started
and last observed at 10%; Drive 1 remains pending. The owner declined both the
router reservation and use of the connected Seagate disk for backup, so those
production gates remain open. MariaDB 10 was subsequently installed. The
`chu` database and least-privilege `chu_app` account were verified through
`/run/mysqld/mysqld10.sock`; MariaDB reports TCP port `0`. The restricted
`ch_core_service` identity and private `CH_Core_Private` share also exist.

The copied-data runtime was then built and started in Container Manager project
`ch-ultimate-core-d5bb4b6`. The image build uses commit `d5bb4b6`; Compose was
updated from commit `0969723` after the DS223j rejected Docker NanoCPUs/CFS
hard quotas. The replacement uses soft CPU shares instead. One container is
running with all capabilities dropped, a read-only root, host networking, and
`127.0.0.1:18080`. NAS-loopback checks returned `{"status":"ok"}` from
`/health/live` and `{"status":"ready"}` from `/health/ready`. A Mac LAN probe
could not reach raw port 18080 or MariaDB 3306.

DSM also warned that this kernel cannot enforce the configured PID limit. The
post-start sample showed load average `0.51 / 0.71 / 0.86`, `344328 kB`
available memory, and `639496 kB` swap used. The failed original project
`ch-ultimate-core` remains retained pending separate deletion approval. The
disabled one-time DSM staging/probe task was deleted after verification.

On 2026-07-31 the owner explicitly accepted using the current DHCP address
`192.168.1.14` for the copied-data pilot without a router reservation. This
does not satisfy the stable-endpoint production gate. If DHCP changes the NAS
address, the IP-SAN leaf certificate, DSM reverse proxy, and every client
endpoint/trust configuration must be replaced before clients can reconnect.

The off-NAS private CA and the `IP:192.168.1.14` leaf were generated and
validated on the administrator Mac. The encrypted CA signing key remains
outside the repository and NAS; its passphrase is stored in the Mac login
Keychain. DSM staging contains only the leaf key, leaf certificate, and public
CA certificate. The leaf SHA-256 fingerprint is
`22:CC:AC:8A:62:DE:C8:22:80:74:56:12:D5:55:18:67:53:BF:E7:BF:EE:17:F8:B9:D5:47:8E:B3:2B:DD:2E:1C`
and it is valid from 2026-07-31 through 2027-09-01.

The leaf was then imported into DSM and assigned only to reverse-proxy service
`*:8443`; the DSM default and QuickConnect certificate assignments were left
unchanged. Reverse proxy `CH Core LAN` maps HTTPS `*:8443` to HTTP
`127.0.0.1:18080`. The DSM firewall is enabled with two ordered,
port-specific rules: allow TCP 8443 from
`192.168.1.0/255.255.255.0`, then deny TCP 8443 from all other sources.
No catch-all deny rule was added. After applying the rules, LAN HTTPS returned
`{"status":"ok"}` with the private CA and the expected leaf fingerprint.
DSM 5001 and SMB 445 remained reachable; raw CH Core 18080 and MariaDB 3306
remained unreachable. The administrator Mac's Tailscale client was stopped,
so a separate live Tailscale-path denial probe remains outstanding.

## Blocking checklist

- [ ] Prove manual `192.168.50.14` ownership by
  `90:09:D0:9F:7C:1F` across EW and NAS reboots.
- [ ] Run explicit extended SMART tests on both disks and retain results.
- [ ] Configure an independent encrypted backup, run its integrity check, and
  complete a clean scratch restore drill.
- [ ] Verify DSM recognizes the connected UPS data link, then test safe
  shutdown and restart.
- [x] Install the supported MariaDB 10 package and verify a socket-only
  least-privilege connection with TCP disabled.
- [x] Build and start the copied-data CH Core runtime; verify loopback live and
  ready health plus raw-port isolation.
- [x] Retain the private CA off-NAS and validate the current leaf containing
  required IP SAN `192.168.50.14`.
- [ ] Re-establish and validate the scoped DSM firewall rules during the
  business-LAN cutover; the currently visible DSM Firewall UI appears disabled.
- [x] Configure and validate the DSM reverse proxy described below.
- [ ] Pass reboot, resource, load, LAN-isolation, and seven-client gates.

RAID1 is availability, not an independent backup. Production remains blocked
until the backup/restore runbook passes.

## Intended local-only topology

```text
Windows / Android
        |
business LAN HTTPS 192.168.50.14:8443
        |
DSM reverse proxy
        |
127.0.0.1:18080 (CH Core, host-network container)
        |
/run/mysqld/mysqld10.sock (Synology MariaDB 10; TCP disabled)
```

The Compose project mounts `/run/mysqld` read-only so its non-root process can
reach MariaDB without a database network listener. Host networking is retained
only so DSM can proxy to CH Core at `127.0.0.1:18080`; Compose publishes no
port. `/var/lib/ch-core/private` is its only persistent writable application
path. The container root filesystem remains read-only.

Do not expose port 18080 or MariaDB to any client network.

## Dedicated service identity and mount permissions

Do not assume the image's `node` UID can write a DSM ACL path. Before creating
the project:

1. In DSM Control Panel, create one dedicated restricted DSM service user,
   `ch_core_service`. It must not be an administrator and must not receive
   interactive DSM, SSH, SMB, or unrelated share access.
2. Create a private CH Core directory and the independent backup target
   directory. Grant that named service user only the private directory and
   backup target it needs. Deny broad `homes` and unrelated shares.
3. Obtain the service user's UID and primary GID with one bounded administrator
   Task Scheduler job that records `id -u ch_core_service` and
   `id -g ch_core_service` into a mode-0600 receipt in a restricted
   administrator staging directory. Run it once, inspect the receipt in DSM,
   then disable/delete the task and receipt. This has no SSH dependency.
4. Set those nonzero numeric values as `CH_CORE_RUNTIME_UID` and
   `CH_CORE_RUNTIME_GID` in the untracked `.env`. Compose applies the same UID
   and GID to both `ch-core` and `ch-core-ops`; the container entrypoint rejects
   missing, zero, nonnumeric, or mismatched values.
5. Before startup, use bounded one-off Container Manager/Compose runs to
   create, write, and delete one known test file from the runtime private mount
   and one from the ops backup mount. Review the exact paths first. Do not use
   recursive deletion. A failure blocks deployment; do not make the container
   root writable to compensate.

Run these exact one-off commands from the Compose project directory through a
reviewed DSM Task Scheduler job or Container Manager action:

```sh
docker compose run --rm ch-core /bin/sh -eu -c '
probe=/var/lib/ch-core/private/.ch-core-permission-probe
[ ! -e "$probe" ]
printf "%s\n" "private-write-ok" >"$probe"
[ "$(cat "$probe")" = "private-write-ok" ]
rm -f -- "$probe"
[ ! -e "$probe" ]
'

docker compose --profile ops run --rm ch-core-ops /bin/sh -eu -c '
probe=/backup/.ch-core-permission-probe
[ ! -e "$probe" ]
printf "%s\n" "backup-write-ok" >"$probe"
[ "$(cat "$probe")" = "backup-write-ok" ]
rm -f -- "$probe"
[ ! -e "$probe" ]
'
```

Each command passes through the UID/GID-validating entrypoint before its shell
runs. Each deletes only its fixed known probe path.

The production service retains a read-only root filesystem after this
preflight. Only its explicit private bind is writable. The opt-in ops service
also has a read-only root and only its explicit backup bind is writable.

## Certificate procedure

Perform CA work on an offline or separately protected administrator
workstation:

1. Generate the private CA signing key and CA certificate off the NAS.
2. Keep the private CA signing key off-NAS permanently, encrypted and backed
   up separately. Never copy it to DSM, a NAS share, the container, Hyper
   Backup, or this repository.
3. Generate a leaf key and CSR for CH Core. Sign a leaf certificate with
   `subjectAltName = IP:192.168.1.14`.
4. Transfer only the leaf key, leaf certificate, and public CA certificate to
   DSM using the authenticated DSM certificate interface.
5. Import the public CA certificate into the Windows client trust bundle and
   Android app-scoped Network Security Configuration.
6. Test that the correct certificate succeeds and untrusted, wrong-IP, and
   expired certificates fail closed. Never add a certificate bypass.

Record leaf expiry and schedule renewal before it. Renewal repeats the leaf
steps; it does not move the CA signing key onto the NAS.

## DSM firewall and reverse proxy

After the router reservation and certificate exist:

1. Identify the exact business LAN IPv4 range and its business IPv6 prefix.
   Do not use a broad IPv6 allow rule if that prefix is unknown.
2. Enable DSM firewall rules that allow TCP 8443 only from those business LAN
   ranges.
3. Deny guest Wi-Fi, WAN, mobile data, Tailscale IPv4/IPv6 ranges, and all
   other sources to TCP 8443.
4. Keep existing Tailscale administration only for DSM HTTPS 5001 and SMB
   445. QuickConnect and Tailscale are administration paths only.
5. Add DSM reverse proxy HTTPS `192.168.1.14:8443` to HTTP
   `127.0.0.1:18080`, using the IP-SAN leaf certificate.
6. Confirm 18080 remains unreachable and MariaDB has no TCP listener.

There must be no router port forwarding, UPnP rule, QuickConnect dependency,
Tailscale Serve/Funnel, public DNS exposure, or SSH dependency. DSM and
Container Manager UI procedures must be sufficient for normal operation.
Normal operation has no SSH dependency.

## MariaDB and container preparation

Only after all blocking prerequisites are ready:

1. Verify MariaDB 10 is supported on the installed DSM release, then install
   it from Package Center.
2. Keep MariaDB TCP disabled. Create the `chu` database and a dedicated
   least-privilege `chu_app` account; do not reuse a DSM administrator.
3. Create the dedicated service identity and exact ACLs described above.
   Record its numeric UID/GID receipt and complete both mount-write preflights.
4. Copy the versioned deployment artifact through a bounded staging location.
   Create `.env` from `.env.example`; use unique secrets and never commit it.
5. In Container Manager, create the project from `server/compose.yaml`.
   Confirm host networking, no published ports, the read-only
   `/run/mysqld` socket bind, the explicit nonzero numeric runtime user,
   read-only root, dropped capabilities, 256 MiB memory, 160 MiB Node heap,
   768 soft CPU shares, four DB connections, and bounded logs before starting
   it. The DS223j kernel does not support Docker's NanoCPUs/CFS hard quota, so
   do not add a `cpus` limit. The `ch-core-ops` profile must not run by default.
6. Verify `/health/live` and `/health/ready` locally, then verify HTTPS through
   8443 from the business LAN.

Migrations are serialized by the application's existing advisory lock. Before
every binary upgrade, create and verify a logical dump using the backup
runbook. There are no down migrations.

## Identity operations

1. Bootstrap the owner once from the owner desktop.
2. Generate the sealed recovery credential, print or store it offline, and
   prove it can be read. Do not store it in a normal NAS share.
3. Pair each installation with a one-use ten-minute code and explicit owner
   approval.
4. Record installation/device IDs, approval time, and assigned physical
   device. Audit identifies installations, not individual staff.
5. Revoke a lost device immediately. Confirm it receives 401 and keeps but
   cannot transmit its outbox.
6. Rotate device tokens at 180 days with the seven-day overlap. Test recovery
   and token rotation before an emergency.

## Upgrade and rollback

1. Save the exact current deployment artifact/image identity.
2. Create a pre-migration logical dump and SHA-256 sidecar; verify both.
3. Stop client writes, deploy the new saved artifact, and allow the advisory
   lock to serialize migrations.
4. Run live/ready health and a bounded read/write acceptance check.
5. If the new binary fails before a schema change, redeploy the saved previous
   artifact. If a migration ran, do not invent a down migration: stop, retain
   all evidence, and restore only through the approved clean-restore process.

## Pilot and acceptance

For the business-LAN partial live receipt and remaining cutover gates, follow
`docs/ch-core-business-lan.md`. It retains the maintenance-window procedure
and network-only rollback boundary; it does not turn this copied-data pilot
into a production endpoint.

Enroll one Windows laptop and one physical Android phone for a
**four-day copied-data pilot**. Only then enroll the remaining clients.

Acceptance must prove:

- Business Wi-Fi works with Internet disconnected.
- Guest Wi-Fi, WAN, mobile data, QuickConnect, and Tailscale cannot reach
  8443.
- Foreground changes propagate within three seconds.
- Duplicate/replayed commands never duplicate Nota, stock, or omzet.
- Concurrent stock deltas both survive and Nota conflict rules hold.
- NAS/API restart and DSM reboot lose no acknowledged transaction.
- UPS safe shutdown and restart work.
- One-hour seven-client soak has no restart or sustained swap; p95 reads stay
  below 500 ms and writes below one second.
- Backup integrity and clean restore comparisons pass.

If the DS223j fails the resource/load gate, stop rollout. Move only the Node
service to a small LAN computer while retaining MariaDB and files on the NAS.
