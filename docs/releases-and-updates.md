# Releases, updates and iPhone Live Activities

Dovo keeps application updates separate from agent adapter updates and runtime data. Neither desktop
updates nor local iPhone installs uninstall the old app or erase pairings. Keep the same bundle ID
and Apple signing team between iPhone builds.

## Desktop

Installed builds use **Dovo Studio → Check for Updates…** (also in Help). The sidebar's **Check for
Updates** panel shows the active release channel. **Settings → General → Updates** has a **Release
channel** dropdown for Stable or Nightly. The choice is saved in `~/.dovo/settings.json` and applies
to sidebar, menu and automatic checks. It defaults to the installed build's channel. Finish
installing a downloaded update before switching channels. Source launches show **Dovo Studio (Dev)**
in the window and menu. The update icon opens release notes and live download progress, including
transferred bytes and speed. After download, choose **Restart and install** or **Later**.
Installation checks the local runtime and waits if tasks or automations are running. Choosing Later
does not install unexpectedly on quit. Remote runtimes are not restarted. Source builds explain how
to update the checkout instead of attempting an installer update. Stable and Nightly have separate
app identities and installers but use the same workspace and pairing data. Run one version's local
runtime at a time; opening the other version connects to the existing compatible runtime without
restarting it. Incompatible runtime protocol versions require a runtime update before the other app
can connect.

The feed is the public `dovocode/dovo-studio` GitHub repository. A source push alone is not a binary
release. The Release workflow produces:

| Platform | Architectures | Artifacts              | Signing                           |
| -------- | ------------- | ---------------------- | --------------------------------- |
| macOS    | ARM64         | DMG, ZIP, mise archive | Developer ID signed and notarized |
| Windows  | x64, ARM64    | NSIS EXE installer     | Unsigned                          |
| Linux    | x64, ARM64    | DEB, RPM, AppImage     | Unsigned                          |

Standalone server archives support macOS ARM64, Linux x64/ARM64 and Windows x64/ARM64. Each desktop
build uses its native runner and Node 24, packages its matching SQLite/PTY dependencies, and
smoke-tests the bundled runtime and terminal. Windows ARM64 has a separate update channel to avoid
overwriting x64 metadata. AppImage uses architecture-specific Linux update metadata. DEB/RPM users
install a new package through their package manager; Check for Updates opens the release download
page. Artifacts are not a promise of compatibility with every historical Debian/Fedora/CentOS
release.

Linux builds use the same desktop identity for Wayland, X11 and packaged launchers. On first launch,
an AppImage registers a user-local launcher and persistent Dovo icon under `$XDG_DATA_HOME` (or
`~/.local/share`). Later launches update its executable path after an AppImage move or upgrade.
Existing user-owned launchers are preserved; DEB/RPM launchers are installed by the package manager.

For a standalone Linux server, [the one-command installer](server-setup.md) selects and verifies the
matching server archive, registers the user service, and uses the same command for upgrades.

1. Update the root `package.json` version and mobile `app.json` version as appropriate.
2. Verify with `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm build`.
3. Configure Mac-only GitHub Actions secrets: `MAC_CERTIFICATE` (Developer ID `.p12` as base64),
   `MAC_CERTIFICATE_PASSWORD`, `MAC_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
   and `APPLE_TEAM_ID`. Do not commit signing material. Windows/Linux need no signing secrets.
4. Run **Release** manually with a matching `vX.Y.Z` tag, or push that tag. All jobs build the
   selected commit. The workflow creates a draft and verifies every expected architecture/format and
   update feed. Inspect the artifacts and publish the draft only after native installation tests.
5. On an older install, exercise download, Later, restart/install and retained runtime data.

Check runs the full build, lint, typechecks and test suite on Linux, with separate macOS and Windows
native/process tests. New pushes cancel superseded Check runs. Release jobs install and build once
per native platform, deploy one private production runtime, then package desktop and server in
parallel. The extracted Windows server still exercises setup, start, status and stop.

Both workflows cache the pnpm package store and registry metadata. Metadata entries refresh daily;
frozen-lockfile supply-chain checks remain enabled. Release jobs also cache Node headers and
Electron packaging downloads, separated by job, operating system, architecture and Node version.
Build and typecheck tasks use Vite Task's content-validated cache, scoped to exact Node versions and
lockfiles. Tests, packaging, signing and notarization always run. The desktop content stamp accepts
restored outputs with old timestamps and rejects outputs that differ from the current sources.

To inspect local cache hits, repeat `pnpm build` or `pnpm typecheck`, then run
`pnpm exec vp run --last-details`. Compare warm GitHub job timings as well as restore/save costs
before changing package-store caching; large native stores can take longer to restore than small
task results. Cold runs after dependency or toolchain updates remain necessary.

Merging into `main` builds and publishes `vX.Y.Z-nightly.N` automatically after all platform
artifacts pass verification. Nightly releases are GitHub prereleases and do not replace the latest
Stable release. Their release notes list commit messages since the previous published nightly,
including direct commits to main. Failed draft builds do not advance that baseline. They include
separate signed **Dovo Studio (Nightly)** Mac bundles, Windows/Linux installers, server archives,
update metadata, Homebrew definitions, and a pinned mise config. The Stable release remains an
explicit review and publish step. When preparing the next Stable version, update the
`version_prefix` for both Nightly tools in `distribution/mise.toml` to the new base version.

Use Node 24, `pnpm build`, then `pnpm exec node scripts/packaging/package-desktop.mjs` on the target
OS and architecture. Append `--dir` for an unpacked build. Linux packaging requires Ruby/FPM and RPM
tools. Only macOS publishing with `--publish` requires a Developer ID identity and notarization
credentials. The workflow uses native GitHub-hosted ARM runners; repository/plan eligibility must
allow those runner labels. Unsigned Windows installers may show SmartScreen prompts.

To reproduce the shared release staging locally, set `DOVO_PREPARED_RUNTIME` to a new absolute
directory, run `pnpm run package:prepare-runtime`, then `pnpm run package:platform` with the same
environment. Keep `DOVO_RELEASE_VERSION` and `DOVO_RELEASE_CHANNEL` consistent across both commands.
The prepared runtime is checked against compiled inputs, release version, Node, OS and architecture;
it is private staging within one build, rather than a persistent dependency cache.

The signed macOS job uses macOS 26 and Xcode 26.2 for the Icon Composer asset. Its preflight
compiles the real icon and verifies both `Assets.car` and the legacy `.icns` output; checking the
compiler version alone does not detect incompatible host frameworks. The pnpm patch for
`app-builder-lib@26.15.3` fixes its signing keychain permissions command to use the generated
keychain password rather than the certificate-export password. Keep the signing regression test when
replacing the patch with an upstream fix.

On macOS, local packaging uses an available Developer ID Application identity so updates keep the
same Keychain identity. Set `CSC_NAME` to select a specific identity. Without one, local builds fall
back to ad hoc signing and macOS may ask for Keychain access again after an update. Set
`CSC_IDENTITY_AUTO_DISCOVERY=false` for a local ad hoc verification build without selecting a saved
identity; published updates still require the Developer ID.

## Local iPhone updates

No EAS Update or TestFlight service is used. Settings → App & updates shows the installed version,
checks published GitHub release notes and explains the local install flow.

```sh
git pull --ff-only
pnpm install --frozen-lockfile
# Obtain the device identifier from Xcode or this command:
xcrun devicectl list devices
# Use the Apple team selected in Xcode; keep it stable across installs:
DOVO_APPLE_TEAM_ID=YOUR_TEAM_ID pnpm mobile:update -- --device YOUR_IPHONE_UDID
```

Requires a Mac with Xcode, its signed-in Apple account, CocoaPods, Developer Mode on the phone, and
a trusted, connected and unlocked iPhone. The script builds shared packages, regenerates the native
iOS project including the widget extension, installs Pods, makes a Release build and installs it
over the existing application. It stops on errors and does not uninstall an old version. Both
`com.dovo.studio` and `com.dovo.studio.ExpoWidgetsTarget` need signing with the shared app group
`group.com.dovo.studio`. Live Activities need a new native install; reloading JavaScript is
insufficient.

## Live Activities

On iOS, up to three running task turns appear on the Lock Screen and Dynamic Island. Activities show
a short thread title, current action, project, host device, elapsed time, queued-message count and
Working/Needs input/Done/Failed/Stopped status. Each card shows how many threads are active on its
host; Dynamic Island shows the count or an Input indicator. Tapping opens the thread on its owning
computer. The first task message, project/device selection, provider locking and custom-agent
settings are the same flows as desktop.

Activity IDs survive app restarts. A dismissed activity is not recreated for the same turn.
Finishing work ends its activity; removing a saved computer or disabling Live Activities ends its
local cards. Use Settings → App & updates to disable them. Thread titles and short current-action
summaries are visible on the Lock Screen. Full messages, tool output and approval details are not
included.

**Default: local updates only.** The app starts activities while it is foregrounded and receives
task snapshots. Cards can remain visible after iOS suspends the app, but their content cannot keep
updating without APNs; stale content is marked after two minutes. Opening the app reconciles the
current state. Tasks started entirely while the app is suspended do not create a new activity
remotely.

### Optional background push (disabled by default)

This setup is deferred until you choose to enable APNs. To enable it later:

1. Create an APNs signing key in your Apple Developer account. Store the `.p8` outside this repo
   with access restricted to the runtime user. Enable Push Notifications for the application ID.
2. Rebuild the phone app with `DOVO_APPLE_TEAM_ID`. Live Activity push and frequent updates are
   enabled by default; `DOVO_LIVE_ACTIVITY_PUSH=0` opts out.
3. Set these variables in **each task-host runtime's environment** before starting/restarting it:

   ```sh
   export DOVO_APNS_KEY_PATH=/private/path/AuthKey.p8
   export DOVO_APNS_KEY_ID=YOUR_KEY_ID
   export DOVO_APNS_TEAM_ID=YOUR_TEAM_ID
   export DOVO_APNS_BUNDLE_ID=com.dovo.studio
   export DOVO_APNS_ENVIRONMENT=sandbox
   ```

   Use sandbox for development-signed local installs; distribution-signed apps use production. No
   Apple key is sent to the phone or stored in workspace JSON. Background updates travel directly
   from the runtime to Apple's HTTPS/HTTP2 APNs service; an Internet-facing Dovo relay is
   unnecessary.

4. Start a task while the app is open, then lock the phone. Verify input-needed, completion and
   failure updates. Authenticated `GET /api/live-activities/status` reports configuration/delivery
   problems.

Per-activity push tokens are scoped to the paired device, excluded from request logs and retained in
the private runtime database for at most eight hours. Revoking a device stops delivery. The runtime
coalesces unchanged states, uses a bounded retry cooldown on failures, and deletes expired tokens.
It can update/end an existing activity while iOS suspends the app; push-to-start is not enabled.

## Standalone runtimes and adapters

For a managed server, pull source then use `pnpm server update --data-dir /path/to/runtime`. This
stages/builds the new runtime, validates it, backs up SQLite, switches the managed process and rolls
back on startup failure. See [server setup](server-setup.md) for ownership and recovery details.
`pnpm server doctor --check-updates` checks adapter versions independently of app releases. Settings
→ Devices & runtime checks the published release for each saved server and shows its changelog and
installed version. A thread shows an update indicator for its execution host. Servers installed by
the Linux one-command installer or a managed Homebrew service can update from Settings; their
downloads are staged and verified while the current runtime stays online, then the service restarts
after active work finishes. Source, mise and externally managed servers show the release and use
their existing host upgrade procedure. Servers built before this feature need one host-side update
before they can report their installed release and accept in-app updates.

References: [Expo Widgets](https://docs.expo.dev/versions/latest/sdk/widgets/),
[electron-builder updates](https://www.electron.build/docs/features/auto-update/).

## Homebrew and mise

The release workflow builds standalone server archives for macOS arm64, Linux arm64/x64 and Windows
arm64/x64, with Node 24 and native dependencies included. Windows archives are ZIPs with a
`bin/dovo-server.cmd` launcher; macOS/Linux use tar.gz. Linux archives are built on Ubuntu 24.04
(glibc); Alpine/musl is not supported. Agent CLIs and Git remain host tools, so existing signed-in
accounts and project directories work.

**These commands become available after the first signed stable release is published.** A source
push does not make downloadable installers. The `Release` workflow creates a draft containing server
archives, the signed desktop ZIP/DMG and a desktop mise archive. Publish only after all jobs
succeed. `Update Homebrew and mise distribution` then computes SHA-256 hashes, attaches `mise.toml`
and `SHA256SUMS`, and commits `Formula/` and `Casks/` to the default branch. It refuses incomplete
or older releases. The same repository acts as the tap; no separate tap token is needed. If branch
protection disallows the bot push, apply the generated definitions through your normal PR flow. The
workflow can be rerun with a published tag.

```sh
brew tap dovocode/studio https://github.com/dovocode/dovo-studio
brew install dovocode/studio/dovo-server
brew install --cask dovocode/studio/dovo-studio
brew install dovocode/studio/dovo-server-nightly
brew install --cask dovocode/studio/dovo-studio-nightly

dovo-server setup --host local
dovo-server start
dovo-server pair
```

The server uses `~/.dovo` by default; `--data-dir` selects another workspace. Installing or removing
a package does not delete data or pairings. This formula uses Dovo's managed background process, not
`brew services`. For updates, finish active work, run `dovo-server stop`, then
`brew upgrade dovocode/studio/dovo-server` and `dovo-server start`. Desktop users can use
`brew upgrade --cask dovocode/studio/dovo-studio` or the app's updater.

For mise, merge the relevant entries from [distribution/mise.toml](../distribution/mise.toml) into
your personal or project mise config. The two aliases select different assets from the same GitHub
release, and `bin_path` exposes `dovo-server` and `dovo-studio` without exposing bundled Node.
Nightly entries select prereleases and expose `dovo-server-nightly` and `dovo-studio-nightly`. On
Linux and Windows, select only `dovo-server`. The `dovo-studio` command launches its versioned macOS
app bundle. Use `mise install`, then `mise exec -- dovo-server --help` or
`mise exec -- dovo-studio`. `mise upgrade dovo-server` / `mise upgrade dovo-studio` select newer
releases. Stop the server before upgrading and start it again afterward; close the desktop app
before replacing its version. For strictly pinned deployment, use the release's attached
`mise.toml`, which includes exact versions and platform-specific SHA-256 checksums. The pinned HTTP
entries update by adopting a newer release config, while the GitHub aliases support release
discovery. Use `mise lock` to lock alias downloads.

Package-manager installs deliberately do not invoke the source checkout's `dovo-server update` flow
or redirect to a previously staged source release. Their selected package controls the server
version. Test a locally built archive with `pnpm run package:server` under Node 24. Generate
tap/checksum metadata with
`node scripts/packaging/generate-distribution.mjs release release/distribution VERSION`.

Installer references: [Homebrew taps](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap),
[mise GitHub backend](https://mise.jdx.dev/dev-tools/backends/github.html).

### Configure Mac signing from this Mac

In Keychain Access → My Certificates, locate **Developer ID Application: Dovocode (VDXV4YX2UK)**.
Expand it to confirm the private key exists, then export that identity as a password-protected
`.p12`. Do not export all identities or the Apple Development certificate. Keep the file outside the
repository.

At [Apple Account](https://account.apple.com), create an app-specific password under Sign-In and
Security → App-Specific Passwords, named “Dovo GitHub notarization”. Run the following in Terminal
from the repository:

```sh
python3 scripts/setup-mac-signing.py
```

The helper checks the exported certificate, Team ID, expiry and private-key presence before
uploading the six required secrets directly to `dovocode/dovo-studio`. Password prompts are hidden;
secret values go to `gh secret set` over stdin, never command arguments or logs. It does not
validate the Apple account credentials: the release job verifies notarization with Apple. It
requires `gh` to already be signed in with permission to manage this repository's Actions secrets.

### Remote and batch upgrades

Desktop **Settings → Devices & runtime** and mobile **Computers** show a Computer updates panel.
Check releases, review each host's release notes, then update one computer or select several and use
**Update selected**. Each host reports its own download progress and failure; one failure does not
stop the remaining requests. Offline computers and hosts with running work cannot be updated.

Dovo-managed Linux archive servers prepare the update, verify it, then restart. Their update helper
runs in a separate systemd user service so stopping Dovo does not stop the updater. Clients keep
probing the saved connection during the interruption and verify the installed version before marking
an upgrade complete, including when a newer release was installed during recovery. Package-manager
and externally launched servers still require their host's upgrade flow. Supported signed desktop
apps (macOS, Windows, and Linux AppImage) must be open on the host to accept remote updates. They
download first and wait for **Restart and install** or **Restart selected desktops**. A desktop
upgrade also upgrades its bundled runtime; it is one installation, not two separate upgrades. If the
initiating desktop is selected for restart, its command is sent last.

A lost download or restart reply triggers status checks rather than resending the command. If the
host reports that it did not accept the request, retry explicitly. Errors remain visible until a
retry or verified recovery. Linux hosts also compare saved helper progress with their running
release, so a successful upgrade does not remain stuck if the helper missed its final status write.

Remote desktop control goes through the existing authenticated runtime connection, including HTTP
LAN/VPN connections. The native updater exposes only a private loopback bridge with an owner-only
credential file. It does not expose that credential to paired clients. After installing this release
once on a desktop host, the remote controls become available to its paired devices.

A separately installed server can also update a desktop app running under the same OS user. The app
publishes its private bridge in `~/.dovo/desktop-update-host.json`, including its installed version.
Computer updates lists **Server** and **Desktop** independently; updating the desktop does not
replace or restart the separately installed server. The desktop target stays visible during its
restart, and completion checks the app's version rather than the server's version. Both the host app
and server need this release once before standalone-server discovery is available.
