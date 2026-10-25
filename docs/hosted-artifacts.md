# Legacy hosted artifact sharing

New Studio publications use [end-to-end encrypted sharing](encrypted-sharing.md), including live
threads and full management inside Studio. The instructions below describe existing unencrypted
publications and their legacy web viewer. Studio also manages these older copies directly.

Dovo's optional artifact service stores published copies separately from your computers. Publishing
uploads one explicitly selected saved version; it does not publish the thread, runtime address,
pairing credentials or account session. All source files in a folder artifact are included in the
stored copy. Review the content and files for secrets before publishing.

Local artifacts, HTTP LAN/VPN pairing and account-free runtime access continue to work without this
service. Hosted publishing and private invitations use Dovo's existing account sign-in, including
administrator-configured organization OIDC providers.

Artifact lists and previews show **Shared** when the selected version is already hosted by the
signed-in account. **Shared vN · This version is local** means another revision is hosted. These
indicators describe an existing hosted copy, not public access. Opening sharing refreshes the server
status and offers management for an existing publication without uploading it again. Status is
specific to the selected Connect server and account.

## Publish and invite

1. Open the saved artifact/version. On desktop choose **Share**; on mobile choose **Export → Hosted
   sharing**. Sign in, check the displayed destination and account, then **Publish private copy**.
2. Open **Manage invitations and links**. This opens the hosted viewer’s **Share artifact** dialog.
   Initially only the publisher can open the private link. Reopen the dialog with **Share** in the
   compact viewer header.
3. Ask a recipient to open that link, sign in, and send you their **Sharing ID** from **Account**.
   In sharing settings, paste it into **Recipient sharing ID** and choose **Invite account**. The
   recipient can now open the same private link. Use the exact ID: names and email addresses are not
   identity proofs. The current account service does not expose verified-email invitations or send
   invitation emails.
4. **Remove access** revokes an invitation. An invited account can view the artifact but cannot
   manage invitations, links or hosted copies. Organization relay membership alone grants no access.

Private access is the default. **Create anyone-with-link access** explicitly creates an additional
link that needs no sign-in. Choose 1 hour, 1 day, 7 days or 30 days. The secret appears after
`#share=` so it is not sent in HTTP URLs, proxy logs or referrers. The server stores only its hash,
checks its publication and expiry on every read, and never exposes a public storage bucket. Copy a
newly created link immediately; the service cannot recover its secret later. **Revoke link** stops
future reads independently of invitations. Revocation cannot recall content already loaded or
downloaded.

Published copies stay available when the source computer is offline, and survive local edits,
retention and deletion. Publish another version explicitly to share updated content. Repeating
publication of the same saved version recovers the same hosted copy. **Delete hosted artifact**
removes that copy and its invitations and links; it does not delete the local artifact.

The web viewer works on mobile and desktop. The saved artifact fills the space below the Dovo
header; **Share** opens invitations and expiring links, while **Account** contains sign-in, the
sharing ID and sign-out. Management links open the sharing dialog automatically. Delete the hosted
copy from the dialog’s **Advanced** section. Dialogs support keyboard focus and Escape to close.

Hosted artifacts use the same Dovo identity and Connect consent flow as Studio, with a separate
sharing-only session that grants no access to computers. Sign-in resumes automatically when you
return from the sign-in page; **Check sign-in** remains available. Moving identity providers
requires the explicit stable-owner mapping described in
[Optional accounts](optional-accounts.md#preserve-existing-ownership-when-moving-from-the-previous-identity-provider).
Keep the existing Connect and artifact databases: with that mapping, publications, ownership,
invitations, private URLs and unexpired share links retain their access. No separate artifact
account is created or merged by email or display name.

HTML/SVG run in an opaque sandbox with scripts allowed for interaction, strict CSP, no external
network, host DOM, account credentials or native bridge. Markdown and code render inside the same
sandbox. Publishing creates a saved document; an optional publisher-approved live data feed can
update its dashboard data without exposing MCP tools or server credentials. See the live dashboard
setup below.

## Run the separate service

For the combined Connect, Auth and storage walkthrough, start with
[Custom Connect and artifact store](self-hosting.md), including service URL settings on desktop and
mobile.

All code is in `apps/artifact-server` in `dovocode/dovo-studio`. Build from GitHub, using
`apps/artifact-server/Dockerfile` and the repository root as Docker build context. The service uses
Node 24 and a private SQLite database in `/data`. It is a standalone deployment and persistent
volume, separate from Connect and runtime databases. Object storage/S3 is not required in this
version.

The Dovo-hosted service uses `https://artifacts.dovo.studio`. For self-hosting, choose a separate
hostname from Connect, runtime APIs and the main application, and replace the example origins below.
Use HTTPS for a public deployment. HTTP remains supported for private LAN/VPN installations; it is
not silently upgraded. Configure the final origin directly: credentialed requests do not follow
redirects.

1. Generate a service key outside the Git checkout:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

2. On **both Connect and the artifact service**, set:

   ```dotenv
   DOVO_ARTIFACTS_ORIGIN=https://artifacts.dovo.studio
   DOVO_ARTIFACTS_SERVICE_KEY=YOUR_GENERATED_KEY
   ```

3. On the artifact service, also set:

   ```dotenv
   DOVO_CONNECT_ORIGIN=https://connect.dovo.studio
   DOVO_ARTIFACTS_DATA=/data
   DOVO_ARTIFACTS_ACCOUNT_BYTES=104857600
   DOVO_ARTIFACTS_TOTAL_BYTES=5368709120
   ```

4. Mount a durable private volume at `/data`, writable by UID/GID 1000. Keep environment files
   private and outside the Git checkout. The process runs as a non-root user, with a read-only
   container filesystem and no added capabilities. Back up the database consistently, including
   SQLite WAL state, and test restoration. Protect backup access and encrypt the disk/backup through
   your host or storage provider. The service operator can read stored content; this is not
   end-to-end encrypted hosting. Deleted data may remain in backups until their retention expires.
5. Restart the updated Connect broker and artifact service. Check each `/health`, then publish,
   invite a second account and test both private and expiring-link access. An unconfigured broker
   reports hosted sharing unavailable; local exports continue to work.

For local container deployment, copy `.env.example` to a private `.env` in `apps/artifact-server`
and run `docker compose -f apps/artifact-server/compose.yaml up -d --build` from the repository
root. The default listener binds to `127.0.0.1:8082`; put your reverse proxy in front of it.

For Dokploy, create a **separate Compose service using GitHub source**, repository
`dovocode/dovo-studio`, branch `main`, and `apps/artifact-server/compose.dokploy.yaml`. Provision
`/etc/dokploy/secrets/dovo-artifacts/artifacts.env` on the deployment host, configure the hostname
to the `artifacts` service port 8080, and preserve the `dovo-artifacts-data` volume on redeploy. Add
the two matching artifact environment values to the existing Connect environment file and redeploy
Connect without replacing its existing volumes. Set proxy request limits to permit 20 MB JSON
uploads and do not log authorization headers, cookies, body data or share-link fragments.

## Authorization and limits

Apps obtain a sharing-only grant from their Connect broker. Their account session is sent only to
Connect. Grants last at most ten minutes, are tied to the signed-in parent session and configured
artifact origin, and are checked with Connect for each authenticated request. Browser sign-ins
create separate sharing-only sessions, lasting at most eight hours or the organization's shorter SSO
session. They cannot be used for computer access, pairing, TURN issuance or minting account grants.
Browser sessions use HttpOnly, host-only, SameSite cookies; public HTTPS uses the `__Host-` prefix.
Invited users must sign in with the exact identity that was granted access.

Account revocation, expiry and organization session invalidation block subsequent authenticated
operations. Signing out of the app invalidates grants derived from that app session; signing out of
the hosted viewer revokes its own session. Previously published copies and independent share links
persist until explicitly revoked/deleted. Account deletion blocks hosted access immediately while
Connect is reachable, and its hosted copies are removed on the next access or cleanup (every
minute). If Connect cannot verify account/session status, access fails closed; network errors never
trigger data deletion. Deletion/SSO behavior otherwise follows
[Optional accounts](optional-accounts.md) and [Organization SSO](custom-turn-and-sso.md), including
the documented IdP revocation limitations.

Each publication is limited to 20 MB of serialized JSON, including bundled assets and source files.
Defaults are 100 publications/100 MB per account and 5 GB total. A publication permits up to 100
invited identities and ten active share links. Request, login, publishing and concurrent-operation
limits bound abuse. The initial deployment runs one process against its persistent volume; do not
point several replicas at copies of the database. Increase storage limits deliberately and monitor
disk capacity; SQLite quotas count logical artifact bodies, not all database/WAL/backup overhead.

Verify with `pnpm --filter @dovo/artifact-server... -r build`, the artifact-server and Connect
tests, and `pnpm test:artifact-sharing:browser`. Physical mobile sign-in and opening external
sharing settings still need native device verification.

## Publisher-approved live MCP dashboards

A published HTML artifact can receive live data from **one fixed MCP query per saved version**. The
publisher supplies the MCP permissions. Viewers receive only the selected JSON; they cannot call
tools, supply arguments, connect another MCP server or inherit the publisher's credentials. Private
invitations and optional expiring links apply to both the document and its live data.

1. Configure a trusted MCP server in the source thread's project or agent resources. Give it
   credentials restricted to read-only data at the source. Dovo offers only tools declaring
   `readOnlyHint: true` without `destructiveHint: true`; these annotations are declarations by the
   server, **not an enforced security boundary**. Do not approve an untrusted server solely because
   it labels its tool read-only.
2. Publish the selected artifact version. In its desktop/mobile sharing controls choose **Load
   read-only MCP tools**, select a tool and enter fixed JSON arguments matching its displayed
   schema.
3. Set **JSON field to share** to an RFC 6901 pointer, for example `/summary` or `/teams/0/count`.
   Leave it empty only if the entire result is safe to share. Escape `/` as `~1` and `~` as `~0` in
   field names. Structured tool output is preferred; otherwise text is parsed as JSON when possible.
   Resource/image blocks and MCP `_meta` are excluded. The selected JSON must fit within 256 KB.
4. Choose 1, 5 or 15 minutes, then **Read preview**. This explicitly runs the query once on your
   computer and displays the selected result; it does not upload that result.
5. Review the exact data and choose **Approve and enable live feed** (with a second confirmation on
   mobile). Approval uploads the preview and authorizes **future results**, visible to all invited
   accounts and anyone with an active shareable link. Changing arguments, fields or refresh interval
   requires a fresh preview and approval. Enabling another feed replaces the current one.

The source runtime must stay online to refresh. It persists only the fixed query, configuration
fingerprint and a publication-bound writer permission, never a full account session. The hosted
service checks the writer's account permission with Connect before accepting updates. Its writer
cannot read artifacts, manage access, pair devices, obtain TURN credentials or mint grants. Writer
permissions expire with the approving app's account session, at most 30 days; re-preview and approve
to renew. Reapproval replaces that app session's previous writer for the publication.

Refreshes stop when the approving paired device is revoked, the parent account session is revoked or
expires, organization SSO policy invalidates it, MCP configuration/tool definitions or thread
permissions change, the source artifact is removed, the source thread is settled/archived, artifacts
are disabled, or the hosted feed is replaced/cleared/deleted. Checks run before reads and before
uploading results. Temporary connection failures keep the last successful value and retry at the
chosen interval. Dovo runs at most 16 feeds per runtime, with at most two simultaneous refreshes.

**Stopping refreshes does not erase previously shared data.** Cached data remains under the existing
invitations and links, including when the publisher is offline or signed out. **Stop and clear live
feed** in sharing controls or hosted owner settings removes the hosted value and invalidates its
writer generation. If the runtime is offline, use the hosted owner settings. Deleting the hosted
artifact also removes its feed, invitations and links. Neither action recalls copies already read or
downloaded. Feed bytes count toward the same account and total storage quotas.

### Use live data in an HTML artifact

The networkless sandbox receives a one-way event and exposes the latest payload as
`window.dovoArtifactData`. No runtime tokens, server credentials or MCP bridge are supplied.

```html
<p id="count">Waiting for data</p>
<script>
  function render(payload) {
    document.getElementById('count').textContent = payload?.data?.count ?? 'No data'
  }
  addEventListener('dovo:artifact-data', (event) => render(event.detail))
  render(window.dovoArtifactData)
</script>
```

The payload is `{ data, updatedAt, stale, enabled }`; `updatedAt` is a Unix timestamp in
milliseconds or `null`. The viewer checks for updated data every 15 seconds while visible,
independently of the publisher's query interval. It displays the last receipt time and marks
missing, expired or late data stale after two query intervals. Transient service failures mark
cached results stale; revoked view access removes the preview on its next check. Guest messages
cannot request tools or refreshes.

Local/offline previews and static exports do not execute or carry a live feed. Only the hosted
viewer supplies these events. Native feed setup and OS-specific external sharing behavior still need
physical-device verification.
