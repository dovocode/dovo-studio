# Releases, updates and iPhone Live Activities

Dovo keeps application updates separate from agent adapter updates and runtime data. Neither desktop
updates nor local iPhone installs uninstall the old app or erase pairings. Keep the same bundle ID
and Apple signing team between iPhone builds.

## Desktop

Installed builds use **Dovo Studio → Check for Updates…** (also in Help). The flow checks the latest
stable GitHub Release, asks before downloading, shows download progress in the Dock/taskbar, then
asks before restarting. Installation checks the local runtime and waits if tasks or automations are
running. Choosing Later does not install unexpectedly on quit. Remote runtimes are not restarted.
Source builds explain how to update the checkout instead of attempting an installer update.

The feed is the public `dovocode/dovo-studio` GitHub repository. It must contain signed macOS arm64
ZIP/DMG artifacts, blockmaps and `latest-mac.yml` generated together by electron-builder. A source
push alone is not a binary release. macOS updating requires a Developer ID signed app.

1. Update the root `package.json` version and mobile `app.json` version as appropriate.
2. Verify with `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm build`.
3. Configure GitHub Actions secrets: `MAC_CERTIFICATE` (Developer ID `.p12` as base64),
   `MAC_CERTIFICATE_PASSWORD`, `MAC_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
   and `APPLE_TEAM_ID`. Do not commit signing material.
4. Run the **Release** GitHub Action manually from `main` with a matching `vX.Y.Z` tag, or push that
   tag. The workflow checks the version and signing secrets before creating/updating a **draft**,
   builds macOS arm64/Node 24 desktop and standalone server archives, and verifies the expected
   assets. For the first release, run it with `v0.0.1`; an existing empty draft is reused. Inspect
   the artifacts, signing and notarization, then publish the draft.
5. On an older signed install, exercise download, Later, restart/install and retained runtime data.

For a local package use Node 24, `pnpm build`, then `node scripts/packaging/package-desktop.mjs`.
Append `--dir` for a directory build or `--publish` for a signed draft GitHub Release. Local
unsigned builds are for development, not a working update feed.

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
a short task title, project, host device, elapsed time and Working/Needs input/Done/Failed/Stopped
status. Tapping opens the thread on its owning computer. The first task message, project/device
selection, provider locking and custom-agent settings are the same flows as desktop.

Activity IDs survive app restarts. A dismissed activity is not recreated for the same turn.
Finishing work ends its activity; removing a saved computer or disabling Live Activities ends its
local cards. Use Settings → App & updates to disable them. Task titles are visible on the Lock
Screen; prompts, command output, credentials and approval contents are not included.

**Default: local updates only.** The app starts activities while it is foregrounded and receives
task snapshots. Cards can remain visible after iOS suspends the app, but their content cannot keep
updating without APNs; stale content is marked after two minutes. Opening the app reconciles the
current state. Tasks started entirely while the app is suspended do not create a new activity
remotely.

### Optional background push (disabled by default)

This setup is deferred until you choose to enable APNs. To enable it later:

1. Create an APNs signing key in your Apple Developer account. Store the `.p8` outside this repo
   with access restricted to the runtime user. Enable Push Notifications for the application ID.
2. Rebuild the phone app with `DOVO_LIVE_ACTIVITY_PUSH=1` (plus `DOVO_APPLE_TEAM_ID`).
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
`pnpm server doctor --check-updates` checks adapter versions independently of app releases.

References: [Expo Widgets](https://docs.expo.dev/versions/latest/sdk/widgets/),
[electron-builder updates](https://www.electron.build/docs/features/auto-update/).

## Homebrew and mise

The release workflow builds a standalone server archive for macOS arm64 and Linux arm64/x64, with
Node 24 and native dependencies included. Desktop releases target macOS arm64. Linux archives are
built on Ubuntu 24.04 (glibc); Alpine/musl and Windows are not release targets. Agent CLIs and Git
remain host tools, so existing signed-in accounts and project directories work.

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
release, and `bin_path` exposes `dovo-server` and `dovo-studio` without exposing bundled Node. On
Linux, select only `dovo-server`. The `dovo-studio` command launches its versioned macOS app bundle.
Use `mise install`, then `mise exec -- dovo-server --help` or `mise exec -- dovo-studio`.
`mise upgrade dovo-server` / `mise upgrade dovo-studio` select newer releases. Stop the server
before upgrading and start it again afterward; close the desktop app before replacing its version.
For strictly pinned deployment, use the release's attached `mise.toml`, which includes exact
versions and platform-specific SHA-256 checksums. The pinned HTTP entries update by adopting a newer
release config, while the GitHub aliases support release discovery. Use `mise lock` to lock alias
downloads.

Package-manager installs deliberately do not invoke the source checkout's `dovo-server update` flow
or redirect to a previously staged source release. Their selected package controls the server
version. Test a locally built archive with `node scripts/packaging/package-server.mjs` under
Node 24. Generate tap/checksum metadata with
`node scripts/packaging/generate-distribution.mjs release release/distribution VERSION`.

Installer references: [Homebrew taps](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap),
[mise GitHub backend](https://mise.jdx.dev/dev-tools/backends/github.html).
