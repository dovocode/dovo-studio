# Optional Dovo accounts

Dovo Connect hosts GitHub sign-in using Better Auth at `https://connect.dovo.studio`. Accounts are
optional: pairing codes, device tokens and HTTP LAN/VPN connections still work without an account.
Organization-owned OIDC and automatic relay distribution are documented in
[Custom TURN and organization SSO](custom-turn-and-sso.md).

Connect stores account profiles, linked computer metadata and scoped access grants. It does not
receive runtime/device credentials, workspace content or LLM provider credentials. Account-based
runtime setup requires explicit owner or paired-device consent and installation identity proofs.
Optional TURN carries encrypted traffic; it does not replace those checks. Hosted artifacts use
separate, restricted grants; signing in to artifacts never authorizes access to computers.

## Sign in on desktop and mobile

Choose **Sign in**, compare the code displayed by Studio with the browser, then continue to GitHub.
The app polls a five-minute, browser-bound login request; it does not need a provider secret or a
native OAuth callback. Studio saves its resulting Dovo session in Electron safeStorage or Expo
SecureStore. Dovo app sessions last up to 30 days; artifact-only sessions last up to eight hours.

The Better Auth browser session is separate from Dovo device and artifact capabilities. Browser
cookies alone cannot call the `/v1` account API. Signing out in Studio revokes that device's Dovo
session and its dependent grants. Other sessions and independently paired LAN/VPN access remain.
Existing connections do not depend on the hosted identity service for every request.

Enable **Dovo Connect** on a trusted computer to authorize same-account access and optional relay
fallback. A directory entry alone proves no ownership. Account-derived connections cannot grant
owner consent or change the computer's relay settings. See
[Internet connections](internet-connections.md).

## Configure GitHub and Better Auth

1. Register a GitHub OAuth App under
   [GitHub developer settings](https://github.com/settings/developers). Use homepage
   `https://connect.dovo.studio` and authorization callback
   `https://connect.dovo.studio/api/auth/callback/github`. GitHub sign-in requests `read:user` and
   `user:email`; repository permissions are not required. Use a separate OAuth app for localhost.
2. To enable optional hosted sign-in, configure these backend-only values in the private Connect
   environment file:

   ```dotenv
   DOVO_CONNECT_ORIGIN=https://connect.dovo.studio
   DOVO_AUTH_SECRET=REPLACE_WITH_A_RANDOM_PERSISTENT_32_BYTE_OR_LONGER_SECRET
   DOVO_AUTH_GITHUB_CLIENT_ID=YOUR_OAUTH_CLIENT_ID
   DOVO_AUTH_GITHUB_CLIENT_SECRET=YOUR_OAUTH_CLIENT_SECRET
   DOVO_CONNECT_DATA=/data/private
   ```

   Generate the auth secret with `openssl rand -base64 48`. Keep the same value across restarts;
   rotating it invalidates browser sessions and affects stored OAuth token encryption. Never put
   these values in mobile/desktop builds, Git, screenshots or support logs. Leave all three auth
   values unset to run an account-free signaling broker. A partially configured identity provider
   fails startup with a configuration error; it never silently switches authentication methods.

3. Keep both `accounts.sqlite` and `identity.sqlite`, including their WAL files, on persistent
   private storage. Better Auth owns identity, OAuth accounts and browser sessions in
   `identity.sqlite`; Connect retains its device-specific account and artifact capabilities in
   `accounts.sqlite`. Startup applies Better Auth's SQLite migrations before accepting requests.
   Back up both databases consistently with SQLite's backup API and verify restores before
   upgrading.
4. Build with `pnpm --filter @dovo/connect-server... -r build`, or the existing Dockerfile. Dokploy
   builds `dovocode/dovo-studio` branch `main` using `apps/connect-server/compose.dokploy.yaml`.
   Preserve the existing data volume, private notification relay network and TURN environment file.
5. Verify `/health`, real GitHub sign-in on desktop/mobile, sign-out, artifact-only access and
   account deletion before retiring the previous identity service. Do not remove its data or backups
   merely because the new service starts.

The production environment file is `/etc/dokploy/secrets/dovo-studio-connect/connect.env`, outside
the checkout. The existing external `dovo-studio-connect-data` volume is retained. APNs/Firebase
keys and the TURN master secret remain separate, private files and mounts. Build with
`compose up -d --build --wait`, preserving the existing project name and domain routing.

### Preserve existing ownership when moving from the previous identity provider

No legacy authentication mode is retained. Existing Dovo device sessions can continue until revoked
or expired, but new sign-ins use GitHub. To preserve an existing owner's computers, artifact
invitations and publications, independently verify that person's **numeric GitHub user ID** and
existing Dovo account ID. Store an explicit mapping in a private JSON file on the persistent volume:

```json
[{ "githubId": "3958086", "accountId": "EXISTING_DOVO_OWNER_ID" }]
```

Set `DOVO_AUTH_OWNERS_FILE=/data/private/auth-owners.json`. Keep the mapping after migration: it
assigns the verified GitHub subject the original, stable Dovo owner ID. Duplicate IDs are rejected.
Never infer ownership from matching email addresses, display names, or there being only one user.
Unmapped GitHub identities receive a new isolated Dovo owner ID. An operator should verify artifact
ownership and the computer directory after the first sign-in. No old account, artifact or pairing
needs to be deleted to move identity providers.

## Security boundaries

Better Auth handles GitHub OAuth state, PKCE, encrypted stored OAuth tokens and HttpOnly browser
cookies. Dovo additionally binds each login to its initiating browser and code confirmation, checks
request origins, consumes callback state once and issues a separate scoped device grant. Automatic
provider account linking is disabled. Browser-session cookie caching is disabled so revoked browser
sessions cannot complete a pending Dovo sign-in from a cached identity.

The public `/v1` API uses bearer authorization, without cookies. Production cookies use Secure and
SameSite=Lax. Keep authentication request bodies and callback query strings out of ingress logs.
Keep `DOVO_CONNECT_TRUSTED_PROXIES` limited to actual proxy hops; anonymous limits otherwise use the
socket address. `PORT` defaults to 8080. HTTPS protects the hosted service; it is not required for
private runtime LAN/VPN addresses.

Organization OIDC remains separate from personal GitHub identities, with issuer/client validation,
signed membership claims, bounded sessions and explicit relay policy. Changing organization policy
invalidates those sessions and their dependent relay access.

## Account deletion

The account panel requires explicit confirmation. `DELETE /v1/account` derives its target from the
Dovo bearer session and ignores caller-supplied IDs. The service first blocks account access and
in-flight approvals, then deletes the Better Auth identity, OAuth account and browser sessions, and
removes Dovo sessions, directory links and dependent grants. Failed deletion remains retryable. A
non-reversible deleted-identity marker rejects stale approvals. Local runtime pairings and workspace
files are independent; deleting Dovo does not delete the user's GitHub account.

Organization identity deletion removes the Dovo account and grants, without deleting an account in
the organization's identity provider. Hosted publication retention is covered separately in
[Hosted artifacts](hosted-artifacts.md). Keep backups private and respect the configured retention.
