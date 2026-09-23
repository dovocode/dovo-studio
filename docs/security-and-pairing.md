# Security and pairing policy

HTTP is intentionally supported for LAN and VPN connections (including Tailscale and NetBird). HTTPS
is optional. Pairing codes and device tokens remain required; no account or external login provider
is required. See the repository's AGENTS.md before changing these decisions.

## Pairing

Invitations expire after two minutes and are single-use in both manual and automatic approval modes.
Manual approval does not persist a trusted device until the client claims its token. Claimed tokens
are provisional: the client must save its connection and confirm pairing before the request expires.
Expired provisional tokens are revoked even across runtime restarts. Confirmation and claims can be
retried after a lost response. Clients first save a pending pairing record in their existing
credential storage, retaining the previous active profile. Only after confirmation and a successful
final storage write is the replacement activated. A storage failure cannot silently confirm an
unsaved credential. Pending records survive process restarts; startup retries confirmation, or
checks whether an expired request left a confirmed credential. Offline recovery keeps both the
pending record and previous profile.

Cancellation revokes the candidate and removes its pending record without replacing the previous
connection. If the request has already expired, the staged device token can revoke only itself. The
owner credential cannot use self-revocation.

New pairing uses pairing protocol version 2. Update both clients and the runtime before creating new
pairings; older clients receive an update-required error before consuming an invitation. Existing
confirmed device credentials continue to work. A paired device grants full runtime access, including
files and terminal commands as the runtime's OS user.

## Credentials and local data

Desktop privileged IPC checks the sender frame and renderer URL. Main-window navigation and new
windows are restricted. Runtime API requests reject redirects and cross-origin request paths, while
continuing to accept HTTP. MCP connection-test requests also reject redirects, including 307/308
redirects that could forward custom credential headers.

Literal MCP environment and header values remain in the private host database. Snapshots contain
opaque, keyed references. Leave references unchanged to preserve values, replace them to update
values, or remove keys to clear values. References survive runtime restarts. Activity logging
redacts entire literal-value containers and API-key fields; a one-time migration redacts those
fields and previously embedded validation diagnostics in historical activity records. HTTP
validation failures use a value-free error message, and MCP connection-test inputs are excluded from
activity capture.

The iOS Documents directory is no longer exposed through Files or device file sharing. Offline data
remains app-private and persistent. Explicit attachment sharing remains available. Applying this
change requires a new native iOS build; a JavaScript-only update cannot change Info.plist.

## Dependency fixes

- The maintained `@fastify/busboy` Dicer export replaces the abandoned `dicer` dependency. Multipart
  frame parsing is covered by a split-chunk regression test.
- Overrides update `linkify-it` to 5.0.2 and older UUID versions to 11.1.1. Existing transitive
  callers use compatible APIs.
- `decode-uri-component` 0.2.2 is patched with the upstream 0.5.0 parser, preserving its CommonJS
  export and legacy plus decoding for Expo's existing callers. Source:
  https://github.com/SamVerschueren/decode-uri-component/blob/v0.5.0/index.js

The package audit still reports the decoder's original version because it does not inspect pnpm
patches. Do not remove the patch or suppress the advisory without upgrading its callers and
verifying Expo/Metro compatibility.

## Verification scope

Automated checks cover pairing expiry/cancellation/confirmation/restart, secret projection and
editing, renderer URL trust, and actual HTTP 307/308 redirects. Native configuration and bundle
export are checked separately. These checks do not constitute a physical-device penetration test,
and do not change an already installed app until it is rebuilt and installed.

## Connecting a phone and changing addresses

On the desktop, open **Settings → Devices & runtime → Manage → Connect your phone**. Choose a Wi-Fi
or VPN address reachable from the phone. The QR code opens Dovo’s Computers screen with the address
and single-use code filled in. Review the address and tap **Pair device**; approve the named phone
on the desktop. Scanning alone never grants access. Codes expire after two minutes. Manual entry and
HTTP remain supported; no account is required.

Use **Update connection address** for a saved remote computer when its address changes. Pair the new
address with a fresh code from the same computer. The old connection remains saved until
confirmation and credential storage both succeed. The saved computer ID stays the same, so its route
links remain valid. This is an explicit replacement, not automatic host discovery.

Interrupted pairing is recovered after the saved workspace opens, and retried on returning to the
app. An offline computer does not block opening the local workspace. Pending credentials stay in
secure storage until confirmed or cancelled; recovery preserves the active computer.
