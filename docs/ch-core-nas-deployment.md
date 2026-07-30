# CH Core NAS deployment runbook

## Stop gate: deployment is blocked

This document is preparation, not a deployment receipt. CH Core has not been
deployed to the NAS. Do not install MariaDB, create containers, change DSM
networking, or enroll production clients until every item in the blocking
checklist is completed and recorded.

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

## Blocking checklist

- [ ] Create the router reservation `90:09:D0:9F:7C:1F -> 192.168.1.14`
  without changing WAN forwarding, UPnP, or the subnet.
- [ ] Run explicit extended SMART tests on both disks and retain results.
- [ ] Configure an independent encrypted backup, run its integrity check, and
  complete a clean scratch restore drill.
- [ ] Install and test a compatible UPS, including DSM safe shutdown.
- [ ] Confirm the supported MariaDB 10 package and make a documented
  host-loopback-only connection decision.
- [ ] Generate a private CA off-NAS and a leaf certificate containing the
  required IP SAN `192.168.1.14`.
- [ ] Enable and validate the DSM firewall rules described below.
- [ ] Configure and validate the DSM reverse proxy described below.
- [ ] Pass reboot, resource, load, LAN-isolation, and seven-client gates.

RAID1 is availability, not an independent backup. Production remains blocked
until the backup/restore runbook passes.

## Intended local-only topology

```text
Windows / Android
        |
business LAN HTTPS 192.168.1.14:8443
        |
DSM reverse proxy
        |
127.0.0.1:18080 (CH Core, host-network container)
        |
127.0.0.1:3306 (Synology MariaDB 10)
```

The Compose project uses host networking so its non-root process can reach
host-loopback MariaDB. CH Core itself is forced to `127.0.0.1:18080`; Compose
publishes no port. `/var/lib/ch-core/private` is its only persistent writable
application path. The container root filesystem remains read-only.

Do not expose port 18080 or MariaDB to any client network.

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
6. Confirm 18080 and 3306 remain unreachable from business clients.

There must be no router port forwarding, UPnP rule, QuickConnect dependency,
Tailscale Serve/Funnel, public DNS exposure, or SSH dependency. DSM and
Container Manager UI procedures must be sufficient for normal operation.
Normal operation has no SSH dependency.

## MariaDB and container preparation

Only after all blocking prerequisites are ready:

1. Verify MariaDB 10 is supported on the installed DSM release, then install
   it from Package Center.
2. Bind MariaDB to host loopback only. Create the `chu` database and a
   dedicated least-privilege `chu_app` account; do not reuse a DSM
   administrator.
3. Create a private Btrfs directory for CH Core files and restrict it to the
   service administrator. Do not use the broad `homes` share.
4. Copy the versioned deployment artifact through a bounded staging location.
   Create `.env` from `.env.example`; use unique secrets and never commit it.
5. In Container Manager, create the project from `server/compose.yaml`.
   Confirm host networking, no published ports, non-root user, read-only root,
   dropped capabilities, 256 MiB memory, 160 MiB Node heap, 0.75 CPU, four DB
   connections, and bounded logs before starting it.
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

Enroll one Windows laptop and one physical Android phone for a 24-hour
copied-data pilot. Only then enroll the remaining clients.

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
