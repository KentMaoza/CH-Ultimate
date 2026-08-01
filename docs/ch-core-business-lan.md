# CH Business LAN cutover, rollback, and acceptance runbook

## Scope and stop condition

This is a planned 30-minute cutover procedure, not a completion receipt. It
does not perform the cutover. The live cutover has not happened. Stop before
changing cabling, router, DSM, certificate, or firewall configuration unless
the preflight receipt and maintenance-window approval are present.
This runbook does not make CH Core a production endpoint.

The only public client origin after a successful cutover is
`https://192.168.50.14:8443`. CH Core remains LAN-only. The internal API stays
at `127.0.0.1:18080`, and MariaDB TCP stays disabled.

## Target topology

| Component | Required state |
| --- | --- |
| FiberHome | LAN `192.168.1.1/24`; it remains the upstream household router |
| EW3000GX-PRO WAN | `WAN DHCP` from FiberHome |
| EW3000GX-PRO LAN | `192.168.50.1/24` |
| EW DHCP pool | `192.168.50.100-192.168.50.199` only |
| NAS Ethernet | Manual `192.168.50.14/24`, gateway/DNS `192.168.50.1`, MAC `90:09:D0:9F:7C:1F` |
| CH Core ingress | DSM reverse proxy `*:8443` to `127.0.0.1:18080` |
| TLS | Existing public CA; new leaf SAN `IP:192.168.50.14` |

Set EW to Router mode with a `CH-Business` SSID, WPA2/WPA3, no guest-LAN
access, no CH-LAN IPv6 during the pilot, no UPnP, no port forward, and no WAN
administration. Do not create Internet exposure, QuickConnect, Tailscale,
public-DNS, or Tailscale Serve/Funnel exposure for CH Core.

## Preflight evidence and staging

Complete and retain a timestamped receipt before the maintenance window:

1. Record NAS Ethernet state: DHCP `192.168.1.14/24`, MAC
   `90:09:D0:9F:7C:1F`, and 1 Gbps full duplex. This is current pre-cutover
   evidence, not proof of the target address.
2. From the administrator Mac, CA-validate `https://192.168.1.14:8443/health/live`
   and record the returned `{"status":"ok"}` plus the current leaf
   fingerprint/expiry. Confirm the DSM certificate list still contains the old
   `IP:192.168.1.14` leaf.
3. Capture DSM network, reverse-proxy, firewall, certificate-assignment, and
   Container Manager state; export EW configuration. The DSM Firewall UI
   currently appears disabled, so prior firewall PASS evidence is historical
   only and must be re-established during cutover.
4. Using the opt-in operations container from
   `docs/ch-core-backup-restore.md`, create a new completed logical dump bundle
   and verify its checksum and integrity before changing the network.
5. Copy the completed bundle off the NAS to the protected administrator Mac
   and record its SHA-256 hash. The receipt must also name the bundle, NAS
   source, off-NAS destination, timestamp, and operator.
6. Where feasible, capture the private-file manifest and evidence, copy them
   off the NAS to the protected administrator Mac, and record their hashes.
   Record any unavailable evidence as an open production gate; do not imply
   that the dump bundle contains private files.
7. Independent encrypted backup and clean scratch restore remain BLOCKED as
   separate production-readiness gates; they are not prerequisites for this
   network-only cutover. Passing this cutover must not be called
   production-ready.
8. On the protected administrator Mac, generate and validate a new leaf with
   SAN `IP:192.168.50.14` from the unchanged private CA. Keep the CA signing
   key off NAS and out of this repository. Stage only the new leaf key, leaf,
   and public CA in DSM; do not assign it yet.
9. Record the current client list and pause business writes. Verify no client
   is using a direct raw API port or MariaDB TCP.

## Exact 30-minute cutover order

Use one operator and one observer. Mark each step with time, operator, and
result. If any numbered check fails, stop and use the rollback boundary below.

| Window | Action and required observation |
| --- | --- |
| T-30 to T-25 | Announce the maintenance window and pause writes. Confirm the preflight receipt for the verified completed logical dump, its off-NAS copy/hash, and the private-file manifest evidence captured where feasible. |
| T-25 to T-20 | Export EW and DSM state; confirm old DHCP `.1.14`, MAC `90:09:D0:9F:7C:1F`, current CA-validated health, and the old IP leaf. |
| T-20 to T-15 | Configure EW Router mode: WAN DHCP, LAN `192.168.50.1/24`, pool `192.168.50.100-192.168.50.199`, `CH-Business`, WPA2/WPA3, and disabled UPnP/port-forward/WAN-admin/guest-LAN access. Do not connect its WAN until reviewed. |
| T-15 to T-10 | Connect a FiberHome LAN port to EW WAN. Keep the NAS connected only to EW LAN. Confirm an EW client receives a DHCP address in the configured pool. |
| T-10 to T-7 | Change NAS Ethernet to manual `192.168.50.14/24`, gateway/DNS `192.168.50.1`. Confirm the address table assigns `.50.14` only to `90:09:D0:9F:7C:1F`. |
| T-7 to T-4 | Assign the new `IP:192.168.50.14` leaf only to DSM reverse-proxy `*:8443`; retain `127.0.0.1:18080` as its upstream. Do not expose 18080 or enable MariaDB TCP. |
| T-4 to T-2 | Enable DSM firewall and place the rules in this order: allow TCP 8443 from 192.168.50.0/24, then deny TCP 8443 from every other source. Preserve separate DSM administration rules only where explicitly approved. |
| T-2 to T+0 | Join an administrator client to `CH-Business`; CA-validate `https://192.168.50.14:8443/health/live`, then check `/health/ready`. Record certificate fingerprint, firewall order, and reverse-proxy target. |
| T+0 to T+5 | Perform the isolation and reconnect checks below. Do not enroll production clients or declare acceptance from a health response alone. |

## Client reconnect and isolation checks

Windows and Android clients must join `CH-Business`, receive an EW DHCP address
from `.100-.199`, and use only `https://192.168.50.14:8443`. They must retain
the existing public CA and fail closed for the old IP, a wrong-IP leaf, an
untrusted leaf, redirects, paths, and other origins. Do not bypass TLS errors.

Record positive and negative probes separately:

- From `CH-Business`, CA-validated `/health/live` returns `{"status":"ok"}`;
  `/health/ready` returns ready; raw `192.168.50.14:18080` and MariaDB TCP
  remain unreachable.
- From FiberHome/IndiHome, guest Wi-Fi, mobile data, WAN, QuickConnect, and
  Tailscale, TCP 8443 is unreachable. Confirm no router port forward, UPnP,
  QuickConnect application path, Tailscale Serve/Funnel, or public DNS reaches
  CH Core.
- Verify DSM administration remains separately controlled; it is not evidence
  that CH Core is reachable.

## Reboot persistence and acceptance gate

After the above checks, reboot EW then NAS. After each reboot, prove one NAS
MAC at .50.14 across EW and NAS reboots: `192.168.50.14` must resolve only to
`90:09:D0:9F:7C:1F`, with no duplicate ARP/DHCP ownership. Re-run CA-validated
health and all isolation probes after the NAS restart.

The physical acceptance gate remains blocked until the independent encrypted
backup and clean scratch restore, SMART, UPS, restart, load, and device gates
pass. Then run one Windows laptop and one Android phone for 24 hours before the
one-hour seven-client soak. The seven-client gate requires no restart or
sustained swap, p95 reads below 500 ms, p95 writes below one second, no
duplicate Nota, stock, or omzet postings, and no lost acknowledged transaction
across restart.

## Rollback boundary

Rollback applies only to this network/certificate/firewall cutover. If the new
endpoint cannot pass CA-validated health, firewall isolation, or unique-MAC
checks during the window, stop client activity, restore the captured EW and
DSM network/reverse-proxy/firewall/certificate assignments, reconnect the NAS
to the prior reviewed topology, and verify the prior CA-validated old endpoint
before reopening pilot access.

Do not change the CH Core image, database schema, database data, CA signing
key, or client trust bundle as a network rollback shortcut. Do not factory
reset EW or DSM. If any data migration or non-network change occurred, use the
separate backup and clean-restore runbook instead. Preserve failed-probe logs,
exports, and the exact reason for rollback; the next attempt starts with a new
preflight receipt.
