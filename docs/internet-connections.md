# Internet connections

For your own TURN server or organization OIDC and automatic relay distribution, see
[Custom TURN and organization SSO](custom-turn-and-sso.md).

In desktop **Settings → Devices & runtime → Dovo account**, sign in and check **Enable Dovo
Connect**. On iPhone or Android, sign in to the same Dovo Studio account under **Computers**, then
choose **Connect** beside the computer. No device pairing code, phone approval, VPN, port forwarding
or external network account is required for this account-authorized internet connection.

Enabling Dovo Connect explicitly grants devices signed in to that account access to files, agents
and terminal commands on this computer. The checkbox also permits the encrypted Dovo TURN fallback
when WebRTC + STUN cannot establish a direct internet path. Notifications and Live Activities keep
their existing delivery behavior. Both clients and the Connect service need updated builds.

You can also enable it for an already paired server: on desktop open that computer's settings under
**Devices & runtime**, or on mobile open **Computers → your computer**. Choose **Enable Dovo
Connect + relay**, sign in, and confirm the named computer and account. A trusted, separately paired
device can grant this access without a second approval on the server. This confirmation grants
same-account devices full runtime access and permits encrypted TURN fallback. Mobile saves the
account connection alongside its existing LAN / VPN pairing. Older servers show an update notice.
Account-derived connections and agent credentials cannot use this setup flow.

**LAN / VPN pairing remains separate and account-free.** Use **Pair LAN / VPN device** on desktop
and scan its code on the phone. An internet-connected phone can add that pairing with **Computers →
your computer → Pair LAN / VPN**. A separately paired connection is preferred; Dovo Connect is used
only when its verified LAN / VPN addresses cannot be reached. Both credentials stay separate. Adding
either connection preserves the computer entry and its chat grouping. Route selection happens before
a request is sent; an uncertain mutation is never replayed on the other transport.

Once the internet fallback is selected, LAN/VPN discovery runs in the background at most once every
ten seconds per route purpose. Unreachable LAN addresses do not pause traffic on the tunnel. Only a
matching runtime descriptor can restore LAN preference. Requests retain their selected endpoint and
credential; ticketed sockets retain the transport that issued their ticket even if LAN recovers
before the response arrives.

For a headless server, run `dovo-server connect on` through SSH and open the printed sign-in URL in
your browser. Verify its confirmation code, then sign in to the same account on your phone.
`dovo-server connect status` reports availability; `dovo-server connect off` disables internet
access and preserves separate pairings. In a source checkout use `pnpm pair internet on|off|status`.
The runtime stores a restricted installation grant, never the full account session. That grant
expires with the account session (currently 30 days), after which enable Connect again.

## Connection mode

Each computer exposes **Connection mode** in its TURN relay settings on desktop and mobile.
**Automatic** tries WebRTC/STUN with an authorized TURN fallback. **WebRTC/STUN · no TURN** disables
relay issuance and relay negotiation. **LAN / VPN only** stops new WebRTC connections; connect using
an HTTP or optional HTTPS LAN/VPN address instead. No account is needed for LAN/VPN pairing.
Existing sessions stay open until they reconnect, so changing modes from a phone can finish saving.
The setting persists on the computer and is shared with paired clients. Pairing credentials and
custom TURN configuration are retained when changing modes.

Mobile's **Custom TURN server** fields are collapsed by default. Open them to configure a relay. The
computer's shared SSH address is edited as separate **SSH user**, **SSH host**, and **SSH port**
fields; it is still shared as an SSH URL for checkout-copy dialogs. SSH keys remain local.

## Authorization and encryption

Each runtime generates its signing and encryption private keys locally. The local owner or an
explicitly confirmed, separately paired client requests a registration bound to its runtime ID,
encryption key, Connect origin, current account session and a one-minute timestamp. Connect pins
those keys for that account's installation; replacing keys requires unlinking the old installation.
A manually linked LAN address grants no internet access. The phone obtains the public encryption key
from the authenticated account directory and sends a fresh public key. The runtime seals its
per-device bearer token and tunnel configuration using authenticated X25519/XSalsa20-Poly1305
encryption (TweetNaCl), bound inside the ciphertext to the runtime ID and connection request.
Connect stores and forwards only ciphertext and public connection metadata. The private phone key
stays in memory until setup finishes; its connection credentials are saved in the phone's secure
registry.

Remote setup sends only the account session's hash to the paired runtime. The signed registration is
exchanged by the client directly with Connect; the full account session never goes to the remote
runtime. The runtime accepts only an installation-scoped grant with matching runtime ID, signing
key, encryption key and session hash. Setup is single-use, expires after one minute, is bound to the
requesting device, and rechecks device revocation after the broker response. Disabling Connect also
cancels pending setup. Account sign-out and unlinking continue to revoke the resulting grant.

The account directory is the authority for first-time device access and public-key distribution.
This protects content from ordinary signaling and TURN relays; it does not remove trust in the
account authentication/directory service. Account IDs, computer names, public keys, IP candidates,
connection timing and opaque session identifiers are visible to the corresponding services. Existing
notification content remains governed by its separate notification settings.

Runtime traffic uses authenticated WebRTC DTLS data channels. Both complete SDP descriptions
(including fingerprints and ICE credentials), roles, nonce, offer binding and relay choice are
HMAC-authenticated with the encrypted configuration secret. Account credentials work only in their
own internet room; they cannot authorize ordinary LAN/VPN HTTP or WebSocket access. A separate
LAN/VPN pairing issues its own device credential.

Signing out of the phone removes its account connection, without removing a separate pairing.
Signing out on the host, deleting the account, unlinking the installation, disabling Connect or
revoking an internet device prevents further access. The host refreshes authorization every three
seconds and its internet rooms fail closed after a twelve-second lease if Connect cannot be reached.
Existing tunneled sockets close as authorization is removed. Device revocation also blocks reissuing
access to that phone's current account session; a new sign-in authorizes a new session. Local
disablement closes access immediately even if the directory is unavailable. In that case, an offline
directory entry may remain until it can be unlinked.

Connect checks the current account grant before accepting installation proofs, completing joins
(including after asynchronous relay issuance), or forwarding offers, answers and ICE candidates. Its
background revocation sweep only cleans up idle signaling sockets; active operations do not wait for
it. Account installation proofs do not depend on a legacy approval callback or approved-key list.

On the phone, an ephemeral loopback listener carries existing HTTP, WebSockets, images, files and
WebViews over the same peer connection. On the computer, the only tunnel destination is an ordinary
runtime listener on loopback: it cannot forward arbitrary ports or use desktop-only routes. All
runtime authorization checks remain in place. Server-owned tunnel provenance denies local-only
Studio APIs and binds authenticated HTTP/WebSocket access to the paired device. Unknown local
connections to that dedicated listener are refused; forwarded headers cannot override provenance.
Stream credits bound buffering in both directions. Connections close when mobile backgrounds and the
selected internet computer starts reconnecting as soon as it returns, sharing negotiation with
normal requests. Explicit LAN/VPN profiles keep their existing route preference. A temporary ICE
disconnect has a ten-second recovery window before the tunnel and its sockets close. Failed ICE or a
closed readiness channel closes them immediately. Wi-Fi/cellular changes and network loss discard
old tunnels and pending negotiations; live sync cancels its previous ticket request and reconnects
immediately when connectivity returns or the connected network changes. Repeated events for the same
connected network keep the tunnel. Cancellation and the setup deadline also interrupt pending native
operations and ICE gathering. Uncertain mutations retain their existing idempotency/recovery
behavior; transport reconnect does not replay them. Native background notification replies cannot
establish WebRTC while JavaScript is suspended; unconfirmed answers stay saved for review in Dovo.

Updated phone, runtime and Connect builds negotiate **trickle ICE**: the signed offer and answer are
sent without waiting for STUN/TURN discovery to finish. Both endpoints exchange candidates as they
arrive and start connectivity checks immediately. Each candidate and end marker has its own HMAC,
bound to the exact offer, session, sender role and ordered sequence; replayed or altered candidates
are rejected. Each direction is limited to 128 candidates and one end marker. Signaling closes once
the encrypted readiness channel opens; application traffic still travels only over WebRTC. An older
endpoint or Connect service uses the existing complete-SDP negotiation automatically.

The runtime gathers TURN alternatives concurrently, including UDP, TCP and TLS. It selects at most
four distinct configured URLs, covering each offered transport before additional endpoints, with
each server's own credentials. An unreachable first URL no longer prevents other transports from
connecting. This allocation limit bounds relay usage; a single configured UDP URL retains the
library's existing TCP fallback. STUN and direct connectivity checks continue alongside TURN.

The computer probes its signaling WebSocket every five seconds and requires the matching pong within
ten seconds. A half-open socket is replaced without waiting for the broker to notice. Reconnection
starts with 250–500 ms jitter and backs off to 15–30 seconds during repeated failures; thirty
seconds of stable admission resets that backoff. Signaling recovery leaves established encrypted
tunnels running, and disabling internet access or revoking a pairing stops retries.

New endpoints also authenticate a larger transfer window: up to 64 × 16 KiB frames (1 MiB) per TCP
channel, compared with the legacy eight frames (128 KiB). This reduces waiting for acknowledgments
on higher-latency connections. Receivers acknowledge only after their destination socket accepts the
write; outstanding writes and queued bytes remain bounded. It does not change a relay's network
latency or bandwidth limit, or keep an iOS app running in the background.

Some CGNAT, symmetric-NAT and corporate networks need TURN. Direct-only connections report failure
rather than switching to a relay or advertised LAN routes. TURN supports UDP and TCP/TLS. Set
`DOVO_TURN_TLS_PORT` to a dedicated port (443 on a dedicated host, or 5349/8443 alongside an
existing HTTPS ingress). UPnP is not used. Keep Dovo running and the computer awake. Existing
HTTP/HTTPS LAN and VPN pairing remains available separately, including Tailscale/NetBird.

Mobile verifies a new account connection or an upgraded peer route using the authenticated
`/api/snapshot?scope=overview` response, then loads subscribed threads with paged history. The
initial identity check must not download the legacy full snapshot: a computer with extensive history
can otherwise complete WebRTC setup but exceed the mobile request deadline.

The mobile computer overview and connection settings show the active transport: **Dovo Direct**
(WebRTC / STUN), **Dovo Connect** (TURN), or **Private** (LAN / VPN). WebRTC checks the selected ICE
pair at both ends; merely enabling relay fallback does not mean it is in use. Missing native stats
show an unknown route, and offline computers have no active transport label. If live updates use a
different path from HTTP requests, both paths are shown. Private groups explicit LAN and VPN
connections; it does not infer the presence of a VPN from an IP address.

## Connection health and diagnostics

In desktop **Settings → Devices & runtime → Runtime readiness & recovery**, expand **Internet
connection diagnostics**. It shows signaling availability and the latest 20 connection attempts,
including setup stage, observed direct or TURN route, round-trip time, candidate counts and the
reason a connection closed. Use **Refresh** for a new snapshot. Attempts are kept only in memory
until the runtime restarts. Diagnostics omit candidate addresses, raw SDP, ICE passwords, pairing
secrets and relay credentials.

New attempts also show the negotiation mode, time to send the answer and time until the encrypted
readiness channel opens. These timings start when the runtime accepts the offer; they exclude phone
startup and the initial Connect join. The heartbeat round-trip includes application scheduling and
is not a pure network latency measurement. Older runtimes omit these additional fields.

Local candidates describe available interfaces; STUN candidates describe discovered public routes;
TURN candidates describe available relay allocations. Gathering a TURN candidate does not mean it
was selected. The route label comes from the selected ICE pair. An unknown route is reported when
statistics are unavailable rather than assuming direct or relayed traffic.

Updated clients negotiate lightweight health probes over the encrypted data channel. A connected
tunnel that stops responding is closed within about 25 seconds so the normal connection flow can
replace it. Older clients remain compatible without probes. Temporary ICE interruptions retain the
existing 10-second recovery window. iOS inactive transitions such as Control Center and Face ID
preserve the tunnel; backgrounding closes it, and returning to the foreground or restoring the
network notifies connection subscribers immediately. Offline requests fail promptly without waiting
for a new WebRTC setup timeout. Interrupted mutations are not replayed automatically.

The current desktop WebRTC implementation uses only the first STUN endpoint and first TURN endpoint
from its configuration; Dovo prioritizes TLS TURN, preferring port 443. Multiple advertised URLs are
not desktop endpoint failover. Diagnose each transport independently with the relay checks below.

## Operating Connect

See [Custom Connect and artifact store](self-hosting.md) for deployment commands, shared sign-in and
selecting your Connect endpoint in desktop/mobile Settings.

The runtime makes an outbound WSS connection to `/v1/peer` at `https://connect.dovo.studio`. Choose
another HTTPS signaling origin in **Settings → Devices & runtime → Dovo services** (**Settings →
Devices** on mobile). Explicit Connect setup saves that origin on the runtime; already-enabled
computers keep their broker until disabled and enabled again. `DOVO_CONNECT_ORIGIN` supplies the
initial/headless default before first startup. Loopback HTTP is accepted only for local integration
testing. The reverse proxy must forward WebSocket upgrades and allow idle connections longer than
the 25-second heartbeat. Use one signaling instance: room state is bounded, ephemeral and in memory,
and is not replicated between processes. Account-authorized connections require a signed-in session
and explicit owner enablement. Legacy QR-based internet pairing and operator-approved relay
installations remain supported for existing connections. Do not log WebSocket bodies or pairing
links. Set `DOVO_CONNECT_TRUSTED_PROXIES` to the exact immediate proxy address after verifying that
proxy sanitizes client-supplied forwarded headers. Never trust all private networks or arbitrary
`X-Forwarded-For` values. With no trusted proxy configured, forwarded headers are ignored safely,
but clients behind one proxy share its connection and request limits. Recheck the address when a
container changes networks.

There are no media capture permissions for this transport: it uses data channels only. Mobile
requires a new native build containing `react-native-webrtc` and `react-native-tcp-socket`; an
over-the-air JavaScript update alone is insufficient. Desktop/runtime WebRTC uses the portable
TypeScript `werift` implementation, avoiding another native desktop binary.

## Relay operations

Connect offers no relay until its backend is configured. Set secrets in the operator's private
Connect environment (see `apps/connect-server/.env.example`); never put them in app builds or
pairing links. A partial configuration fails startup rather than silently publishing unusable
credentials. A malformed TURN URL, unsupported transport, invalid port or more than eight URLs fails
Connect startup, using the same URL validation as the clients.

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

Account-enabled installations use their active account-scoped grant plus a proof of their pinned
installation key for relay admission. For legacy account-free installations, configure
`DOVO_RELAY_APPROVED_KEYS` with a comma-separated list of public approval keys. An empty list denies
legacy relay grants; it does not disable account-authorized installations. Each runtime stores its
own Ed25519 private installation key locally. It signs a fresh, single-use broker challenge bound to
its room and both signaling capabilities, the Connect origin and the computer's relay consent;
approval cannot be obtained by copying a public key or replaying an old proof. An unapproved
installation can still use direct WebRTC without an account. Removing a key and restarting Connect
blocks new grants for that installation; previously issued grants expire within ten minutes. To
invalidate all outstanding grants immediately, rotate the private coturn shared secret, restart
coturn to close existing allocations, and configure the matching new secret on Connect. Keep
issuance disabled throughout that operation.

Connect issues standard coturn REST credentials: an expiring, randomized username and its HMAC-SHA1
password. Approved installations share cached grants across their rooms and TURN usernames include a
truncated hash for operator attribution. The public installation key itself is not a TURN username.
Per-installation issuance limits avoid treating phones behind one carrier NAT as one user. The
shared secret never leaves the backend. The template rejects private, loopback and multicast peer
destinations, disables the admin CLI and TCP relay allocations (TURN over TCP/TLS remains enabled),
and limits allocations/bandwidth. Adjust those limits to the operator budget. Coturn cannot decrypt
the inner DTLS/SCTP traffic. Credentials last at most ten minutes; clients refresh relayed
connections before expiry through fresh authenticated negotiation. A verified direct route stays
connected when unused relay credentials expire. If the selected route switches to an expired relay,
or cannot be verified at expiry, the tunnel closes to obtain fresh credentials. Endpoints are pinned
to `turn.dovo.studio` by default. Self-hosted runtimes can set comma-separated
`DOVO_PEER_RELAY_HOSTS`; these pins travel in the out-of-band QR and secure phone registry, not
broker-supplied metadata. Dovo still pays its host/network costs. Approved participants can reuse
standard TURN bearer credentials until they expire; approvals should therefore be issued only to
trusted installations. Rate limits, allocation/bandwidth ceilings and the hard shared quota remain
necessary. The 100-port relay range also bounds concurrent allocations; the higher configured
allocation quota does not expand that range. Coturn caps an allocation's granted lifetime at ten
minutes, but credential removal alone does not terminate an existing allocation immediately. The
credential refresh window can briefly overlap two usernames, so the eight-allocation quota per
username permits up to sixteen allocations for one installation during that overlap.

The default bandwidth limits are 10 Mbps per allocation and 500 Mbps total, separately in each
direction. Coturn reserves each allocation's bandwidth even while it is idle, so these settings
permit 50 simultaneous allocations. A client can gather several relay candidates, and a relayed
connection can use allocations on both endpoints; this is not a 50-device limit. Exhausting this
reservation returns TURN error 486, "Allocation Bandwidth Quota Reached", even when actual traffic
is low. The hard daily egress budget below still applies.

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
checks. Set `DOVO_TEST_TURN_BINARY` to a local coturn `turnserver` binary to additionally force UDP,
TCP and TLS relay paths using real expiring REST credentials. The test server binds only loopback.
The main CI check installs coturn and requires these forced relay checks on every change. The TLS
fixture requires OpenSSL, generates a temporary certificate and trusts it only inside the test
process and its local fixture browser. Deployed relay checks retain normal certificate validation.
Mobile TCP and UI native boundaries are adapted in Chromium; it is not a physical-device test.

Set `DOVO_TEST_CONNECT_ORIGIN=https://connect.dovo.studio` to test the deployed signaling broker and
relay. The browser check verifies direct, UDP, TCP and TLS paths independently. Set
`DOVO_TEST_CONNECT_MODES=direct` to check signaling while relay credential issuance is disabled, or
choose a comma-separated subset of the advertised transports. For deployed relay checks, use
`DOVO_TEST_PEER_DATABASE` to retain the test installation's identity across protocol checks,
explicitly approve that public key on Connect, then remove its approval when testing is complete.
Never copy the installation private key to Connect. This browser fixture uses the legacy,
account-free admission path. A legacy pairing probe without an account grant does not test
account-authorized relay access; its missing-approval warning is not evidence that signed-in access
is broken. Signed-in installations use their active account grant and fresh installation proof,
without adding keys to `DOVO_RELAY_APPROVED_KEYS`.

The runtime `account-internet.test.ts` integration suite covers the signed-in phone request,
encrypted connection delivery, Dovo TURN issuance without legacy approval configuration, runtime
restart, and account revocation. Check credential issuance separately from relay payload traffic; an
issued TURN credential alone does not establish that a native connection works.

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
