# Encrypted threads and artifacts

Studio manages shared threads and artifacts directly. Open **Share thread**, or **Share** on a saved
artifact. On mobile, **Share thread** is in the thread’s menu and artifacts have a direct Share
button. Add someone by sharing ID, or change **General access** from **Restricted** to **Anyone with
the link** and choose **Copy link**. Studio creates the encrypted copy and device key on the first
sharing action; opening settings alone does not publish anything. Reopening reuses the existing copy
and links. Local runtime access still supports HTTP LAN/VPN addresses, pairing codes and device
tokens without an account.

**Advanced** holds optional content previews, link expiry, update controls, recovery and deletion.
The usual sharing flow needs no repeated setup. Restoring existing encrypted content on a new device
still requires its recovery key.

Threads automatically publish new user and assistant message text while the source runtime is
online. Tools, attachments and unsent drafts are excluded. Readers see updates without refreshing.
**Pause automatic updates** keeps the existing hosted content available. Saved artifact versions
remain separate copies; an approved live MCP feed can update their encrypted dashboard data.

## Readers and suggested prompts

- **Private invitations** require both the recipient's exact sharing ID and their invitation link.
  Send the full link to the intended person. Studio does not send invitation emails.
- **Anyone with the link** requires no sign-in. New links last 7 days by default; Advanced offers 1
  hour, 1 day, 7 days or 30 days for new links. Treat the complete URL as a secret. Its fragment
  contains the reader's decryption material and is not included in HTTP requests. Studio can copy
  active links again after unlocking its owner vault.
- **Revoke access** rotates the content key and removes the selected reader. Remaining readers keep
  their URLs. Revocation cannot recall downloaded content. An artifact feed must be reviewed and
  approved again after rotation.
- Changing General access back to **Restricted** confirms removal of every anyone-with-link URL;
  invited accounts keep their personal invitation links. Individual links can also be removed in
  Advanced. Expired links cannot be copied as active reader links.
- Thread readers can suggest a next prompt. Suggestions are encrypted for the publisher, and other
  readers cannot see them. **Use in composer** inserts a draft for review and editing; it never
  sends the prompt or starts an agent. Suggestions appear inline at the end of the owner’s thread on
  desktop and mobile, refresh while the thread is visible, and can be dismissed there. Insertion
  preserves the existing draft.

**Delete hosted copy** removes the publication, invitations, links and suggestions. It preserves the
local thread or artifact. Deleting local content alone does not delete its hosted copy.

## Keys and recovery

Content is encrypted and signed on the source device. The service stores encrypted content and owner
vaults; suggestions use the owner's public encryption key. The host cannot decrypt message text,
artifact files, feed values or prompt suggestions. It can see account and recipient IDs, publication
kind, sizes, timestamps, access metadata and request traffic.

Studio creates the recovery key once and stores it in its platform credential storage. Under
**Advanced → Recovery and another device**, reveal or copy it to a password manager. On another
device, sign in to the same Connect account and select **Restore sharing key**. Account sign-in
alone cannot recover encrypted publications. There is no hosting-service recovery or automatic
device-to-device key transfer. Anyone holding the recovery key and owner access can unlock all that
account's publications for that Connect origin.

End-to-end encryption relies on the reader application delivered by the host, as with other web
cryptography. A compromised reader application or recipient device can expose decrypted content.
Keep hosting, application updates and device access protected.

## Existing hosted artifacts

Older publications remain available through the legacy API and are marked **Not end-to-end
encrypted** in Studio. Manage their invitations, links, live feed and deletion in Studio. Publishing
an encrypted copy creates new links; it does not encrypt or remove the previous copy. Delete the
previous hosted copy when replacing it. Backups remain subject to the operator's retention policy.
See [legacy hosting](hosted-artifacts.md) for the older viewer and service configuration.

## Deploy `share.dovo.studio`

The existing artifact-server image serves encrypted sharing too. A dedicated sharing origin can use
its own deployment, service key and persistent volume while leaving legacy artifacts available. No
deployment is performed by changing this repository.

On Connect and the dedicated sharing service, set matching values:

```dotenv
DOVO_SHARING_ORIGIN=https://share.dovo.studio
DOVO_SHARING_SERVICE_KEY=YOUR_SEPARATE_RANDOM_SERVICE_KEY
```

On the sharing service also set:

```dotenv
DOVO_CONNECT_ORIGIN=https://connect.dovo.studio
DOVO_ARTIFACTS_DATA=/data
DOVO_ARTIFACTS_ACCOUNT_BYTES=104857600
DOVO_ARTIFACTS_TOTAL_BYTES=5368709120
```

Use `apps/artifact-server/compose.sharing.dokploy.yaml` with the repository root as build context.
Create `/etc/dokploy/secrets/dovo-sharing/sharing.env` outside the checkout. Route the sharing
hostname to service `sharing`, port 8080, and preserve `dovo-sharing-data` across redeploys.
Generate the service key using
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Keep authorization
headers, cookies, bodies and URL fragments out of logs. Allow JSON uploads up to 32 MB; storage
quotas include encrypted content, suggestions and legacy hosted data.

Without a dedicated sharing configuration, Connect uses the existing artifact service for encrypted
sharing. Public deployments should use HTTPS; HTTP remains supported for LAN/VPN services and is
never silently upgraded. Keep the service on a separate origin from runtimes and Studio. Preserve
the databases, protect backups, and verify both private and anonymous access after deployment.

Live publication writers connect outbound from the source runtime. Their credentials are scoped to
one publication and generation, and grant no runtime access. Pausing, revocation, deletion or owner
deactivation invalidates the writer. A separately paired human must approve runtime sharing and live
feeds; agents and account-derived internet sessions cannot enable them.

### Production deployment, 25 October 2026

`share.dovo.studio` runs as the separate **Dovo Studio Share** Compose service in Dokploy. Both
sharing and Connect were built on the production host through the existing **Dokploy Dovocode**
GitHub connector from commit `d4d4f913` on
`dovo/investigate-shareable-dovo-threads-with-next-prompt-suggesti-fb2d55f7`. Automatic deployment
is disabled. No prebuilt image was uploaded. Move the configured branch to `main` after the feature
is merged; a repository push alone does not redeploy these services.

Sharing keeps its private environment in `/etc/dokploy/secrets/dovo-sharing/sharing.env` and its
data in `dovo-sharing-data`. Connect retains its existing operator Compose overlay, private push
network, TURN configuration and persistent volume. Its overlay additionally loads
`/etc/dokploy/secrets/dovo-sharing/connect-preserved.env`, which preserves the previously active
Connect settings and adds the matching sharing origin and service key. Keep both service-key values
aligned when rotating credentials. Production environment files are never committed. The previous
Connect container configuration, Compose file, environment file and a consistent SQLite backup are
retained privately at `/var/backups/dovo-sharing-94a71e22` on the deployment host. Dokploy
configuration snapshots are retained privately on dovo-admin.

Verified public HTTPS, desktop/mobile landing rendering, private API rejection, invalid-link
rejection, dedicated origin discovery, matching service authentication and healthy sharing, Connect
and relay containers. All original active Connect settings were compared against the saved container
configuration; the relay kept its original start time. Authenticated publishing and reader
interactions were exercised by the local end-to-end browser suite, not with a production user
session. Desktop/mobile application binaries were not released as part of this deployment.
