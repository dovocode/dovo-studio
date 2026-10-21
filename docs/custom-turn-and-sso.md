# Custom TURN and organization SSO

Dovo tries a direct WebRTC connection first. A TURN server provides an encrypted fallback when
networks block direct connections. Configure a relay on a computer once; its paired clients receive
fresh relay settings when reconnecting. Pairing codes and device tokens are still required for
account-free access. HTTP LAN/VPN connections, including Tailscale and NetBird, remain supported.

## Configure your own TURN server

1. Update the runtime, desktop/mobile app and Connect signaling broker to a version supporting
   custom relays. A self-hosted TURN server still uses Connect for signaling; TURN does not replace
   it.
2. Open the computer's settings: desktop **Devices & runtime**, or mobile **Computers → computer**.
   Use the local owner or a separately paired human client. Account-derived access and agent
   credentials cannot change relay settings.
3. In **TURN relay**, enter one or more standard TURN URLs, a username and password. Choose **Use
   custom TURN**, check the target computer, then confirm. Credentials are saved in that computer's
   private runtime database, separate from snapshots and ordinary settings responses.
4. On each internet connection, select **Computer / organization relay** under **Relay fallback**.
   Existing **Dovo relay fallback** connections also receive the computer's explicitly configured
   policy automatically. **Direct only** keeps relays disabled. LAN/VPN pairings need internet
   access enabled before WebRTC can be used; configuring TURN alone does not create an internet
   pairing or grant account access.
5. Reconnect. The connection label reports **Custom relay · TURN** only when the selected ICE route
   actually uses a relay. **Dovo Direct · WebRTC / STUN** means the direct route succeeded.

Examples (replace the hostname):

```text
turn:relay.example.com:3478?transport=udp
turn:relay.example.com:3478?transport=tcp
turns:relay.example.com:5349?transport=tcp
turn:[2001:db8::10]:3478?transport=udp
```

Ports and transport may be omitted: `turn:relay.example.com` defaults to UDP/3478 and
`turns:relay.example.com` to TLS over TCP/5349. TLS requires TCP and a valid certificate. A private
TURN address is allowed when both peers can reach it. Do not put passwords inside URLs. Use
dedicated relay credentials; configuring an OIDC password as a TURN password does not provide SSO.

For coturn, use long-term credentials (`lt-cred-mech`, a realm and a dedicated user) for manual
setup. Open the configured listener ports and a bounded UDP allocation port range, configure the
public IP when behind NAT, and set user/total allocation quotas and bandwidth limits. Block
loopback, multicast, link-local and internal peer destinations appropriate to your deployment. Keep
the configuration and credential files private. See [Internet connections](internet-connections.md)
for the managed coturn example and network requirements.

A minimal manual-credentials section in a private coturn configuration is:

```ini
realm=relay.example.com
fingerprint
lt-cred-mech
user=relay-user:REPLACE_WITH_A_DEDICATED_RANDOM_PASSWORD
listening-port=3478
tls-listening-port=5349
cert=/run/secrets/turn-fullchain.pem
pkey=/run/secrets/turn-private-key.pem
min-port=49160
max-port=49200
user-quota=8
total-quota=64
no-multicast-peers
no-cli
```

Use a publicly trusted certificate for `relay.example.com`, protect the file containing the
password, and open UDP/TCP 3478, TCP 5349 and UDP 49160–49200 on the host/firewall. Add
`external-ip=PUBLIC_IP/PRIVATE_IP` when required by your NAT topology, along with the peer-address
restrictions described above. Deploy coturn using your normal service/container management. For REST
authentication, replace `lt-cred-mech` and `user` with `use-auth-secret` and
`static-auth-secret=YOUR_RANDOM_MASTER_SECRET`; keep the listener, certificate and quota settings.
Do not combine both authentication modes.

**Use automatic relay** removes the manual override. An authorized organization policy then takes
precedence; otherwise authorized Dovo relay remains available. Changes apply on the next
negotiation. Static passwords must be rotated on the TURN server as well as in Dovo. Removing them
from Dovo does not invalidate copies already received by trusted paired clients.

## Configure organization OIDC and TURN

Organization administrators configure their own OIDC provider directly on their Dovo Connect broker.
The broker administrator installs the organization definitions; untrusted app requests cannot choose
an arbitrary issuer, declare membership, or register a provider. This initial implementation uses a
private configuration file rather than an organization administration UI.

1. Register an OIDC application at your organization's provider, with the exact callback
   `https://YOUR-CONNECT-HOST/auth/callback`. Enable authorization code flow, S256 PKCE and signed
   ID tokens (RS256 or ES256). A confidential client may use a backend-only `clientSecret` through
   `client_secret_post`; public clients can omit it. Dovo does not retain provider access/refresh
   tokens.
2. Restrict the provider application to the intended members. For a shared issuer, configure a
   signed group/role claim and `requiredClaim` below. Without it, every identity authorized by this
   issuer and client application is an organization member. Email domains, names and client-supplied
   organization IDs are never membership proofs.
3. Create a private JSON file on the broker host (for example
   `/run/secrets/dovo-organizations.json`, readable only by the service account) and mount it
   read-only into the Connect container. Set `DOVO_ORGANIZATIONS_FILE` to that container path. Do
   not commit real secrets.

```json
[
  {
    "id": "example-company",
    "name": "Example Company",
    "issuer": "https://sso.example.com/realms/company",
    "clientId": "dovo-connect",
    "clientSecret": "REPLACE_WITH_OIDC_CLIENT_SECRET_OR_REMOVE_FIELD",
    "requiredClaim": { "name": "groups", "values": ["dovo-relay-users"] },
    "sessionHours": 8,
    "hourlyLimit": 100,
    "relay": {
      "urls": [
        "turn:relay.example.com:3478?transport=udp",
        "turn:relay.example.com:3478?transport=tcp",
        "turns:relay.example.com:5349?transport=tcp"
      ],
      "secret": "REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS"
    }
  }
]
```

`issuer` must match discovery and signed tokens exactly, including any tenant/realm path. Discovery,
token, authorization and JWKS endpoints must use the issuer's origin. If the provider legitimately
uses other HTTPS origins, explicitly allow those origins with `endpointOrigins`, for example
`["https://login.example.com"]`. The callback never changes. `requiredClaim` matches one configured
value against a signed string or string-array claim. Configure your IdP to include that claim in the
ID token. Define up to 20 organizations, each with a unique stable `id`.

For coturn REST authentication, configure `use-auth-secret` and the same `static-auth-secret` as
`relay.secret`. Keep that master secret only on Connect and coturn. Connect generates credentials
valid for ten minutes, attributed to the installation; phones and paired runtimes never receive the
master secret. For an existing TURN service with static credentials, replace `secret` with
`"username": "relay-user", "credential": "relay-password"`. Static credentials cannot be revoked by
SSO sign-out alone; prefer REST credentials for organizations.

4. Restart/redeploy Connect with the file and environment setting. In Dokploy, preserve persistent
   volumes, environment and GitHub source; add the private file mount/environment variable to the
   existing Compose service. Organization secrets must stay outside the Git checkout. Check
   `/health`.
5. Sign in from desktop or mobile, compare the displayed code, and choose **Sign in with Example
   Company SSO** in the browser. Organization identities are isolated from personal Dovo accounts
   and from other organizations, even if providers use identical subject IDs. Servers remain private
   to the signed-in member; organization relay membership does not grant coworkers runtime access.
6. On each paired computer, enable **Dovo Connect + relay** and confirm that computer and account.
   This authorizes account access and organization relay policy for that installation. The computer
   supplies signed installation proofs; only its scoped host grant crosses the pairing, never the
   app's account session or SSO tokens. There are no manual installation-key approvals.
7. Leave **TURN relay** on **Automatic**. The computer receives the current organization policy
   while its account authorization is live. Paired clients that allow relay fallback receive fresh
   policy encrypted by their existing room secret at each negotiation; no re-pairing is needed. A
   manual custom TURN override is preserved until explicitly reset. The setting shows the supplying
   organization.

## Revocation and verification

Sign-out revokes that Dovo session and grants bound to it. Unlinking a computer or disabling Connect
revokes that computer's account access. Normal LAN/VPN pairing is separate and remains available.
Organization policy is usable for new negotiations only while the runtime's short broker lease is
live. Credentials already issued expire within ten minutes; established account tunnels are also
subject to runtime grant checks. Static TURN passwords require separate server-side rotation. Relay
issuance outages or quotas leave account authorization and direct access available.

Organization sessions require SSO again after `sessionHours` (15 minutes to eight hours; default
eight). IdP membership changes are rechecked at sign-in. IdP logout/SCIM/back-channel revocation is
not integrated; for immediate revocation, revoke the Dovo session/unlink the computer as well.
Removing an organization or changing its issuer, client ID, membership rule, endpoint allowlist or
session duration invalidates its existing sessions when Connect restarts. Rotating TURN credentials
updates policy automatically without changing runtime identity or pairings. Deleting an
organization-signed-in Dovo account removes its Dovo data/grants, not the externally managed company
identity.

Verify sign-in from desktop and mobile, enable a paired computer, and check that its setting names
the expected organization. Test a direct route and a restricted network that requires TURN; inspect
the actual connection label, not just gathered relay candidates. Test UDP, TCP and TLS listeners,
credential rotation, Dovo sign-out/unlink, SSO expiry, a denied group, another organization, and
Wi-Fi/cellular handover. Keep usernames/passwords, ID tokens, callback query strings and host grants
out of logs and screenshots. A healthy broker alone does not prove TURN traffic works.
