# Run Dovo on your own computer or server

A Dovo runtime owns projects, tasks, Git operations, agent sessions, terminals, scheduled jobs, and
SQLite persistence. Desktop, web, and mobile are clients of that runtime. A phone connects directly
to the host over LAN, Tailscale, NetBird, or an HTTPS reverse proxy; Dovo provides no cloud relay.

The thread list syncs status and editable drafts; opening a conversation subscribes to its history.
Split panes subscribe to both conversations. Search runs on each connected runtime, so it can find
messages in threads that have not been opened. Previously opened history stays available in the
local cache while offline; an uncached thread waits for its host instead of appearing empty. When
the host reports a history removal or rewind, clients invalidate older cached history and reload the
expanded conversation. Offline clients wait for the host if their saved history predates that
change.

Delegated agents appear as active pills on their main thread. Completed agents remain in the
thread's **Agents** view. Settling, snoozing, archiving, restoring, or deleting a thread applies to
all its delegated descendants. Stop active work and close live terminals before archiving or
deleting the family.

Desktop and mobile save supported actions before sending them, separately from the read cache.
Reconnect delivers them in order using persistent action IDs. A lost response returns the runtime's
saved result instead of repeating an action. If a runtime interruption leaves an action uncertain,
review the host's current state and discard that saved action before issuing it again. Connection
status exposes pending actions with retry and discard controls. Older runtimes still accept new
actions, but must be updated before saved actions can be recovered safely. Pending actions must be
recovered or explicitly discarded before forgetting a paired runtime. Browser tabs share one
transactional action journal, so a write or acknowledgement in one tab preserves actions saved by
another.

Sync uses bounded cursor replay during brief disconnects and a scoped baseline after a restart or
expired cursor. `node scripts/check-runtime-sync.mjs` (after building the runtime) verifies both
paths and reports payload sizes. Connections remain direct over HTTP or optional HTTPS, with pairing
codes and device tokens; no relay or account is required.

Use the background server when work should stay available after closing the desktop app or shell. It
survives those applications closing, but this command does **not** install a boot service, prevent
computer sleep, or automatically restart a crashed process.

The desktop app includes copyable Linux installation and pairing commands under **Settings → Devices
& runtime → Set up Linux server**. Choose Stable or Nightly, run the commands on the new host, then
select **Server ready — connect computer** to pair it.

For a server-only macOS or Linux host, use a user-level service instead:

On Linux x64/arm64, the quickest path needs Bash, curl, jq, tar, sha256sum, and a running systemd
user manager:

```sh
bash -o pipefail -c 'curl -fsSL https://raw.githubusercontent.com/dovocode/dovo-studio/main/scripts/install-linux-server.sh | bash'
~/.local/bin/dovo-server pair
```

Run the same installer again to upgrade. It downloads only the matching server archive, verifies
GitHub's SHA-256 digest before extraction, installs a user service, and switches the service to the
new release only after the new launcher passes its checks. The previous release remains available
for rollback. Use `bash scripts/install-linux-server.sh --data-dir /path/to/workspace` from a
checkout if you need a custom data directory. For Nightly, use `bash -s -- --channel nightly` after
the pipe in the quoted command. Run as your normal user, without `sudo`. To keep the service running
after logout or boot, an administrator can enable user lingering with
`sudo loginctl enable-linger "$USER"`. A failed update keeps the existing data and pairings.

Release checks use `GH_TOKEN`, then `GITHUB_TOKEN`, then an existing GitHub CLI login
(`gh auth token --hostname github.com`) to avoid GitHub's unauthenticated API rate limit. If `gh` is
missing or signed out, installation and updates still try anonymously. Run `gh auth login` as the OS
user that runs Dovo to enable this fallback. Tokens are used only for GitHub API metadata; public
archive downloads remain unauthenticated.

```sh
# From a source checkout:
pnpm server service install --host 0.0.0.0
pnpm server service status
pnpm server pair

# Or after installing the packaged dovo-server command:
dovo-server service install --host 0.0.0.0
dovo-server service status
dovo-server pair
```

The install command creates or reuses the same data directory, builds source installs, captures only
supported provider environment variables in a private file, registers launchd or systemd for the
current user, and starts the runtime. Use `--data-dir` on every command when using a nondefault
workspace. An existing runtime must be stopped before registering its service; the command never
starts a second process on its database. Pairing still requires a code and device token, and HTTP
LAN/VPN addresses remain supported.

Use `server service restart` after changing settings or credentials, and `server service update` to
stage and verify a source checkout update before restarting. On macOS, a Homebrew-installed server
can use `dovo-server service update` to upgrade its formula and restart. For mise or manually
extracted packages, install the new release with that tool and run
`dovo-server service update --launcher /absolute/path/to/new/bin/dovo-server` from the current
installation. `server service remove` unregisters and stops the service while preserving its
database and pairings. macOS starts the LaunchAgent at login; Linux enables a systemd user unit.
Linux boot startup without a login session requires your administrator to enable user lingering.

On Linux, service restart/update reloads systemd units and repairs the quoted `WorkingDirectory`
written by older versions. If an older installation reports
`WorkingDirectory= path is not absolute`, remove the surrounding quotes from that directive in its
`~/.config/systemd/user/dovo-server-*.service` file, run `systemctl --user daemon-reload`, then
restart that service. Reloading alone does not fix an invalid path. Updating or removing the service
preserves its database and pairings.

## Crash records

If the runtime process ends on an uncaught exception, it writes `last-crash.json` beside its
database and exits non-zero so its supervisor restarts it. The next start shows the time and message
in **Devices & runtime** until you dismiss it. The desktop app relaunches a local runtime that exits
unexpectedly, backing off from two seconds to a minute and giving up after six attempts in a row
with a dialog that names the reason. A renderer window that crashes reloads once; a window that
stops responding offers to wait or reload. On the phone, an unexpected error is kept on the device
and shown once in **Settings**; nothing is reported anywhere.

## Packaged Mac desktop

The packaged Mac app provisions a per-profile launchd agent when no existing runtime is available.
The runtime stays running after **Quit**, starts at login, and restarts after a crash. Existing
external runtimes are attached without restarting them. Development desktop and other platforms
continue to use the explicit background-server commands below.

The agent lives at `~/Library/LaunchAgents/com.dovo.studio.runtime.<profile-hash>.plist`; its
`DOVO_DATABASE_PATH` identifies the desktop profile. Logs are in `runtime-service.log` in that data
directory. The plist is private to your account. The service uses the bundled Node runtime and the
same owner credential, database, saved bind address, and device pairings as desktop. Keep the app at
its installed location. The desktop updater unloads its own service before replacing the app bundle;
the restarted app provisions the new runtime. Failed installation restores the previous service. An
externally managed runtime must be stopped or updated through its own supervisor. Desktop checks the
runtime protocol version before attaching, so incompatible builds produce an explicit error. The
window and updater remain available for recovery. Runtime connection requests are blocked while an
update is pending and become available again if installation fails.

Provider credentials and supported network settings supplied on the first launch are saved in
`runtime-environment.json` in the profile directory, with owner-only permissions. The plist contains
the path to that file plus `NODE_EXTRA_CA_CERTS` and `SSL_CERT_FILE` paths, which Node must receive
before startup. Provider credentials stay in the private JSON file. Later GUI launches retain the
saved settings. Supported values include `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
`ANTHROPIC_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, OpenAI organization/project IDs, GitHub
tokens, proxy/CA settings and the explicit Bedrock/Vertex settings listed in
`apps/api/src/runtime-environment.ts`. Unrelated environment variables and `NODE_OPTIONS` are
excluded. Edit this JSON object and restart the service to change settings; an empty string clears a
captured value. Never commit this file or include it in bug reports. For CA path changes, quit
desktop, unload the launch agent as below, then reopen desktop to regenerate its startup
environment.

To stop and remove a provisioned service, quit desktop, then substitute its actual plist filename:

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/<agent-filename>.plist"
rm "$HOME/Library/LaunchAgents/<agent-filename>.plist"
```

This preserves your workspace. Opening packaged desktop again provisions the service again. A login
agent cannot keep the runtime reachable while the Mac is asleep or logged out.

## Prerequisites

- Node **24.11 or newer** and the pnpm version pinned in the root `package.json`.
- This repository and its locked dependencies. Run commands from its root.
- Git; GitHub CLI (`gh`) and `gh auth login` for GitHub PRs and private GitHub repositories.
- The agents you want to use, installed and authenticated **on the runtime host**, under the same
  operating-system account that runs Dovo. See [agent adapters](#agent-adapters-and-updates).
- Reachability between client and server: the same LAN or a connected private VPN on both devices.

Install and build the server dependencies:

```sh
pnpm install
pnpm --filter @dovo/api... -r build
```

Native SQLite and terminal dependencies must match the server's operating system, CPU architecture,
and Node installation. Run the install on that host; do not copy `node_modules` from another OS.

## Keep your existing desktop workspace

Do this before creating a fresh server if you already have tasks on desktop. Both clients must use
the **same data directory**. A second directory is a separate workspace with separate pairings.

Desktop keeps runtime history and encrypted saved connections under `~/.dovo/desktop`, with
preferences in `~/.dovo/settings.json`. Electron's browser storage and caches use the operating
system's application-data directory. Upgrading moves a legacy workspace after stopping its managed
runtime and restores known Electron storage files to the native profile without overwriting existing
files. Unknown files remain in the workspace. An explicit `--user-data-dir` keeps its isolated
runtime and Electron profile at the selected location. Phone-local data stays on the phone.

Development desktop uses `~/.dovo-dev/desktop` and `~/.dovo-dev/settings.json`, a separate native
`Dovo Studio (Dev)` Electron profile, and external port 8788 by default. The internal desktop
connection uses a free loopback port. It starts with its own workspace and never imports production
data. Development worktrees, agent installs, and device helpers also stay under `~/.dovo-dev`. The
API development command likewise defaults to `~/.dovo-dev/runtime.sqlite` and port 8789, with custom
ports supported. Production supervisor environment files are not inherited by development launches.
For CLI pairing during development, use
`pnpm pair --connection ~/.dovo-dev/desktop/runtime-connection.json` (desktop) or
`pnpm pair --connection ~/.dovo-dev/runtime-connection.json` (API).

Older development desktop data on macOS is normally:

```text
~/Library/Application Support/@dovo/desktop
```

Older packaged desktop commonly uses `~/Library/Application Support/Dovo Studio`. If that profile
has no runtime data or saved connections, desktop reuses an existing `@dovo/desktop` workspace
automatically before migration. An already configured packaged profile takes precedence over the
development profile. If both the old and new locations contain workspace data, desktop retains the
old profile and reports the conflict rather than overwriting either. On Linux, check
`$XDG_CONFIG_HOME` or `~/.config`; on Windows, check `%APPDATA%`. Select the directory that contains
your existing `runtime.sqlite`. Do not move or copy a running SQLite database by itself.

Close desktop first if it currently owns the runtime, then:

```sh
pnpm server setup --data-dir "$HOME/Library/Application Support/@dovo/desktop"
pnpm server start --data-dir "$HOME/Library/Application Support/@dovo/desktop"
pnpm server status --data-dir "$HOME/Library/Application Support/@dovo/desktop"
pnpm server pair --data-dir "$HOME/Library/Application Support/@dovo/desktop"
```

Setup retains an existing `server.json`, or reuses the bind address and port in
`runtime-listen.json`. It does not replace the database, device pairings, or owner credential.
Desktop now attaches to an authenticated server already running in its own data directory and leaves
that external server running when desktop closes.

If the saved bind is loopback, make it reachable before starting:

```sh
pnpm server setup --data-dir "$HOME/Library/Application Support/@dovo/desktop" --host 0.0.0.0 --port 51464
```

Use `restart` after changing settings on a running managed server. Setup saves configuration; it
does not change a live listener.

## Create a fresh server

```sh
pnpm server setup
pnpm server start
pnpm server pair
```

Defaults are `~/.dovo`, bind `0.0.0.0`, and port `51464`. Setup and start are separate so you can
inspect the configuration before launching. `start` runs Node in the background and waits for an
authenticated health check. Repeating `start` uses the healthy existing process rather than opening
a second process over its database.

Use `--data-dir /absolute/path` on **every** command when selecting another workspace. With no
explicit directory, `DOVO_DATABASE_PATH` selects its parent directory; otherwise `~/.dovo` is used.
For a nonstandard database filename, setup accepts `--database /data/dovo/custom.sqlite`; the file
must be inside the selected data directory.

## Lifecycle commands

| Command                              | Behavior                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `pnpm server setup`                  | Save validated host, port, database, and optional advertised address.                        |
| `pnpm server start`                  | Start independently of the current terminal and desktop application.                         |
| `pnpm server status`                 | Show health, process ownership, actual address, reachable interface addresses, and log path. |
| `pnpm server stop`                   | Gracefully stop a process launched by `server start`. Preserve workspace and credentials.    |
| `pnpm server restart`                | Stop and start with the saved configuration and selected release.                            |
| `pnpm server pair`                   | Create a short-lived pairing code for this data directory.                                   |
| `pnpm server doctor`                 | Inspect runtime health, local Node/platform, configured adapter executables and SDKs.        |
| `pnpm server doctor --check-updates` | Also compare adapter versions with the official npm registry.                                |
| `pnpm server update`                 | Build and activate an isolated release of the current source checkout.                       |

All accept `--data-dir` and `--json`. JSON never includes permanent owner tokens. An offline
`status`/`doctor` exits nonzero. `stop` refuses to signal a process belonging to another launcher or
one whose identity it cannot verify. Stop desktop, a foreground API, or an OS service using its
original launcher instead.

Inspect logs with your usual tools:

```sh
tail -n 100 "$HOME/.dovo/server.log"
tail -f "$HOME/.dovo/server.log"
```

## LAN, Tailscale, NetBird, and DNS

`--host` controls where the runtime **listens**. It accepts `0.0.0.0`, an IPv4/IPv6 address,
`localhost`, `local`, `tailscale`, or `netbird`.

```sh
pnpm server setup --host 0.0.0.0 --port 51464
pnpm server restart
pnpm server pair --network local
# Or, after connecting both devices to the chosen VPN:
pnpm server pair --network tailscale
pnpm server pair --network netbird
```

- **Never enter `0.0.0.0` on your phone.** It means all host IPv4 interfaces. Use an address shown
  by `status`/`pair`, such as `http://192.168.1.10:51464` or the host's VPN address.
- `localhost`/`127.0.0.1` on a phone refers to the phone, not the server.
- `--host local`, `tailscale`, or `netbird` resolves to one active interface. If multiple addresses
  match, select an explicit IP. VPN discovery requires its installed CLI on `PATH`; explicit IPs and
  private DNS names work without automatic CLI discovery.
- LAN addresses usually work only on the same network. For cellular/remote access, connect both
  devices to the VPN and use the VPN address. Allow the runtime port in the host firewall and VPN
  access rules.
- An advertised interface address means Dovo is listening there. It does not prove a remote client's
  firewall, DNS, Wi-Fi isolation, or VPN policy permits access.

Save a stable private hostname or reverse-proxy URL:

```sh
pnpm server setup --public-address http://my-computer.internal.example:51464
pnpm server pair
# A one-time override, without editing the saved configuration:
pnpm server pair --public-address https://dovo.example.com
```

`--public-address` changes the address shown to clients; it does not create DNS, configure TLS,
change the bind address, or open a port. It must be a reachable HTTP(S) origin without a path,
query, or embedded credentials. An explicit public address takes precedence over `--network`.

For HTTPS, terminate TLS at your reverse proxy and forward both HTTP and WebSocket traffic to the
runtime. An HTTPS web frontend needs an HTTPS/WSS runtime endpoint because browsers block mixed
content. The native mobile app supports HTTP for user-selected private runtimes; use VPN encryption
or HTTPS for remote transport. Restrict a wildcard listener to networks and peers you intend to
trust. Pairing credentials authorize project files, agents, and shell access.

## Pair phones, browsers, and other computers

1. Run `pnpm server pair` for the correct data directory.
2. On mobile, open **Settings → Devices & runtime → Add computer** (or the initial pairing form).
3. Choose **Scan pairing QR code** and scan the QR printed by the server. Confirm the filled address
   and code, then tap **Connect**. You can also enter the full address and eight-digit code
   manually.
4. Keep both devices reachable while pairing completes. The CLI's default code automatically
   approves one device; `--manual` requires approval on the host.

Codes expire after **two minutes**. Generate a new one instead of retrying an expired code. Share
the short-lived code and reachable address with the intended device; do not share `owner-token` or
`runtime-connection.json`.

For explicit per-device approval:

```sh
pnpm server pair --manual
pnpm server pair devices
pnpm server pair approve <request-id>
pnpm server pair deny <request-id>
```

`devices` lists pending requests and trusted devices, not live network presence. The older
`pnpm pair` command still works and discovers runtime connection files; use
`--connection /path/to/runtime-connection.json` if several hosts are running locally.

Add each computer separately to the client. Tasks, PRs, Issues, Pipelines, Automations and Settings
combine saved hosts while keeping their IDs and credentials separate. Each row shows its computer.
Opening an item selects its owner automatically; projects and terminals continue to run on that
host. Project filters narrow the list without switching runtime. Choose a destination when creating
work or configuring a connection. Offline snapshots remain visible, but cannot run commands on an
unavailable host. See [unified collections](design/source-navigation.md#unified-collections).

Settings shows all hosts together. Open a computer’s row to reconnect it or manage its commands,
activity and trusted devices. Agent, account and resource edits remain bound to their owner without
switching the open workspace.

Mobile credentials are stored in Keychain/Keystore. **Forget computer** removes its saved connection
from that client. Revoke the device on the host to remove its authorization. A normal server restart
does not require pairing again.

## Updating Dovo safely

First obtain the source revision you want using your normal Git workflow. Dovo does not pull, reset,
switch branches, edit dependency versions, or discard local changes for you. The update uses the
current checkout, including intentional local source changes, and its existing lockfile.

```sh
pnpm server doctor --check-updates
pnpm server update
pnpm server status
```

The update command:

1. Copies runtime source, workspace manifests, TypeScript configuration, patches, and the lockfile
   into a private directory under `<data-dir>/releases/`.
2. Installs frozen dependencies there, builds the runtime packages, and smoke-tests a temporary
   in-memory runtime and a real PTY shell. It does not reuse or prune the working checkout's
   `node_modules`, copy repository credentials, or modify the live database during this stage.
3. Leaves the current server running if installation, compilation, or smoke checks fail. The error
   identifies the release's `update.log`.
4. Gracefully stops the managed server after validation, backs up its SQLite database with the
   SQLite backup API, selects the new release, and starts it against the existing workspace.
5. If activation fails and the new process has stopped, restores the database backup and previous
   release, then restarts the previous server when it was running. If a process cannot be stopped,
   it refuses to restore a database underneath that process and reports the recovery paths.

Activation is a brief interruption. Terminals do not survive a runtime restart; active tasks may
become interrupted/failed and require continuation. Finish or stop important running work before
updating. Paired credentials and project paths are preserved. This updates the server, not installed
mobile/desktop application binaries.

Releases and backups are retained for diagnosis/recovery; there is no automatic retention policy.
The selected entrypoint and previous entrypoint are in `server-release.json`. Do not delete a
selected or previous release while it is in use. Backups are in `<data-dir>/backups/`; keep them
private because they contain workspace data and device trust records.

## Agent adapters and updates

```sh
pnpm server doctor
pnpm server doctor --check-updates --json
```

Doctor reads the running runtime's configured CLI paths and agent endpoints. If the runtime is
offline it explicitly falls back to default executable names. Version checks do not submit model
requests, log in, install software, or upgrade anything. An installed executable or healthy server
does not prove the provider account has valid model access or quota.

| Adapter  | What Dovo uses                                                                  | Update the component actually in use                                                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex    | Host `codex` executable/App Server                                              | Use its original installer: npm, Homebrew, mise, or another managed installation. For an npm installation: `npm install -g @openai/codex@latest`.                                                                                                                       |
| Claude   | Bundled Agent SDK plus user-installed Claude CLI on the runtime host            | Update Dovo for its locked SDK. Use `claude update` for a native CLI installation, or the original package manager for a managed/custom executable.                                                                                                                     |
| OpenCode | OpenCode CLI or an explicitly configured server, plus Dovo's bundled client SDK | Upgrade OpenCode on the runtime host using its installer or `opencode upgrade`. With a blank server URL, Dovo owns the local server; restart the Dovo runtime after upgrading. For explicit URLs, restart the external OpenCode server. Update Dovo for its client SDK. |
| ACP      | The custom agent's configured executable and bundled ACP SDK                    | Update that agent through its own installer. There is no universal executable or version for every ACP agent.                                                                                                                                                           |
| MCP      | Bundled MCP SDK and separately configured project/agent servers                 | Update Dovo for its SDK; update individual MCP servers using their configured package or deployment.                                                                                                                                                                    |

`--check-updates` queries official npm metadata and reports current, update available, ahead, or
unknown. Registry/network failures remain unknown; they are not treated as proof that a component is
current. A newer upstream version is information, not a compatibility guarantee. Locked SDK updates
should pass the repository's adapter tests before deployment.

Configure executable paths in **Settings → Coding → CLI commands & shell**. Provider authentication
stays on the host. Authenticate `gh` on that host for PRs; authenticate the chosen agent separately.
OpenCode requires its server to be running; installing its CLI alone is not enough. Dovo detects
OpenCode 1 and 2 from the configured Serve URL and uses the matching client protocol.

## Caching and offline behavior

The runtime keeps PR pages and details in SQLite, with up to 500 cached entries. Results older than
60 seconds can be shown while a refresh runs in the background. Visible clients automatically
revalidate their cached views; Refresh requests an immediate check. A cached approval or check
result is not a live merge-readiness guarantee.

Desktop/web and mobile also retain a workspace snapshot and up to 100 successful read responses per
saved runtime. Browser storage uses IndexedDB; native mobile uses app-private files so large
histories do not exceed Android AsyncStorage limits. Entries are scoped to the runtime origin and a
credential hash, so data from two hosts or different credentials cannot replace one another. The
credential itself stays in the connection's credential storage, not the cache key.

Cached tasks, messages, PRs, issues, and pipeline details make reopening screens faster and preserve
context during a network outage. They remain stale until the host is reachable again. Cached reads
do not queue or authorize offline mutations: sending messages, running agents, applying edits, and
terminal input require the correct live runtime. **Forget computer** removes that host's local
cached data alongside its saved connection. This does not delete the workspace on the server.

Desktop workspace edits use a separate durable outbox, scoped to the same host and credential. The
working workspace and pending changes are saved before a patch is sent. After an interrupted session
or cold restart, pending edits remain visible and **Retry sync** resumes them explicitly. Host
snapshots cannot replace those pending edits. **Reload host workspace** first preserves a local
recovery backup, then clears the outbox; forgetting a host is blocked while its pending edits remain
unresolved. These saved edits do not start agents or run terminal commands while offline.

During migration from older clients, a previous local workspace whose edits cannot be attributed to
a host is preserved as `dovo.workspace.v1.before-outbox-migration` in IndexedDB, with a recovery
notice when it differs from the saved host snapshot. Corrupt pending outboxes are preserved and
reported rather than automatically deleted as disposable cache entries.

Unchanged authenticated snapshot polls use ETags and HTTP 304 responses without another snapshot
body. The bounded in-memory response cache is separate from persistent offline data; it expires
after five idle minutes and is limited to eight credential/origin entries and 32 MiB. Authentication
is still checked for each poll, and changes to approvals, devices, or other live state invalidate
the validator even when the workspace revision has not changed. Unchanged snapshot polls also skip
repeated workspace/cache writes. Offline snapshot metadata is refreshed at least once a minute while
connected; changed snapshots or PR counts are saved sooner. Local desktop edits still enter the
durable outbox immediately before transmission.

## Files, backups, and recovery

| Data-directory entry                           | Purpose                                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `settings.json` (at `~/.dovo/`)                | Desktop and runtime preferences.                                                  |
| `runtime.sqlite` (or configured filename)      | Workspace, history, device trust, job state, and server-side caches.              |
| `owner-token`                                  | Persistent desktop/server owner credential; owner-only permissions.               |
| `runtime-connection.json`                      | Live local CLI discovery, including owner credentials; removed on clean shutdown. |
| `runtime-listen.json`                          | Desktop's saved listening address, reused during setup.                           |
| `server.json`                                  | Durable managed-server configuration.                                             |
| `server-process.json`                          | Managed process identity.                                                         |
| `server.log`                                   | Background runtime stdout/stderr.                                                 |
| `server-release.json`, `releases/`, `backups/` | Selected releases, update logs, and pre-activation SQLite backups.                |

Back up project directories and any associated runtime data/attachment directories alongside the
database; a SQLite backup is not a backup of repository files. Use SQLite's backup API for a live
database, or stop the runtime before copying the complete data directory. Copying only
`runtime.sqlite` while WAL writes are active can lose committed work. Preserve file permissions and
the owner credential. Do not publish backups or runtime connection files in Git.

After restoring, use `setup`/`start` with the restored directory. Database-backed device credentials
must match the clients' saved credentials; a backup predating a phone's pairing may require pairing
that phone again. Avoid operating two processes over the same database.

## Troubleshooting

Project terminals do not inherit the runtime's `PORT` setting; development servers use their own
defaults or an explicitly configured command port. A terminal connection drop preserves the shell
and its running commands. Reconnecting attaches to that same session and replays recent output;
hide/show also keeps commands running. Closing the terminal tab stops its commands and child
processes.

| Symptom                                      | Check and next action                                                                                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phone says offline or never connects         | Run `server status` on the host. If stopped, run `server start`. Verify host sleep, VPN connection on both devices, and the exact address/port.                                                           |
| Address works on desktop but not phone       | Replace loopback or `0.0.0.0` with LAN/VPN IP or reachable private DNS. Check iOS Local Network permission, firewall, VPN access policy, and Wi-Fi client isolation.                                      |
| Works on Wi-Fi but not cellular              | Use the host's VPN address and connect the phone to the VPN. A private LAN address generally is not reachable over cellular.                                                                              |
| Pairing waits for approval                   | A manual code was used. Run `server pair devices` and approve its request, or generate a default automatic code and retry.                                                                                |
| Pairing code fails                           | Generate a fresh two-minute code from the runtime/data directory matching the phone's address. A code from another runtime cannot pair this one.                                                          |
| Pairing succeeds but later login is rejected | Confirm the saved address still reaches the same workspace, and that the device was not revoked or the database restored. Re-pair only when its credential is no longer valid.                            |
| Multiple runtimes are found                  | Use `server ... --data-dir` or `pair --connection` explicitly.                                                                                                                                            |
| Port is already occupied                     | Check `server status` and `server.log`. Attach to the intended server or stop its owning launcher; do not start a second process over the same database.                                                  |
| `server stop` refuses to stop a process      | It is owned by desktop/another launcher or cannot be authenticated. Inspect the process and use its original launcher; the CLI intentionally does not kill an unrelated PID.                              |
| PRs fail or look stale                       | On the runtime host, run `gh auth status`, check repository permissions/network, then refresh PRs. Cached data may remain visible during an outage; it is not confirmation of the latest remote PR state. |
| An agent does not start                      | Run `server doctor`; check its configured executable, provider login, and server-side logs. Reproduce the provider login/version check under the runtime's OS account.                                    |
| Native SQLite/PTY errors after changing Node | Reinstall/build on that host with its current supported Node, then activate a tested release. Do not reuse native modules built for another Node ABI or architecture.                                     |
| Staged update fails                          | Read its `update.log`. The old runtime continues running when failure occurs before activation. Fix installation/build problems and retry; no Git changes are made automatically.                         |
| Server disappears after reboot or crashes    | Background mode is not a boot service or watchdog. Start it again, or configure the operating system's service manager explicitly.                                                                        |

`GET /health` is an unauthenticated connectivity probe and contains no workspace data. For example,
open `http://<host>:51464/health` from the phone's browser; a healthy response identifies
`dovo-runtime`. `server status` additionally authenticates the stored owner connection.

## Running under an OS service manager

For an always-on host, configure launchd/systemd or your existing process supervisor to run the
foreground API with a supported Node binary, explicit working directory, stable data path, and the
same user's provider credentials. The foreground API accepts:

```sh
DOVO_DATABASE_PATH=/absolute/data/runtime.sqlite DOVO_HOST=0.0.0.0 PORT=51464 node /absolute/checkout/apps/api/dist/index.js
```

Unlike `server setup`, the raw API defaults to loopback and port **8787** when these variables are
absent. It creates/reuses `owner-token` beside the database unless `DOVO_OWNER_TOKEN` is explicitly
provided. Keep environment credentials out of shared unit files and logs.

Use one supervisor. Do not launch `pnpm server start` as a foreground `Type=simple` service, and do
not run the foreground API and background CLI simultaneously against the same directory. An OS
service owns its process lifecycle; manage its restart/update with that supervisor. The CLI's
managed `stop`/`update` flow applies to processes launched by `server start`.

See also the [main README](../README.md) for desktop/mobile builds, feature walkthroughs, extension
boundaries, verification commands, and supported execution behavior.

Runtime and management operations use a persistent `*.lock.sqlite` file for OS-backed ownership. The
adjacent JSON PID record supports diagnostics and older running versions. A crash releases the
SQLite lock automatically; do not delete a lock database to force a second runtime to start.

## Runtime and project task defaults

Open **Settings → Coding → Task defaults** (choose the computer at the top) to configure that
runtime. Open a project's settings and choose **Task defaults** for project overrides. The same
controls are available on mobile under the device and project settings.

- Choose the harness, model/reasoning/service tier, access mode, instructions and optional
  executable or server URL.
- Choose local checkout or a new worktree. **Start from origin** is on by default for new tasks:
  Dovo first fetches origin, then starts new worktrees from origin's copy of the current local
  branch, or origin's default branch (detected from `origin/HEAD`) when origin has no matching
  branch. A failed fetch falls back to the last fetched origin refs. Projects follow their
  computer's choice until they override it. A branch picked for one task, before its first message,
  still wins, including a local branch. Turn **Start from origin** off to use the current local
  branch automatically. Repositories without origin also use their local branch. The project
  checkout itself is never switched.
- Projects inherit unset fields. An agent configuration override replaces the runtime's complete
  agent configuration. **Reset to runtime defaults**, followed by **Save defaults**, removes project
  overrides.
- Defaults are copied into new tasks. Existing conversations retain their settings. Selecting a
  different project in an unsent draft applies the new project's defaults; a selected custom agent
  stays selected.
- Setup commands run only in new task worktrees, using the runtime's configured shell. They have a
  five-minute timeout and stop on shell errors. Successful setup is recorded and is not repeated on
  subsequent turns. Failed setup prevents agent startup; explicitly retrying the task retries setup
  in the existing worktree. Use idempotent commands such as dependency installation. An empty
  project setup override disables inherited setup. Local checkouts never run setup automatically.

These settings are saved on the owning runtime and shared with its paired devices. Runtime
connection and authentication policies are unchanged.

## Choose a project’s execution machine

New-task selection groups registered checkouts with the same Git remote across saved runtimes. It
shows each machine’s availability, local path and branch. The desktop Projects filter groups those
threads together while keeping project settings specific to each machine. SSH and HTTPS remotes are
normalized without exposing embedded credentials; folder names alone never establish a match.
Repositories without an identifiable remote remain separate. Checkout discovery is cached for one
minute.

An unsent draft has a **Run on** selector. Selecting another machine copies its draft text using the
destination project’s defaults, verifies both checkouts still identify the same remote, and archives
the original only after the destination accepts the draft. Nothing starts, and no worktree or setup
command runs, until the first prompt is sent. Started tasks stay on their original runtime.
Concurrent draft edits or a newly started task block archiving and preserve both drafts for
recovery.

Remove draft attachments before switching and attach them on the destination. Linked issue/PR drafts
currently stay on their original machine. No automatic clone or machine pairing occurs; register the
repository on an already paired runtime first.

Project pickers show one expandable group per Git repository, with available machines and checkout
paths beneath it. Mobile's project filter includes matching tasks from every selected machine.
Matching normalizes SSH/HTTPS clone URLs, standard SSH ports, provider alternate SSH endpoints,
Azure DevOps legacy URLs and URL-encoded paths. Git's `insteadOf` rewrites are honored. Without an
`origin`, multiple remotes match only when they all identify the same repository. Forks, ambiguous
remotes and local repositories without a remote stay separate; folder names never establish
identity. Custom SSH host aliases and different self-hosted SSH/HTTPS ports are not inferred as
equivalent.

### Windows standalone server

Download `Dovo-Server-<version>-windows-x64.zip` or `windows-arm64.zip` from the release. Extract
the whole archive to a permanent folder. Node and runtime dependencies are included; you do not need
a separate Node installation. In PowerShell from that folder:

```powershell
.\bin\dovo-server.cmd setup --host local --port 51464
.\bin\dovo-server.cmd start
.\bin\dovo-server.cmd status
.\bin\dovo-server.cmd pair
```

Add the extracted `bin` directory to your user PATH to run `dovo-server` anywhere. The same
`--host tailscale`, `--host netbird`, `--host 0.0.0.0`, and pairing controls apply. Allow the
selected port through Windows Firewall only on the networks you intend to use. Git and your chosen
signed-in agent/provider CLIs must be installed separately.

The server runs in the background; this does not install a Windows service or start at login. Data
lives in `%USERPROFILE%\.dovo` unless you pass `--data-dir`. Before updating, run
`dovo-server stop`, extract the new release to a new folder, update PATH, and run
`dovo-server start` with the same data directory. Keep the entire archive together. Windows server
archives are unsigned. The generated mise configuration includes both Windows architectures.

### Native Windows or WSL in the desktop app

On Windows, desktop setup offers **Native Windows (recommended)** and **WSL 2**. Change the
selection later in **Settings → Computers → Devices & runtime**. Applying a change reopens the
workspace in the selected environment. Finish or stop active runs first; Dovo refuses to switch
while its owned runtime has running tasks. An exited process’s old localhost port is not queried; an
unreachable live process still blocks switching because active work cannot be checked. Connection
polling cannot restart the runtime during a switch. External servers are never stopped by this
choice.

Native mode uses the bundled Windows runtime and your Windows Git, agent installations and logins.
WSL mode lists installed WSL 2 distributions, including distributions with spaces in their names.
Install WSL and a distribution separately with `wsl --install`, then use Refresh. WSL 1 and
musl-based distributions are unsupported; use a glibc distribution such as Ubuntu or Debian.

The repository and task **Open** menus detect installed editors on the selected runtime and hide
missing applications. Native Windows supports File Explorer and installed editors, including VS Code
variants, Cursor, Antigravity IDE, Devin Desktop/Windsurf, Zed, and JetBrains IDEs. WSL discovers
Linux editors and Windows installations through interop. Windows VS Code variants use WSL
integration to open the Linux checkout; File Explorer and other Windows apps receive the converted
Windows folder path. Reopen the menu after installing or removing an editor.

Dovo downloads the exact desktop version’s Linux x64 or ARM64 server archive into the selected WSL
distribution and verifies the published SHA-256 before extracting it. This requires a published
matching release, internet access, `curl`, `tar`, `sha256sum` and `getconf` in the distribution.
Failed installation leaves the current environment selected. Failed runtime startup restores the
previous selection. No Windows Node modules or credentials are copied into Linux.

WSL installations live under `~/.local/share/dovo/desktop/<stable|nightly>/versions/<version>`;
workspace data lives under the corresponding `data` directory. Native workspace data stays in the
existing Windows desktop directory. Switching back restores that environment’s threads and projects;
it does not move them. Agent CLI installations, authentication, Git, setup scripts, terminals,
browser executables and user settings are resolved inside the selected distribution. Install/sign in
to agents there and keep Linux repositories under `/home` for better filesystem performance. Use
Dovo’s Browse picker for Linux folders; the Windows system folder dialog is blocked in WSL mode.
Claude discovery and execution also check its native Linux installation in `~/.local/bin` when the
runtime’s PATH does not include it. Windows Claude installations and logins are separate. Dovo
bundles the Agent SDK; install the Claude CLI in the selected distribution and run
`claude auth login` there. Then use **Refresh providers** in the model picker. Claude and Codex
become available only after their CLI reports authentication on that runtime host.

The desktop connects over authenticated HTTP on WSL’s localhost forwarding. It checks owner access
and protocol compatibility before using the connection. After Linux reports ready, Dovo waits up to
ten seconds for Windows localhost forwarding to accept connections; authentication and protocol
failures are not retried. Native and WSL saves return a connection only after checking the listener
with the desktop owner token and matching protocol. Setup waits for a verified selected connection
before opening the workspace. Errors identify preparation, connection or recovery failure, remain
visible for retry, and omit Electron/FiberFailure transport prefixes. Dovo reports that the previous
environment was restored only after verifying its connection too. Quitting closes the desktop-owned
WSL runtime gracefully. Changing distributions does not shut down the distribution or unrelated
Linux processes. Phone access remains opt-in through LAN/VPN settings, with pairing codes and device
tokens required. WSL NAT networking may need forwarding; mirrored networking and Windows/Hyper-V
firewall configuration may be needed for LAN, Tailscale or NetBird connectivity. Dovo never silently
changes those OS settings. If a distribution is removed or startup fails, the setup chooser offers a
return to Native Windows.

Use **Check Windows security** in the Windows environment chooser or Settings → Runtime after
reproducing a Defender notification. It reads the most recent 20 ASR block events (1121) from the
last two hours on the Windows host, even in WSL mode. It shows the rule ID, timestamp, process and
target paths; events can belong to other apps. **Copy report** copies those fields locally, without
event user fields or command lines. Paths can include local account names. An unreadable log is
reported separately from a successful empty query.

A notification mentioning `svchost.exe` does not identify the rule or prove Dovo stopped working.
The LSASS-protection rule can block memory access while the process continues running. Administrator
access does not override ASR policy. See Microsoft's
[ASR reference](https://learn.microsoft.com/en-us/defender-endpoint/attack-surface-reduction-rules-reference).
Dovo hides background command windows; it does not change Defender rules, request general elevation
or alter Windows terminal delegation. Code signing is handled separately.

The chooser, security check and supervisor have automated tests. Full provisioning, Windows/WSL
networking and actual agent runs still require verification on a Windows machine.

### Worktree location, readiness and recovery

Set **Settings → Computers → Worktrees → Worktree folder location** on the computer that runs
agents. It accepts an absolute host path or `~/…`. That setting takes precedence over
`DOVO_DATA_ROOT/worktrees`; an empty setting uses the environment default, or `~/.dovo/worktrees`.
Desktop and background launchers preserve `DOVO_DATA_ROOT`. New checkouts use the selected folder.
Existing registered checkouts remain at their original location and retain their task ownership.
Cleanup keeps branches, and saved linked-history previews read the repository's Git objects even
when the original worktree is gone. Undo/Redo reattaches the saved branch when necessary.

**Devices & runtime → Manage computer** shows authenticated readiness and backup controls.
`dovo-server doctor --json` includes the same roots, scheduler progress, storage availability,
queued/paused input, waiting approvals/questions, running durations and uncertain provider actions.
A scheduler without a successful tick for 20 seconds needs attention; this does not cancel an agent
or replay a provider action. The public `/health` endpoint remains a simple connectivity check. HTTP
LAN/VPN addresses, pairing codes and device tokens continue to work.

The runtime creates a verified SQLite backup on its first upkeep pass and at least daily while it
runs. Backups live beside the database in `backups/`, with five copies and a 512 MB retention
budget. The newest pre-update rollback snapshot is always retained, even if it alone exceeds that
budget. Routine backups larger than 512 MB fail explicitly; use operator-managed SQLite backups for
larger databases. Failed writes retain earlier snapshots, and an interrupted partial snapshot is
removed under the backup lock before the next write. The panel shows the most recent successful
snapshot and persisted failure. SQLite's backup API includes committed WAL contents and attachment
BLOBs; repository/worktree files, host `settings.json` and owner-token files need their own backup.

```sh
dovo-server backup --data-dir ~/.dovo
dovo-server backups --data-dir ~/.dovo --json
# Stop the OS service as well, if installed, so it cannot restart the runtime.
dovo-server stop --data-dir ~/.dovo
dovo-server restore --data-dir ~/.dovo --backup /absolute/path/to/runtime-backup-….sqlite
dovo-server start --data-dir ~/.dovo
```

Restore verifies SQLite integrity, obtains the runtime's process lock, preserves the current
database as another backup and replaces it atomically. It refuses a live runtime. Device pairings
and conversation data return to the selected snapshot; host owner-token/configuration files remain
in place. Inspect the pre-restore copy if newer work must be recovered. A structurally readable
SQLite backup can still contain damaged conversation records; restoring it does not silently repair
or discard those records.

If a conversation cannot hydrate, export the data without starting the runtime:

```sh
dovo-server recovery-export --data-dir ~/.dovo --output /absolute/path/to/new-recovery-folder
```

The destination must be new. It contains a consistent SQLite copy, raw document/history/job JSONL
and an integrity/history inspection report. Malformed values are preserved verbatim; no agent
resumes and no workspace records are rewritten. These private files include sensitive runtime data.
Retain the original database and inspect the report before choosing a backup to restore.

Runtime logs (`server.log`, `runtime-service.log`, `service.log`, `server-update.log`) are checked
once a minute. Files above 10 MB rotate into three retained 10 MB tails. Copy/truncate keeps the
runtime and supervisor's append descriptors valid. A burst may exceed the budget until the next
check, and writes racing truncation can be lost. Use the OS journal or an external log collector if
complete log retention is required. Server startup and source-update commands also check rotation
before opening a log. Source-build `update.log` files rotate in their release directory. The OS
journal remains managed by the OS.

Archive and Homebrew update activation now covers stopping, SQLite backup, launcher selection,
startup and authenticated version verification in one recovery operation. A failed candidate
restores the old release and database only after the candidate is confirmed stopped. If stopping or
recovery fails, the error names the retained backup; Dovo does not overwrite a database beneath a
live process.

Homebrew activation keeps the previous Cellar installation by disabling automatic install cleanup
during the upgrade. Recovery pins the service to that previous launcher; keep it until the updated
runtime is confirmed healthy. After a failed upgrade, select a verified replacement explicitly with
`dovo-server service update --launcher /path/to/bin/dovo-server`.
