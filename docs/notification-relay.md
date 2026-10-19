# Mobile notifications and the Dovo relay

The notification relay is a separate application in `apps/notification-relay`. It forwards
notifications directly to Apple APNs for iOS and Firebase FCM for Android. It does not run agents,
expose runtime workspaces, require an account, or proxy the app's runtime connection. Pairing and
LAN/VPN HTTP support remain unchanged.

## Managed delivery through Connect

Sign in on the phone under **Computers**, then enable **Settings → App & updates → Task
notifications**. A switch for each paired computer lets you choose which servers notify this phone.
Servers need the updated runtime, but no account login, account directory link, or per-server relay
environment. Pairing is still required before the phone can register notifications on a computer.

The phone creates a separate delivery grant for each enabled paired computer through Connect. The
runtime keeps only that scoped grant and its existing native push registration in its private
database. It sends to the fixed `https://connect.dovo.studio/v1/push/send` endpoint; no arbitrary
relay URL is accepted from a paired device. A grant cannot read the account directory, pair devices,
or send to a different phone, platform, environment, or computer profile. Grants rotate on
registration refresh. Renewing a grant preserves queued messages and uses the current credential at
delivery time. Only credential hashes are stored by Connect; no account session is shared with a
runtime.

Turning off one computer revokes its grant on Connect even if that computer is offline. Turning off
the main switch or revoking OS permission revokes all this phone session's grants on its next active
sync. Removing a computer also prunes its grant. An unavailable Connect service shows a revocation
error and retries on foreground/reconnect or the periodic active sync. In-flight deliveries already
accepted by Apple/Google cannot be recalled. Signing out or account-session expiry invalidates all
that session's grants. Other phones and enabled computers remain independent.

Connect forwards delivery to the separate private APNs/FCM relay using its backend-only
`DOVO_NOTIFICATION_RELAY_URL` and `DOVO_NOTIFICATION_RELAY_TOKEN`. Deploy the relay as described
below, reachable from Connect (a private container network is sufficient). Configure provider keys
on the relay only. Connect stores native phone tokens in its private SQLite database and transiently
processes notification titles/previews while forwarding; it never stores those message contents. The
relay retains its bounded in-memory retry cache. Include Connect's private database in backups.
Managed registration reports unavailable if the relay connection is not configured; a successful
end-to-end delivery is still required to validate Apple/Google credentials and native signing.

Without sign-in, the existing standalone relay flow below continues to work. Per-computer switches
also control standalone registrations, but an offline standalone computer can unregister only after
reconnecting.

## Deploy with Docker

From the repository root:

```sh
cp apps/notification-relay/.env.example apps/notification-relay/.env
mkdir -p apps/notification-relay/secrets
openssl rand -hex 32
```

Put the generated value in `DOVO_RELAY_TOKEN` in the `.env` file. Keep that file and the provider
keys private. For iOS, mount your Apple APNs `.p8` key as `secrets/apns.p8` and set its key ID and
Apple team ID. The relay supports both sandbox and production device tokens. For Android, mount a
Firebase service-account JSON as `secrets/firebase.json`, set
`DOVO_FIREBASE_CREDENTIALS=/run/secrets/firebase.json`, and set `DOVO_FCM_PROJECT_ID`. The service
account needs permission to send FCM messages in the application's Firebase project. Leave
`DOVO_FIREBASE_CREDENTIALS` empty for an iOS-only relay; leave the Apple IDs empty for an
Android-only relay.

```sh
docker compose --env-file apps/notification-relay/.env \
  -f apps/notification-relay/compose.yaml up --build -d
curl http://localhost:8080/health
```

The container runs as an unprivileged user with a read-only filesystem. Ensure its user can read the
mounted provider keys. The default UID/GID is 1000; set `DOVO_RELAY_UID` and `DOVO_RELAY_GID` in the
relay `.env` to the host account’s `id -u` and `id -g` when using owner-only key files on a
different host UID. `/health` reports which providers have configuration. It does not verify the
provider keys; an actual delivery is needed to verify them. Deploy behind your existing ingress when
exposing it publicly. The relay accepts only authenticated `POST /v1/notifications` requests. It
bounds requests, limits concurrent deliveries, and coalesces matching retries. It never logs tokens,
message previews, or provider response bodies. Apple and Google credentials stay on the relay.

## Connect a Dovo runtime

Configure each desktop/server host with:

```sh
export DOVO_NOTIFICATION_RELAY_URL=http://your-relay-host:8080
export DOVO_NOTIFICATION_RELAY_TOKEN=YOUR_SHARED_RELAY_TOKEN
```

Restart the runtime with these variables. For a managed service, its profile's
`runtime-environment.json` accepts these two settings and stores them with owner-only permissions.
Service installation/start preserves the exported variables in that file. The desktop background
service uses the same environment file. Merge the two keys into an existing file rather than
replacing other credentials. Provider keys are not needed on the runtime. HTTP remains supported for
private LAN/VPN deployments; HTTPS is optional.

The runtime registers push tokens only for authenticated paired devices. Tokens and delivery records
stay in its private database and are excluded from workspace snapshots and activity logs. Revoking a
paired device stops future delivery. Delivery records survive runtime restarts and retry temporary
relay failures with bounded backoff for up to one hour. Invalid device tokens are removed and the
phone registers a replacement on its next connection. Each pending request carries its own identity.
Pending input notifications are discarded if the exact request has already been answered or
replaced. Notifications for archived threads and superseded runs are also discarded before delivery.
Notification delivery is best effort: provider outages, OS settings, and relay restarts can affect
timing. The relay's retry cache is in memory; runtime records are durable.

## Build and enable the mobile app

Use a new native app build; a JavaScript reload cannot add native notification support. Enable Push
Notifications for `com.dovo.studio` in your Apple app identifier and signing profile. Local
development builds use sandbox tokens; set `DOVO_APNS_ENVIRONMENT=production` when building for App
Store/TestFlight distribution. The OS entitlement must match that environment.
`DOVO_PUSH_NOTIFICATIONS=0` retains the local-only iOS build option when push signing capabilities
are unavailable.

For Android, supply your application's Firebase `google-services.json` when building:

```sh
export DOVO_GOOGLE_SERVICES_FILE=/private/path/google-services.json
pnpm --filter @dovo/mobile android
```

Both platforms use native device push tokens, not Expo's hosted push relay. In the mobile app, open
**Settings → App & updates → Push notifications** and enable Task notifications. The app requests
system permission and registers with its connected computers. It sends completion, failure,
input-request, and PR-check notifications with a task title and short preview. Tapping a
notification opens the originating thread and computer, including from cold launch. Question
notifications include an **Answer question** action that opens the full form for that exact request,
including all choices and fields, alongside its thread, computer, and project. An answered request
is shown as no longer pending instead of silently opening another question. Permission is opt-in;
input requests show foreground banners and sound, while other task events remain quiet in the
foreground. Turning the setting off unregisters it from reachable runtimes; disconnected runtimes
can only unregister when they reconnect. Changes during registration are applied after the in-flight
request finishes. Revoking system notification permission unregisters reachable runtimes on the next
foreground sync; restoring permission registers them again if Task notifications remain enabled.
Revoking the device on the runtime also stops delivery.

Push-capable iOS builds enable Live Activity push tokens and frequent updates by default. Set
`DOVO_LIVE_ACTIVITY_PUSH=0` to opt out, or `DOVO_PUSH_NOTIFICATIONS=0` for a local-only build.
Foreground workspace changes update Live Activities promptly; background updates still need the
runtime’s existing APNs configuration.

Live Activities retain their existing APNs configuration; this relay adds ordinary iOS and Android
notifications.
