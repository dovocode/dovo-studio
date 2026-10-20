# Optional Dovo accounts

Casdoor at `https://auth.dovo.studio` provides optional sign-in. The separate connect service at
`https://connect.dovo.studio` stores each account's linked computer IDs, names and HTTP/HTTPS
addresses. It does not proxy runtime traffic or store runtime/device tokens, pairing codes,
workspaces, project contents or LLM provider credentials. Optional managed push also stores the
phone’s native push token and grants scoped to its account session and individual paired computers;
see [Mobile notifications](notification-relay.md).

Account-free [internet pairing](internet-connections.md) also uses Connect for transient WebRTC
signaling and optional temporary TURN credentials. Relay fallback is opt in: direct, Cloudflare or
Dovo relay. Connect never proxies runtime content or receives device tokens; the separate Dovo TURN
service carries ciphertext only when explicitly selected. Notification relay behavior remains
separate and unchanged.

In desktop **Devices & runtime**, or mobile **Computers**, choose **Sign in**, compare the displayed
code with the browser, and continue through Casdoor. Studio saves its account session in the system
keychain (Electron safeStorage or Expo SecureStore). Account sessions last 30 days. Signing out
revokes that device's account session; it does not revoke existing runtime pairings or other
signed-in devices. Existing direct connections remain usable without signing in, including while the
account service is unavailable.

Choose **Link … to account** for a paired, connected computer. Select a reachable LAN/VPN address
when more than one is advertised; loopback addresses cannot be published. Linking is explicit and
per account; metadata is never a proof of runtime ownership or access. Other devices signed into
that account can see the computer and choose **Pair computer**, which fills the existing pairing
form's address. Generate a fresh pairing code on that computer and approve the new device as usual.
Unlinking removes it from the account directory; manage trusted device access on the computer
itself.

## Connect service

The service is split by responsibility: `main.ts` owns startup and shutdown; `server.ts` composes
HTTP handling and request limits; `browser-auth.ts` handles browser confirmation and OAuth
callbacks; `account-api.ts` handles app sessions and linked computers. Shared HTTP helpers live in
`http.ts`, the request limiter in `rate-limit.ts`, Casdoor token verification in `oidc.ts`, and all
SQLite queries in `store.ts` and `push-store.ts`. Managed delivery routes live in `push-api.ts`;
`push-relay.ts` forwards to the private notification relay.

`apps/connect-server` uses Node 24 SQLite with a persistent, private `/data/private` directory. Its
SQLite database and WAL must remain on persistent storage. Database writes are account-scoped;
server IDs are unique within an account, not globally claimed by a user. Addresses may use HTTP for
LAN/VPN. The service never fetches a linked address.

Casdoor's public client is `30793ba9efd8e96893a9`; the exact broker callback is
`https://connect.dovo.studio/auth/callback`. The native `dovo://oauth/callback` allowlist entry is
retained but this flow does not require app callback handlers or OIDC secrets in clients.

The app receives a random login ticket and a five-minute browser URL. The browser shows the matching
code before opening Casdoor. Browser cookies, origin checks, OAuth state, S256 PKCE, an OIDC nonce,
and signed ID-token issuer/audience/expiry verification bind the approval to that login. The
approved ticket becomes the device's account session. Only hashes of tickets and account sessions
are stored. Casdoor access/refresh tokens are not retained. Expired pending logins and sessions are
pruned. Sessions can be revoked with `DELETE /v1/session`, including cancellation of an unfinished
login.

The public `/v1` API uses bearer authorization without cookies. Browser flow cookies are HttpOnly,
SameSite=Lax and Secure in production. Response bodies and authentication URLs must not be logged by
an ingress; keep access logs restricted and avoid retaining query strings for `/auth/callback`.

Configuration:

- `DOVO_CONNECT_ORIGIN`: externally reachable origin, default `https://connect.dovo.studio`.
- `DOVO_ACCOUNT_ISSUER`: trusted Casdoor issuer, default `https://auth.dovo.studio`.
- `DOVO_ACCOUNT_CLIENT_ID`: public OIDC client ID above.
- `DOVO_CONNECT_DATA`: private persistent directory, default `/data`.
- `DOVO_NOTIFICATION_RELAY_URL` and `DOVO_NOTIFICATION_RELAY_TOKEN`: optional private notification
  relay connection for managed push. Keep these on the backend; never put the shared key in the app.
- `DOVO_CONNECT_TRUSTED_PROXIES`: optional comma-separated proxy IPs/CIDRs. Configure the actual
  immediate ingress/proxy hop (and any additional proxy hops) for Dokploy; leave empty for direct
  access. Only trusted hops may supply `X-Forwarded-For`; the first untrusted address from the right
  is the client. Never trust arbitrary client-provided forwarding headers or an unnecessarily wide
  network. Anonymous requests are limited by this address; verified sessions share their account's
  quota and delivery grants have individual quotas, so users behind the proxy don't block each
  other.
- `PORT`: HTTP listener, default `8080`.

Build with `pnpm --filter @dovo/connect-server... -r build`, or use its Dockerfile. The included
Compose file binds port 8081 to loopback for a local ingress. Dokploy should route its configured
domain to container port 8080. Health is `GET /health`. Account-free runtime and notification relay
health are independent of this service.

Back up SQLite with a consistent online backup or `VACUUM INTO` from a separate SQLite connection;
do not copy only the live database while ignoring its WAL. Keep backups private and include the
Compose/environment configuration. Connect/SQLite and Casdoor/PostgreSQL have daily private local
backups with 14-day retention and verified isolated restores. Connect backups also retain the
deployed source archive for recovery. Off-host backup storage remains to be configured.

The deployed Casdoor application currently accepts administrator-provisioned users. Self-service
signup is disabled, and no email provider is configured for email verification or password recovery.

## Account deletion

The signed-in account panel supports permanent deletion with confirmation. Configure the
backend-only Casdoor deletion credentials and organization described in
[mobile store disclosures](mobile-store-disclosures.md#account-deletion). Deletion removes the
hosted identity, all Connect sessions, linked metadata and managed grants; separate runtime pairings
and workspace files remain. Identity-provider failures block ordinary account access and delivery
while keeping the deletion operation retryable. Do not deploy a client promising working deletion
before configuring and verifying the backend on a disposable account.
