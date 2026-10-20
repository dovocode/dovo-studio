# Internet connections

In desktop **Settings → Devices & runtime → Connect your phone**, scan the QR code in mobile
**Computers**. Review the connection and tap **Connect**, then approve the named phone on the
computer. No VPN, public runtime address, port forwarding, provider account or extra software is
required for direct connections. Dovo relay access needs one-time operator approval for the
computer. Both apps need an updated build and Connect must run the updated signaling service.

**Relay fallback is opt in, per connection.** The default is **Direct only**. On desktop choose the
fallback before generating the QR; on mobile choose during pairing or under **Computers → your
computer → Relay fallback**. Changes are saved securely and switching off closes the previous
transport immediately. Old cached requests cannot re-enable a relay. The computer's QR sets the
maximum permission: a phone cannot turn a Direct-only pairing into a relayed connection. To allow
relay later, generate a Dovo-enabled QR on the computer and pair again. An ordinary LAN/VPN pairing
cannot silently enable internet connectivity.

- **Direct only:** WebRTC + STUN, without a relay. Some networks cannot connect.
- **Dovo relay fallback:** ICE prefers a direct path; Dovo's coturn service can carry encrypted
  packets when necessary. This explicitly permits ciphertext to pass through Dovo infrastructure.

The relay does not terminate WebRTC's DTLS encryption. It can observe IPs, timing and traffic
volume. Cloudflare TURN is not offered or configured. When a selected provider is unconfigured,
unavailable or rate-limited, only direct ICE remains available; blocked direct connections report
the selected relay as unavailable. ICE may gather relay candidates even when it ultimately selects
direct. No extra software or account is required. To request relay approval, select Dovo relay
fallback on the computer, copy its public relay approval key and share it with the operator.

Internet connections use reliable WebRTC data channels and STUN, with DTLS encryption between the
phone and computer. Connect exchanges bounded ICE/SDP connection metadata only. Pairing codes,
device bearer tokens, chats, files, terminal traffic and previews do not pass through Connect. IP
candidates, opaque rendezvous identifiers and connection timing are visible to signaling/STUN
services. Existing notification and Live Activity delivery is unchanged, including its relay
content.

The QR contains a high-entropy temporary key. Both complete SDP descriptions (including DTLS
fingerprints and ICE credentials), their roles, session nonce, offer binding and relay choice are
authenticated using that key. The signaling service cannot substitute another computer's
certificate. The ordinary single-use two-minute pairing code and desktop approval are still
required. Once paired, a separate per-device capability is issued over the encrypted connection and
saved in the phone's secure registry. Revoking the device closes its peers and removes its
capability. The bootstrap capability expires with the invitation.

On the phone, an ephemeral loopback listener carries existing HTTP, WebSockets, images, files and
WebViews over the same peer connection. On the computer, the only tunnel destination is an ordinary
runtime listener on loopback: it cannot forward arbitrary ports or use desktop-only routes. All
runtime authorization checks remain in place. Server-owned tunnel provenance denies local-only
Studio APIs and binds authenticated HTTP/WebSocket access to the paired device. Unknown local
connections to that dedicated listener are refused; forwarded headers cannot override provenance.
Stream credits bound buffering in both directions. Connections close when mobile backgrounds and
reconnect when it returns. Uncertain mutations retain their existing idempotency/recovery behavior;
transport reconnect does not replay them. Native background notification replies cannot establish
WebRTC while JavaScript is suspended; unconfirmed answers stay saved for review in Dovo.

Some CGNAT, symmetric-NAT and corporate networks need TURN. Direct-only connections report failure
rather than switching to a relay or advertised LAN routes. TURN supports UDP and TCP/TLS. Set
`DOVO_TURN_TLS_PORT` to a dedicated port (443 on a dedicated host, or 5349/8443 alongside an
existing HTTPS ingress). UPnP is not used. Keep Dovo running and the computer awake. Existing
HTTP/HTTPS LAN and VPN pairing remains available separately, including Tailscale/NetBird.

## Operating Connect

The runtime makes an outbound WSS connection to `/v1/peer` at `https://connect.dovo.studio`.
`DOVO_CONNECT_ORIGIN` can select another HTTPS signaling origin. Loopback HTTP is accepted only for
local integration testing. The reverse proxy must forward WebSocket upgrades and allow idle
connections longer than the 25-second heartbeat. Use one signaling instance: room state is bounded,
ephemeral and in memory, and is not replicated between processes. No accounts or account sessions
are required. Do not log WebSocket bodies or pairing links. Set `DOVO_CONNECT_TRUSTED_PROXIES` to
the exact immediate proxy address after verifying that proxy sanitizes client-supplied forwarded
headers. Never trust all private networks or arbitrary `X-Forwarded-For` values. With no trusted
proxy configured, forwarded headers are ignored safely, but clients behind one proxy share its
connection and request limits. Recheck the address when a container changes networks.

There are no media capture permissions for this transport: it uses data channels only. Mobile
requires a new native build containing `react-native-webrtc` and `react-native-tcp-socket`; an
over-the-air JavaScript update alone is insufficient. Desktop/runtime WebRTC uses the portable
TypeScript `werift` implementation, avoiding another native desktop binary.

## Relay operations

Connect offers no relay until its backend is configured. Set secrets in the operator's private
Connect environment (see `apps/connect-server/.env.example`); never put them in app builds or
pairing links. A partial configuration fails startup rather than silently publishing unusable
credentials.

### Dovo coturn

The separate `apps/connect-server/turn/compose.yaml` and `turnserver.conf` provide the operator
configuration. This is a separate TURN endpoint, not an HTTP proxy inside Connect.

1. Use a Linux host with dedicated TURN ports and a public IP; point `turn.dovo.studio` to it using
   DNS-only records.
2. Provision a valid certificate for that name; mount `fullchain.pem` and `privkey.pem` under
   `apps/connect-server/turn/certs`. Keep certificate private keys and environment files private and
   readable by the container user; renew certificates and signal coturn with `SIGUSR2` to reload
   them.
3. Choose a dedicated TLS port using `DOVO_TURN_TLS_PORT` on both services in TURN Compose; update
   the advertised TURN URLs and firewall to match. Never share that port with another service.
4. Generate one random secret of at least 32 characters and configure the same
   `DOVO_RELAY_TURN_SECRET` on Connect and coturn. Never use the example values as credentials.
5. Set Connect's `DOVO_RELAY_TURN_URLS` to
   `turn:turn.dovo.studio:3478?transport=udp,turn:turn.dovo.studio:3478?transport=tcp,turns:turn.dovo.studio:443?transport=tcp`.
6. Allow TCP/UDP 3478, your chosen TCP TLS port, and UDP 20000–20099. Verify this relay range is
   unused and outside the host’s automatic ephemeral port range. If the operator host is behind NAT,
   configure `listening-ip`, `relay-ip`, `external-ip` and matching forwarding. These are operator
   tasks; users need none of them. Standard HTTP/CDN proxies cannot carry this TURN listener. Set
   `DOVO_TURN_PUBLIC_IPS` to the host's comma-separated public IPs in both TURN services, especially
   behind NAT. The guardian blocks relayed traffic to other ports on its own host, while allowing
   traffic between allocations in the relay range.
7. From the `turn` directory run `docker compose up -d` with its private environment configured,
   then deploy/restart updated Connect with the matching environment.

TURN over TCP/TLS still uses the UDP relay port range for WebRTC peer traffic. Forward that range
even if advertising only TCP/TLS listeners. A valid certificate or STUN binding response does not
establish that authenticated relay payloads can flow end to end.

Before enabling relay issuance, configure `DOVO_RELAY_APPROVED_KEYS` with a comma-separated list of
public approval keys copied from computers' Settings. An empty list denies every relay grant even
when TURN URLs and the shared secret are configured. Each runtime stores its own Ed25519 private
installation key locally. It signs a fresh, single-use broker challenge bound to its room and both
signaling capabilities, the Connect origin and the computer's relay consent; approval cannot be
obtained by copying a public key or replaying an old proof. An unapproved installation can still use
direct WebRTC without an account. Removing a key and restarting Connect blocks new grants for that
installation; previously issued grants expire within ten minutes. To invalidate all outstanding
grants immediately, rotate the private coturn shared secret, restart coturn to close existing
allocations, and configure the matching new secret on Connect. Keep issuance disabled throughout
that operation.

Connect issues standard coturn REST credentials: an expiring, randomized username and its HMAC-SHA1
password. Approved installations share cached grants across their rooms and TURN usernames include a
truncated hash for operator attribution. The public installation key itself is not a TURN username.
Per-installation issuance limits avoid treating phones behind one carrier NAT as one user. The
shared secret never leaves the backend. The template rejects private, loopback and multicast peer
destinations, disables the admin CLI and TCP relay allocations (TURN over TCP/TLS remains enabled),
and limits allocations/bandwidth. Adjust those limits to the operator budget. Coturn cannot decrypt
the inner DTLS/SCTP traffic. Credentials last at most ten minutes; clients close the connection
before expiry and reconnect through fresh authenticated negotiation. Endpoints are pinned to
`turn.dovo.studio` by default. Self-hosted runtimes can set comma-separated `DOVO_PEER_RELAY_HOSTS`;
these pins travel in the out-of-band QR and secure phone registry, not broker-supplied metadata.
Dovo still pays its host/network costs. Approved participants can reuse standard TURN bearer
credentials until they expire; approvals should therefore be issued only to trusted installations.
Rate limits, allocation/bandwidth ceilings and the hard shared quota remain necessary. The 100-port
relay range also bounds concurrent allocations; the higher configured allocation quota does not
expand that range. Coturn caps an allocation's granted lifetime at ten minutes, but credential
removal alone does not terminate an existing allocation immediately. The credential refresh window
can briefly overlap two usernames, so the eight-allocation quota per username permits up to sixteen
allocations for one installation during that overlap.

These protections apply to this phone-to-computer transport. They do not promise protection from a
compromised phone/computer, leaked pairing links, operating-system vulnerabilities or a hostile
operator replacing the software. Existing model-provider requests, local storage, notifications and
Live Activities retain their separate security properties. Signaling/STUN/relay metadata (including
IP addresses, timing and traffic size) remains visible to those services. This is not a claim that
no information can ever leak.

### Hard daily Dovo relay cap

The TURN Compose includes a host-network budget guardian with `NET_ADMIN` and a persistent `budget`
volume. It enforces **750,000,000,000 bytes of total TURN egress per UTC calendar day** in nftables,
including overhead and packets on established connections. Only configured TURN source ports and the
fixed relay port range are counted. Do not reuse those ports for other services. Both the guardian
and coturn must share the same host network namespace.

Each 1 GB allowance is reserved on disk with fsync before the kernel can transmit it. Container or
host restarts conservatively consume any unused reservation instead of resetting usage. A 1 GB
reserve across day boundaries covers traffic in the prior reservation while the watcher wakes. The
usable allowance can therefore be slightly less than 750 GB. Never delete the budget volume or flush
its state. When upgrading from the monthly cap, the current month's reserved bytes count against the
first day's allowance; the next day starts its normal allowance with the rollover reserve. Never
flush the guardian's nftables table while coturn runs. Keep both the guardian's startup health
dependency and coturn's boot-bound readiness check: Docker restart policies alone do not honor
Compose dependencies after a host reboot. Coturn waits for rules installed in the current boot
before opening its listeners. The marker also binds the security rules version, TLS port and
configured public addresses; update both guardian and coturn together when upgrading from an older
template. At the cap, all relay egress stops; direct WebRTC and LAN/VPN remain available. The
guardian restores a new allowance automatically at midnight UTC. These controls count encrypted
network bytes and do not inspect or store chats/files.

The guardian image requires a Linux host with nftables support and permission to manage its network
namespace. Validate rules and quota behavior in an isolated network namespace before starting the
production relay. Application credentials alone cannot enforce this cap.

### Limits and validation

The relay defaults to 100 new grants/hour and 20 per approved installation/hour; set
`DOVO_TURN_HOURLY_LIMIT` to change the global issuance limit. At most 2,048 installation grants are
cached for the relay. Cache and rate limits are in memory on the single Connect instance and reset
on restart. These controls bound issuance, not traffic volume or determined distributed abuse; the
kernel egress quota, coturn bandwidth/allocation caps and operational monitoring remain necessary.

Run `pnpm test:peer-connection:browser` for real Chromium-to-runtime negotiation and pairing UI
checks. Set `DOVO_TEST_TURN_BINARY` to a local coturn `turnserver` binary to additionally force UDP
and TCP relay paths using real expiring REST credentials. The test server binds only loopback.
Mobile TCP and UI native boundaries are adapted in Chromium; it is not a physical-device test.

Set `DOVO_TEST_CONNECT_ORIGIN=https://connect.dovo.studio` to test the deployed signaling broker and
relay. The browser check verifies direct, UDP, TCP and TLS paths independently. Set
`DOVO_TEST_CONNECT_MODES=direct` to check signaling while relay credential issuance is disabled, or
choose a comma-separated subset of the advertised transports. For deployed relay checks, use
`DOVO_TEST_PEER_DATABASE` to retain the test installation's identity across protocol checks,
explicitly approve that public key on Connect, then remove its approval when testing is complete.
Never copy the installation private key to Connect.

Public TURN DNS/TLS, real iPhone/Android network handover and cellular/restrictive-network behavior
must be checked on deployed native builds. Server and mobile JavaScript bundle tests do not
establish that these deployments are ready.

## Free third-party tunneling investigation (2026-10-20)

Only Dovo coturn is currently implemented as a relay. External providers below were investigated but
are not enabled.

| Option                   | No additional user setup                   | Provider can read application content                          | Free limits / fit                                                                                                                                                    |
| ------------------------ | ------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct WebRTC + STUN     | Yes                                        | No                                                             | No application relay costs; cannot traverse every network.                                                                                                           |
| Cloudflare Realtime TURN | Yes, if Dovo manages credentials           | No, for authenticated WebRTC DTLS data channels                | First 1,000 GB/month free, shared across the Cloudflare account's SFU/TURN usage; then $0.05/GB egress. An allowance for the whole service, not per user.            |
| Metered Open Relay       | Yes, if Dovo manages credentials           | No, for WebRTC                                                 | Advertises 20 GB/month free; provider account and API credentials required.                                                                                          |
| Tailscale Funnel         | No                                         | Relays cannot decrypt; HTTPS terminates on the user's computer | Stable URL, but host Tailscale setup/account required. Personal free tier is for non-commercial use; bandwidth limits and beta status. Phone needs no Tailscale app. |
| Cloudflare Quick Tunnel  | Could be automated by bundling cloudflared | Yes: ordinary HTTPS terminates at Cloudflare                   | No account/domain, but temporary URL, no uptime guarantee, 200 in-flight requests, no SSE; intended for development/testing.                                         |
| ngrok free HTTPS         | No                                         | Yes: ordinary HTTPS terminates at ngrok                        | Provider account, 1 GB/month and 20,000 HTTP requests/month; raw TLS passthrough is paid.                                                                            |

Sources: [Cloudflare TURN](https://developers.cloudflare.com/realtime/turn/),
[Cloudflare pricing](https://developers.cloudflare.com/realtime/pricing/index.md),
[TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/),
[Metered Open Relay](https://www.metered.ca/tools/openrelay/),
[Funnel](https://tailscale.com/kb/1223/funnel), [Tailscale pricing](https://tailscale.com/pricing),
[Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/),
[ngrok free limits](https://ngrok.com/docs/pricing-limits/free-plan-limits).
