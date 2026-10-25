# Encrypted threads and artifacts

Studio manages shared threads and artifacts directly. Open **Share thread**, or **Share** on a saved
artifact. Review the destination, account and content, then publish. Publishing creates a private
copy with no readers until you invite someone or create a link. Local runtime access still supports
HTTP LAN/VPN addresses, pairing codes and device tokens without an account.

Threads automatically publish new user and assistant message text while the source runtime is
online. Tools, attachments and unsent drafts are excluded. Readers see updates without refreshing.
**Pause automatic updates** keeps the existing hosted content available. Saved artifact versions
remain separate copies; an approved live MCP feed can update their encrypted dashboard data.

## Readers and suggested prompts

- **Private invitations** require both the recipient's exact sharing ID and their invitation link.
  Send the full link to the intended person. Studio does not send invitation emails.
- **Anyone with the link** requires no sign-in. Choose an expiry of 1 hour, 1 day, 7 days or 30
  days. Treat the complete URL as a secret. Its fragment contains the reader's decryption material
  and is not included in HTTP requests. Studio can copy active links again after unlocking its owner
  vault.
- **Revoke access** rotates the content key and removes the selected reader. Remaining readers keep
  their URLs. Revocation cannot recall downloaded content. An artifact feed must be reviewed and
  approved again after rotation.
- Thread readers can suggest a next prompt. Suggestions are encrypted for the publisher, and other
  readers cannot see them. **Use in composer** inserts a draft for review and editing; it never
  sends the prompt or starts an agent. Suggestions appear inline at the end of the owner’s thread on
  desktop and mobile, refresh while the thread is visible, and can be dismissed there or from
  sharing settings. Insertion preserves the existing draft.

**Delete hosted copy** removes the publication, invitations, links and suggestions. It preserves the
local thread or artifact. Deleting local content alone does not delete its hosted copy.

## Keys and recovery

Content is encrypted and signed on the source device. The service stores encrypted content and owner
vaults; suggestions use the owner's public encryption key. The host cannot decrypt message text,
artifact files, feed values or prompt suggestions. It can see account and recipient IDs, publication
kind, sizes, timestamps, access metadata and request traffic.

Studio stores the recovery key in its platform credential storage. When creating a key, copy it to a
password manager. Under **Recovery and another device**, reveal or copy the key. On another device,
sign in to the same Connect account and select **Restore sharing key**. Account sign-in alone cannot
recover encrypted publications. There is no hosting-service recovery or automatic device-to-device
key transfer. Anyone holding the recovery key and owner access can unlock all that account's
publications for that Connect origin.

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
