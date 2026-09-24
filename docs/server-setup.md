# Run Dovo on your own computer or server

A Dovo runtime owns projects, tasks, Git operations, agent sessions, terminals, scheduled jobs, and
SQLite persistence. Desktop, web, and mobile are clients of that runtime. A phone connects directly
to the host over LAN, Tailscale, NetBird, or an HTTPS reverse proxy; Dovo provides no cloud relay.

Use the background server when work should stay available after closing the desktop app or shell. It
survives those applications closing, but this command does **not** install a boot service, prevent
computer sleep, or automatically restart a crashed process.

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

Development desktop data on macOS is normally:

```text
~/Library/Application Support/@dovo/desktop
```

Packaged desktop commonly uses `~/Library/Application Support/Dovo Studio`. If that profile has no
runtime data or saved connections, desktop reuses an existing `@dovo/desktop` workspace
automatically. An already configured packaged profile or an explicit `--user-data-dir` launch
argument takes precedence. No credentials or databases are copied. On Linux, check
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
3. Enter the full runtime address, a device name, and the eight-digit code.
4. Keep both devices reachable while pairing completes. The CLI's default code automatically
   approves devices using it until it expires, so no second approval step is required.

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

| Adapter  | What Dovo uses                                                       | Update the component actually in use                                                                                                                |
| -------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex    | Host `codex` executable/App Server                                   | Use its original installer: npm, Homebrew, mise, or another managed installation. For an npm installation: `npm install -g @openai/codex@latest`.   |
| Claude   | Bundled Agent SDK plus user-installed Claude CLI on the runtime host | Update Dovo for its locked SDK. Use `claude update` for a native CLI installation, or the original package manager for a managed/custom executable. |
| OpenCode | Running OpenCode server and Dovo's bundled client SDK                | Upgrade OpenCode on the server host using its installer or `opencode upgrade`, then restart `opencode serve`. Update Dovo for its client SDK.       |
| ACP      | The custom agent's configured executable and bundled ACP SDK         | Update that agent through its own installer. There is no universal executable or version for every ACP agent.                                       |
| MCP      | Bundled MCP SDK and separately configured project/agent servers      | Update Dovo for its SDK; update individual MCP servers using their configured package or deployment.                                                |

`--check-updates` queries official npm metadata and reports current, update available, ahead, or
unknown. Registry/network failures remain unknown; they are not treated as proof that a component is
current. A newer upstream version is information, not a compatibility guarantee. Locked SDK updates
should pass the repository's adapter tests before deployment.

Configure executable paths in **Settings → Devices & runtime → CLI commands & shell**. Provider
authentication stays on the host. Authenticate `gh` on that host for PRs; authenticate the chosen
agent separately. OpenCode requires its server to be running; installing its CLI alone is not
enough.

## Caching and offline behavior

The runtime keeps PR pages and details in SQLite, with up to 500 cached entries. Results older than
60 seconds can be shown while a refresh runs in the background. Refresh explicitly when you need the
latest GitHub state; a cached approval or check result is not a live merge-readiness guarantee.

Desktop/web and mobile also retain a workspace snapshot and up to 100 successful read responses per
saved runtime. Browser storage uses IndexedDB; native mobile uses app-private files so large
histories do not exceed Android AsyncStorage limits. Entries are scoped to the runtime origin and a
credential hash, so data from two hosts or different credentials cannot replace one another. The
credential itself stays in the connection's credential storage, not the cache key.

Cached tasks, messages, and PR details can make reopening screens faster and preserve context during
a network outage. They remain stale until the host is reachable again. Cached reads do not queue or
authorize offline mutations: sending messages, running agents, applying edits, and terminal input
require the correct live runtime. **Forget computer** removes that host's local cached data
alongside its saved connection. This does not delete the workspace on the server.

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

Open **Settings → Devices & runtime → your computer → Task defaults** to configure that runtime.
Open a project's settings and choose **Task defaults** for project overrides. The same controls are
available on mobile under the device and project settings.

- Choose the harness, model/reasoning/service tier, access mode, instructions and optional
  executable or server URL.
- Choose local checkout or a new worktree. Worktree base branches accept short names such as
  `origin/main` or full Git refs. Automatic selection prefers `origin/main`, then `origin/master`,
  then the current local branch. Remote branches must already exist locally; this does not fetch or
  switch the project checkout.
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
