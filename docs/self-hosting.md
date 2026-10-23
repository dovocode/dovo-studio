# Custom Connect and artifact store

You can operate Connect, Dovo Auth and the artifact service on your own infrastructure. These
services are optional: local artifacts and LAN/VPN runtime pairing work without them, including over
HTTP. Pairing codes and device tokens remain required for paired runtime access.

Connect provides internet signaling and the account directory. Auth provides the shared sign-in
identity. The artifact store holds explicitly published saved versions independently of computers.
It uses private SQLite storage, not an S3 bucket. Each service needs its own hostname and persistent
volume. Deploy one instance of each; signaling state is in memory and SQLite storage is not a
multi-replica deployment.

## Before you start

- Install Docker with Compose and clone `https://github.com/dovocode/dovo-studio`. Run the commands
  below from the repository root. Container builds use that root as their build context.
- Choose origins such as `https://connect.example.com`, `https://auth.example.com` and
  `https://artifacts.example.com`, with DNS and an HTTPS reverse proxy. Connect requires HTTPS for
  non-loopback signaling; this does not change HTTP support for private LAN/VPN runtime addresses.
  Keep artifacts on a separate origin from Connect, Auth and the runtime.
- Desktop/mobile builds let you select your services in Settings. See
  [Configure Studio and the runtime](#configure-studio-and-the-runtime) before deploying.
- For an existing installation, preserve the Connect, Auth and artifact databases and volumes. Do
  not replace them with empty databases or infer ownership from email/display names. Follow the
  [explicit identity mapping](optional-accounts.md#preserve-existing-ownership-when-moving-from-the-previous-identity-provider)
  when migrating sign-in.

## 1. Configure Auth and Connect

Follow
[Configure the separate Auth service](optional-accounts.md#configure-the-separate-auth-service) to
deploy Dovo Auth, register a GitHub OAuth App and generate its independent secrets. Replace all
example hostnames with yours. The GitHub callback is
`https://auth.example.com/api/auth/callback/github`; the Connect callback is configured by Auth from
your Connect origin. Use the same Connect client credentials on Auth and Connect. Auth is needed for
account sign-in and hosted artifact sharing; Connect can provide account-free signaling with
`DOVO_AUTH_ISSUER` unset.

For a new local Compose deployment, create the ignored environment files below. Do not overwrite
existing configuration. Keep production secrets outside the checkout using the deployment options in
the linked guides.

```sh
cp apps/connect-server/.env.example apps/connect-server/.env
cp apps/artifact-server/.env.example apps/artifact-server/.env
chmod 600 apps/connect-server/.env apps/artifact-server/.env
```

Edit `apps/connect-server/.env`:

```dotenv
DOVO_CONNECT_ORIGIN=https://connect.example.com
DOVO_AUTH_ISSUER=https://auth.example.com/api/auth
DOVO_AUTH_CONNECT_CLIENT_ID=dovo-connect
DOVO_AUTH_CONNECT_CLIENT_SECRET=SAME_CLIENT_SECRET_AS_AUTH
DOVO_AUTH_SERVICE_KEY=SAME_SERVICE_KEY_AS_AUTH
```

Set `DOVO_CONNECT_TRUSTED_PROXIES` only to the actual immediate proxy IPs/CIDRs, after configuring
it to sanitize forwarded headers. Leave it empty when there is no trusted proxy. Forward WebSocket
upgrades for `/v1/peer` and allow idle connections longer than the 25-second heartbeat. See
[Operating Connect](internet-connections.md#operating-connect) for networking details and
[relay operations](internet-connections.md#relay-operations) for optional TURN. Deploying Connect
alone does not provide a TURN relay.

## 2. Link the artifact store

Generate a separate artifact service key:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Set the following in **both** environment files, replacing the example values with the same
generated key and final artifact origin in each:

```dotenv
DOVO_ARTIFACTS_ORIGIN=https://artifacts.example.com
DOVO_ARTIFACTS_SERVICE_KEY=YOUR_GENERATED_ARTIFACT_SERVICE_KEY
```

In `apps/artifact-server/.env`, also set:

```dotenv
DOVO_CONNECT_ORIGIN=https://connect.example.com
DOVO_ARTIFACTS_DATA=/data
DOVO_ARTIFACTS_ACCOUNT_BYTES=104857600
DOVO_ARTIFACTS_TOTAL_BYTES=5368709120
```

The defaults allow 100 MB per account and 5 GB total. The service stores only saved versions you
explicitly publish, with a 20 MB serialized publication limit. Keep service keys out of Studio
client builds. Clients discover the artifact origin through Connect and obtain restricted grants;
they do not receive the service key or use a separate artifact login account.

## 3. Start the services

After Auth is ready, start Connect and artifacts:

```sh
docker compose --env-file apps/connect-server/.env -f apps/connect-server/compose.yaml up -d --build
docker compose -f apps/artifact-server/compose.yaml up -d --build
```

Connect listens on `127.0.0.1:8081`, artifacts on `127.0.0.1:8082`. Put your HTTPS reverse proxy in
front of those listeners. If the proxy is itself containerized, configure a shared private Docker
network rather than using its own loopback address. Allow 20 MB JSON uploads to artifacts. Do not
redirect authenticated service requests to another origin.

Both Compose files mount durable data volumes at `/data`; containers run as a non-root user. Keep
the volumes writable by UID/GID 1000. Back up all three services consistently, including SQLite WAL
state, and test restoration. The artifact operator can read stored content; hosted storage is not
end-to-end encrypted. See [Hosted artifacts](hosted-artifacts.md#run-the-separate-service) for
backup, access, retention and deployment details.

For **Dokploy**, use the dedicated Compose services and private environment paths from
[Auth setup](optional-accounts.md#configure-the-separate-auth-service) and
[artifact service setup](hosted-artifacts.md#run-the-separate-service). Preserve Connect's existing
data volume, notification network and TURN configuration when updating it.

## Configure Studio and the runtime

In desktop **Settings → Devices & runtime**, or mobile **Settings → Devices**, open **Dovo
services**. Set **Dovo Connect URL** to `https://connect.example.com` and save. Leave **Dovo
Artifacts URL** blank to discover storage through Connect, or set it to
`https://artifacts.example.com` to require that destination. Connect and the artifact service must
advertise the same artifact origin and use the same service key; the app cannot override that
server-side authorization configuration. No custom client build is required.

These preferences apply to this device. Each Connect origin has its own securely stored account
session; changing URLs never forwards a previous server's session to the new server. Returning to an
earlier URL restores its saved session. Custom servers have their own account directory and do not
automatically inherit Dovo-hosted accounts, invitations or publications.

Update runtimes before configuring a custom Connect URL. Connect setup explicitly sends your
selected origin to the computer and persists it there. Already-enabled computers keep their current
broker: connect through LAN/VPN, disable Connect, then enable it again using the new URL. Existing
pairings remain independent of account sign-in.

For initial or headless configuration, set `DOVO_CONNECT_ORIGIN=https://connect.example.com` in the
runtime process environment before its first start. The runtime persists this initial value;
subsequent explicit setup uses the saved origin. The CLI uses that runtime's selected origin for
`dovo-server connect on`. For managed launchd/systemd installs, configure the supervisor
environment; a shell export alone does not persist into the service. The managed
`runtime-environment.json` allowlist does not accept this key.

## Verify the deployment

```sh
curl --fail https://connect.example.com/health
curl --fail https://auth.example.com/health
curl --fail https://auth.example.com/api/auth/.well-known/openid-configuration
curl --fail https://artifacts.example.com/health
```

Then sign in from Studio with your selected URL, enable Connect on the source computer with explicit
owner consent, and test a connection from another network. Publish a private artifact, invite a
second account by its exact Sharing ID, test an expiring link and revoke it. Confirm sign-out and
existing ownership after migration. A health response alone does not verify sign-in or access
controls.

For ordinary server installation, use [Homebrew](server-setup.md#homebrew) or the
[Linux installer](server-setup.md). Self-hosted Connect and artifact storage are separate from
installing a runtime.
