# Optional Dovo accounts

A separate Dovo Auth service hosts GitHub sign-in using Better Auth at `https://auth.dovo.studio`.
Dovo Connect consumes its signed OIDC identity tokens; it does not host Better Auth. Accounts are
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

## Configure the separate Auth service

Auth and Connect are independently deployed services, with separate containers, persistent volumes,
private environment files and browser cookies. Auth owns GitHub credentials, signing keys, OAuth
accounts and browser sessions. Connect owns runtime/account capabilities and the computer directory.
Neither service mounts the other's database. Artifact access continues to use Connect's restricted
sharing capabilities; artifacts never receive GitHub tokens or Auth cookies.

1. Register a GitHub OAuth App under
   [GitHub developer settings](https://github.com/settings/developers). Set homepage
   `https://auth.dovo.studio` and callback `https://auth.dovo.studio/api/auth/callback/github`
   (replace the earlier Connect callback). Only `read:user` and `user:email` are required. Use a
   separate app for localhost.
2. Create `/etc/dokploy/secrets/dovo-studio-auth/auth.env` privately on production:

   ```dotenv
   DOVO_AUTH_ORIGIN=https://auth.dovo.studio
   DOVO_AUTH_DATA=/data/private
   DOVO_AUTH_SECRET=REPLACE_WITH_A_PERSISTENT_RANDOM_SECRET
   DOVO_AUTH_CONNECT_CLIENT_ID=dovo-connect
   DOVO_AUTH_CONNECT_CLIENT_SECRET=REPLACE_WITH_A_SEPARATE_RANDOM_CLIENT_SECRET
   DOVO_AUTH_SERVICE_KEY=REPLACE_WITH_A_SEPARATE_RANDOM_SERVICE_KEY
   DOVO_CONNECT_ORIGIN=https://connect.dovo.studio
   DOVO_AUTH_OWNERS_FILE=/data/private/auth-owners.json
   ```

   Generate each secret independently with `openssl rand -base64 48` (minimum 32 characters). Keep
   the Auth secret persistent: it encrypts stored OAuth tokens and browser cookies. Auth registers
   exactly one operator-controlled OIDC client, requiring S256 PKCE and the exact Connect callback.
   Dynamic registration and user-managed clients are disabled. Changes to the configured Connect
   client secret and callback take effect when Auth restarts.

3. Deploy `apps/auth-server/compose.dokploy.yaml` from GitHub `main` as a **separate Dokploy
   service**. In its **Environment** tab, set `DOVO_AUTH_GITHUB_CLIENT_ID` and
   `DOVO_AUTH_GITHUB_CLIENT_SECRET`, save, then click **Deploy**. The Compose file forwards those
   two Dokploy values into Auth, overriding the host file; keep the other secrets in the private
   host file above. Auth deliberately refuses startup until both OAuth fields are filled in. Route
   `auth.dovo.studio` to `auth:8080` with HTTPS. It uses its own `dovo-studio-auth-data` volume.
   Build locally with `pnpm --filter @dovo/auth-server... -r build`, or use
   `apps/auth-server/Dockerfile` with repository-root context. Startup applies SQLite migrations.
   Verify `/health` and `/api/auth/.well-known/openid-configuration` before enabling Connect.
4. Configure Connect's private environment file separately:

   ```dotenv
   DOVO_AUTH_ISSUER=https://auth.dovo.studio/api/auth
   DOVO_AUTH_CONNECT_CLIENT_ID=dovo-connect
   DOVO_AUTH_CONNECT_CLIENT_SECRET=SAME_CONNECT_CLIENT_SECRET_AS_AUTH
   DOVO_AUTH_SERVICE_KEY=SAME_SERVICE_KEY_AS_AUTH
   ```

   Connect does **not** receive `DOVO_AUTH_SECRET`, GitHub OAuth credentials or the ownership
   mapping. Remove the old GitHub placeholders from Connect when moving them into Auth. Leave
   `DOVO_AUTH_ISSUER` unset for account-free signaling. Configuring an issuer without both keys
   fails startup. The service key authorizes identity deletion only; restrict `/internal/` ingress
   to Connect’s server address when configuring proxy access rules (Connect calls the Auth origin
   over HTTPS). It is never sent to browser/mobile clients.

5. Keep `identity.sqlite` and its WAL on Auth's private volume; keep `accounts.sqlite` on Connect's
   existing volume. Back up both with SQLite's backup API and test restores. If an embedded Auth
   database already exists, stop writes, back it up and move the verified copy into Auth's volume;
   never mount the same writable database into both services. Preserve the explicit owner mapping.
6. Verify actual GitHub sign-in on desktop/mobile, artifact-only scope, sign-out and account
   deletion before retiring the existing login. Until GitHub credentials are supplied, leave the
   production login unchanged. No legacy authentication compatibility layer is required for this
   migration.

Connect still builds using `apps/connect-server/compose.dokploy.yaml`. Preserve its existing project
name, data volume, private notification network, provider key mounts and TURN configuration. The
production Connect environment remains `/etc/dokploy/secrets/dovo-studio-connect/connect.env`. Do
not publish any secret, callback code or cookie in Git, support logs, screenshots or app builds.

### Preserve existing ownership when moving from the previous identity provider

No legacy authentication mode is retained. Existing Dovo device sessions can continue until revoked
or expired, but new sign-ins use GitHub. To preserve an existing owner's computers, artifact
invitations and publications, independently verify that person's **numeric GitHub user ID** and
existing Dovo account ID. Store an explicit mapping in a private JSON file on the persistent volume:

```json
[{ "githubId": "3958086", "accountId": "EXISTING_DOVO_OWNER_ID" }]
```

Set `DOVO_AUTH_OWNERS_FILE=/data/private/auth-owners.json` on **Auth only**. Keep the mapping after
migration: it assigns the verified GitHub subject the original, stable Dovo owner ID. Duplicate IDs
are rejected. Never infer ownership from matching email addresses, display names, or there being
only one user. Unmapped GitHub identities receive a new isolated Dovo owner ID. An operator should
verify artifact ownership and the computer directory after the first sign-in. No old account,
artifact or pairing needs to be deleted to move identity providers.

## Security boundaries

Better Auth on Auth handles GitHub OAuth state, PKCE, encrypted stored OAuth tokens and HttpOnly
browser cookies. Connect independently verifies OIDC issuer, audience, nonce, signature and token
age over HTTPS with its own PKCE verifier. The signed Dovo account-ID claim preserves ownership;
organization providers cannot supply that claim to override their separate identity namespace. Dovo
additionally binds each login to its initiating browser and code confirmation, checks request
origins, consumes callback state once and issues a separate scoped device grant. Automatic provider
account linking is disabled. Browser-session cookie caching is disabled so revoked browser sessions
cannot complete a pending Dovo sign-in from a cached identity.

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

## Dovo Auth account experience

Open `https://auth.dovo.studio` to sign in directly with GitHub and manage your identity. The
responsive account page supports updating your display name, inspecting active Auth browser sessions
and their last activity/expiry, signing out an individual browser, signing out other browsers, and
signing out the current browser. GitHub continues to manage your email address. These controls use
Better Auth session and profile APIs; no GitHub or session tokens appear in page content. Profile
changes do not change your mapped Dovo account identity.

When sign-in starts in Dovo Studio or Artifacts, the signed OAuth request is preserved through
GitHub and returns to the requesting application. Expired or modified requests must be restarted.
Organization SSO remains available from the application’s organization provider selection.

Signing out an Auth browser does not revoke existing Dovo app sessions, runtime grants or pairing.
Use the account controls in Dovo Studio for computer-access revocation and full account deletion;
that deletion also removes the linked Auth identity. LAN/VPN pairing remains account-free.
