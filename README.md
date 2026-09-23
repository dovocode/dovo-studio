# Dovo Studio

A personal agent workspace built around SCM, reusable agents, tasks and automation jobs. Desktop
(Electron) and web (TanStack Start) share a compact, dark-first workbench. A local Node runtime owns
execution and SQLite persistence. The Expo app connects to that runtime with a compact native
interface.

## Run

Requires Node 24.11+ and the repository's pinned pnpm version.

Install dependencies once with `pnpm install`, then choose a workflow:

- **Desktop:** `pnpm dev:desktop`. This starts the desktop and its runtime; do not also start
  `dev:api` for the same workspace.
- **Web:** run `pnpm dev:api` in one terminal and `pnpm dev:web` in another. Open the web address
  and pair it with the runtime using `pnpm pair` in a third terminal.
- **iPhone development:** keep the desktop or background runtime running on your Mac, then run
  `pnpm dev:mobile`. Open the development build on your phone and connect it from Computers. Both
  devices need the same Wi-Fi or VPN. Expo Go is not sufficient for the app’s native modules.

A successful setup shows your computer as **Online**. Add a project and configure an agent before
sending your first task. The standalone API and desktop may use different data directories; use the
existing desktop directory when attaching a background server to its workspace.

Web defaults to port 4173; desktop uses 5173. If another project uses 4173:

```sh
pnpm --filter @dovo/web exec vp dev --port 4185 --host 127.0.0.1
```

For a runtime that stays available after desktop closes, follow the
[server setup and operations guide](docs/server-setup.md). It covers existing-workspace migration,
background lifecycle commands, LAN/Tailscale/NetBird pairing, isolated updates, adapter checks,
backups, and troubleshooting. New server quick start after installing dependencies:

```sh
pnpm --filter @dovo/api... -r build
pnpm server setup
pnpm server start
pnpm server pair
```

Use `--data-dir` with your existing desktop directory to retain its tasks and pairings; see the
guide before creating a separate workspace.

## Working flows

- Desktop attaches to an existing authenticated runtime in its data directory, or starts its
  runtime. On macOS the managed background runtime stays available after the window closes. The
  background server continues when desktop closes; web/mobile pair with a running host.
- Codex App Server, OpenCode Serve, Claude Agent SDK and ACP adapters load through the extension
  host. Task sessions resume, stream responses, request approvals and support cancellation.
- Reusable agent configurations own provider, model, instructions and permissions. Changing the
  configuration starts a fresh session. Agents expose live model discovery and provider-supported
  reasoning choices (OpenCode variants and ACP thought-level configuration). Custom model IDs remain
  available when discovery is offline. One agent task may run in a repository at a time.
- Real PTY terminals use xterm.js, resize with the pane, and keep running when hidden or detached.
  Reopening replays buffered output. Closing a terminal ends the shell.
- Git changes include untracked/deleted files. Pierre edits are saved as drafts; **Apply saved draft
  to disk** compares the disk baseline before writing. SCM supports staging, commits and reading
  GitHub pull requests through the host's `gh` login.
- The automation canvas executes validated DAGs, schedules cron triggers with time zones, accepts
  authenticated/idempotent webhooks, and persists human review gates across restarts. Webhook JSON
  becomes task context. Runs retain per-step progress, timing and task links; retry resumes
  unfinished work in the same run. Enable triggers explicitly; manual runs work without enabling
  schedules.
- Pairing uses expiring codes, optional automatic host approval, hashed device credentials and
  revocation. Terminal sockets use short-lived single-use tickets, never permanent tokens in URLs.
- Connected clients share the host workspace. Per-field compare-and-set patches reject conflicts;
  stale polls cannot replace newer edits. A synchronization conflict retains local edits and offers
  an explicit reload, with a local backup.

### Desktop walkthrough

1. Run `pnpm dev:desktop`. The footer should show **Connected to personal runtime**.
2. In Tasks, open **Projects → Add project** to open a **Local path** or clone from **GitHub**.
   Enter `owner/repo` or an HTTPS GitHub repository URL and an existing clone parent folder; the
   runtime creates a new subfolder named after the repository. Desktop also offers **Browse this
   computer…** using a native folder picker. Web/mobile paths refer to the connected runtime host,
   not the browser or phone. Browse only works with the desktop's local runtime; enter remote paths
   manually. Local repositories are verified and their branch detected. Offline local paths remain
   unverified drafts. Cloning requires a connected runtime and its configured Git executable;
   private repositories use the host's existing Git credentials (for example, configure them with
   `gh auth setup-git`). Existing destination folders are never overwritten. Failed clones report
   their recovery path and may leave downloaded files there. **Browse runtime folders…** opens the
   built-in folder picker on desktop, web and mobile, with Home/Up navigation, path entry,
   filtering, hidden folders and pagination. It lists directories only, using the paired runtime's
   filesystem permissions. **Choose from GitHub…** lists personal and organization repositories
   accessible to the host's configured `gh` account on github.com. The filter applies to loaded
   repositories; use **Load more** to continue through the account. Missing CLI/authentication and
   permissions errors are shown without changing the form. Selecting a folder or repository only
   fills the form; **Clone and add repository** starts the download. Private clones can also use the
   host's `gh` credentials without changing global Git settings.
3. In Agents, select a provider, configure its executable/endpoint and check availability.
4. Create a task with that repository and agent. Sending starts execution or queues a follow-up
   behind the active turn. Pause, reorder or remove queued messages above the composer. Stop pauses
   remaining messages; Resume queue continues them. During a run, Stop replaces Send and Queue adds
   a follow-up. Steer interrupts the current turn, records its checkpoint, and resumes the session
   with the new instruction ahead of queued messages, preserving a paused queue. This works through
   interruption/resume, not provider-native live turn injection. Approvals appear in the
   conversation.
5. Choose Chat, Changes or Terminal in the task header. Use Split with chat to keep the conversation
   visible alongside a diff or shell. In Changes, choose a file to review, save edits and explicitly
   apply them to disk. Stage and commit through **Projects → Project settings**.
6. In Automations, connect trigger → task → review, configure the task, and run the automation. The
   run waits at review until approved. Scheduled/webhook execution requires **Enable triggers**.
7. In Settings → Devices & runtime, generate a pairing code. Enter the host address and code in
   another web client, then approve the named device on the host. Revoke it from the device list
   when needed.

### Private network access

Bind the desktop runtime to the host's NetBird IP:

```sh
# Listen on all IPv4 interfaces (LAN and installed VPN adapters):
DOVO_HOST=0.0.0.0 pnpm dev:desktop
# Or bind only one address/network:
DOVO_HOST=192.168.1.10 pnpm dev:desktop
DOVO_HOST=netbird pnpm dev:desktop
DOVO_HOST=tailscale pnpm dev:desktop
DOVO_HOST=local pnpm dev:desktop
```

The runtime chooses a free port and shows its address in Devices & runtime. Connect the browser
using that complete address. Both devices need network reachability through your NetBird setup. The
runtime defaults to loopback when `DOVO_HOST` is absent; there is no cloud relay.

From this checkout, pair a phone or browser using the CLI:

```sh
pnpm pair --network netbird
# Alternatively: --network local, --network tailscale, or an explicit hostname:
pnpm pair --public-address http://your-host.internal.dovo.network:8787
pnpm pair devices
pnpm pair approve <request-id>
# Or reject a request:
pnpm pair deny <request-id>
```

Use the actual runtime port. The code expires after two minutes and automatically approves one
device. Every code is single use. Use `pnpm pair --manual` for a single-use code that requires
approving its request. Generate a separate code for each device. `devices` shows pending requests
and paired devices, not live network presence. `--json` supports scripting;
`--connection /path/to/runtime-connection.json` selects a specific runtime. `--public-address` only
changes the displayed address; the runtime must already listen on a reachable interface. An explicit
`--public-address` takes precedence over `--network` discovery, including an HTTPS reverse proxy.
Discovery deduplicates interface aliases and reports malformed optional VPN status without blocking
pairing over the other available addresses.

`pnpm pair` lists detected reachable-interface addresses; `--network` selects LAN, Tailscale or
NetBird. These are advertised interface addresses, not a guarantee that a remote device's firewall
or VPN rules allow access. VPN discovery uses the installed `tailscale`/`netbird` CLI and checks its
IP against local interfaces. An explicit IP works without either CLI. `DOVO_HOST=local` requires a
single unambiguous local interface; otherwise choose an IP or `0.0.0.0`. `0.0.0.0` is a bind
address, never the address entered on a phone.

The API and desktop runtime publish owner-only `runtime-connection.json` alongside their database
for local CLI discovery and remove it on shutdown. Restart an older runtime once to enable this. The
CLI prints short-lived pairing codes, not permanent owner credentials.

The standalone API uses port 8787 and `~/.dovo/runtime.sqlite` by default. `DOVO_DATABASE_PATH`,
`DOVO_HOST`, `PORT` and `DOVO_OWNER_TOKEN` override these. Without an explicit token, the API
creates `owner-token` alongside its database with owner-only file permissions. Desktop reuses this
owner identity across launches, supplies it through IPC, and keeps its database in Electron's user
data directory. Provider authentication stays on the host. Packaged desktop builds include Node 24
and the complete runtime dependency closure. Development builds can use `DOVO_NODE_PATH` when Node
is absent from PATH.

For browser access, serve the web frontend over your private network too. An HTTPS frontend needs an
HTTPS/WSS runtime endpoint, supplied by your local reverse proxy; browsers block mixed content.

### Provider setup and execution limits

| Integration | Host requirement                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------- |
| Codex       | `codex` on PATH, or executable path in Agent settings; authenticated Codex login                    |
| OpenCode    | `opencode serve` running; endpoint defaults to `http://127.0.0.1:4096`; models use `provider/model` |
| Claude      | Installed Agent SDK; Claude login or `ANTHROPIC_API_KEY`; optional custom CLI path                  |
| ACP         | Executable plus arguments, e.g. `opencode` and `acp`; authentication belongs to that agent          |

OpenCode server authentication uses `OPENCODE_SERVER_PASSWORD` and optional
`OPENCODE_SERVER_USERNAME` on the runtime host. ACP read-only execution requires an advertised
read-only/plan mode; unsupported capabilities fail explicitly. ACP agents must provide their own
filesystem/terminal tools; Dovo does not advertise client-side ACP filesystem or terminal services.

Jobs require a running runtime. Missed schedule ticks are coalesced while running; downtime is not
replayed after restart. Interrupted running jobs become failed and can be retried from unfinished
steps; completed tasks are not repeated. Waiting review gates remain resumable. Terminal processes
do not survive a runtime restart. Git review currently limits text files to 2 MB and change lists to
200 files; binary/submodule review is not implemented.

New workspaces start without example conversations; previously saved tasks marked as examples are
removed on load. Real tasks are preserved. Unconnected clients keep drafts in `dovo.workspace.v1`
localStorage. Corrupt saved data is preserved and reported. Connected credentials are persisted in
client storage; paired devices are trusted to operate this personal workspace.

### Mobile walkthrough

The native app uses Expo UI buttons and pickers, SecureStore device credentials, and the shared
extension lifecycle. It requires a native development/release build: Expo Go does not include
`react-native-diffs`, Nitro or the terminal WebView dependencies.

```sh
pnpm dev:mobile
# In another terminal, build and install the native app:
pnpm --filter @dovo/mobile ios
# Or, with Android SDK/JDK and an emulator/device available:
pnpm --filter @dovo/mobile android
```

1. Start a reachable runtime using `pnpm server start` or desktop. Generate a code with
   `pnpm server pair` for that data directory, or in **Devices & runtime**.
2. On mobile, enter the complete LAN/VPN runtime address, a device name and the eight-digit code.
   CLI codes are single use and expire after two minutes; only manual codes need host approval.
   Credentials are stored in Keychain/Keystore; provider credentials stay on the host.
3. Open **Tasks** and choose **New task** for an empty draft chat. Select the project,
   harness/model, access mode and local checkout/worktree before sending the first message. Its
   title is generated using Settings → Agents → Task title generation. Stop replaces Send during a
   turn; Queue and Steer appear in the composer toolbar when it has input. Drafts survive restarts.
   Thread and PR details hide the app-wide navigation. The thread title returns to chat; header
   icons open changes, terminal and settings. Project and checkout choices live in a sheet before
   the first message. Messages follow new output only while you are near the bottom.
4. Switch to **Changes** for a file list and native iOS diff. **Edit file → Apply to disk** compares
   the original disk contents before writing. Android uses a unified text diff because the upstream
   native Android diff view is currently a placeholder.
5. Open **Terminal** to start or reconnect to a real host shell. Returning to Chat fully hides it;
   its process remains alive and the selected session is retained. **Close shell** terminates it.
   **Keyboard** opens the phone keyboard; the touch toolbar provides Esc, Tab, Ctrl+C, arrow keys
   and keyboard dismissal. The viewport resizes with the keyboard. xterm assets are bundled locally.
6. **Tasks → Projects** registers repositories and opens Git tools. **Settings** contains custom
   agents, title generation, devices/runtime, and per-project or custom-agent MCP servers and
   skills. Browse and import from skills.sh and the MCP Registry directly on the phone.
   **Automations** creates and edits simple ordered automations, shows step progress, retries failed
   runs and handles review gates. Branching graphs keep their desktop/web canvas editor. See
   [Automations](docs/automations.md).
7. **Settings → Devices & runtime** manages saved computers. **Disconnect** deselects the active
   runtime; **Forget computer** removes its saved connection. Revoke device access on the host.

Mobile pauses polling in the background and refreshes on return. The runtime must stay running and
both devices must be reachable within the private network. The native app allows HTTP for
user-selected private runtimes, including LAN, Tailscale and NetBird hostnames. Use a VPN or HTTPS
for encrypted remote transport. An HTTPS browser frontend requires HTTPS/WSS for its runtime.

Native folders and terminal HTML are generated. The checked-in Expo scene plugin reproduces iOS
scene lifecycle support for Xcode 27. Explicit app keychain entitlements also keep simulator
credentials isolated and available in ad-hoc native builds. The pnpm diff patch fixes main-actor
rendering and pins the upstream Swift MarkdownView revision; do not edit generated Pods or
node_modules directly.

### Desktop packaging

```sh
# On an Apple Silicon Mac, using Node 24:
pnpm package:desktop
node scripts/packaging/verify-packaged.mjs
```

Produces `release/Dovo-Studio-0.0.1-arm64.dmg`, the matching ZIP, and
`release/mac-arm64/Dovo Studio.app`. The app bundles its own Node runtime and production modules,
including PTY binaries. Packaging stages a temporary workspace, preserves the development install,
and checks runtime startup and a real shell before creating artifacts. The verification script
launches the actual packaged app with system Node removed from PATH and checks its owner connection
and all four providers.

These local artifacts are unsigned. Developer ID signing/notarization and second-device NetBird
verification remain release checks. Provider executables and their logins still belong on the host;
configure absolute executable paths if Finder's PATH does not include them. For a packaged private
network launch, quit the app first, then run:

```sh
DOVO_HOST=100.x.x.x '/Applications/Dovo Studio.app/Contents/MacOS/Dovo Studio'
```

The runtime address, including its selected port, appears in **Devices & runtime**. Closing the app
stops only a runtime it launched itself. An attached background server remains available; see the
[server guide](docs/server-setup.md) for lifecycle and boot-service limitations.

## Extension boundaries

```text
packages/
  client-runtime/     Manifest, lifecycle, commands, events, isolated extension state
  protocol/           Shared validated workspace and transport schemas
  runtime/            SQLite, auth, providers, Git, PTY and durable jobs
  studio-core/        Frontend contribution contracts, state and conflict-aware synchronization
  studio-ui/          Shared shadcn primitives, AI Elements and dark theme
  studio-shell/       Contribution catalog, activity bar, command palette, walkthrough
  extension-tasks/    Conversations, task drafts, terminal pane and Pierre review
  extension-scm/      Repository registration and changes navigation
  extension-agents/   Reusable provider configurations
  extension-jobs/     Canvas, node inspector and graph validation
  extension-runtime/ Pairing, runtime connection and device trust
```

The initial loading boundary follows VS Code's manifest/contribution model: local feature packages
contribute views and commands before activation. Opening a view activates its extension and lazily
imports its frontend. Desktop and web supply the same bundled extension list; the shell discovers
views from contributions. Mobile supplies native view contributions through the same extension host.
There is no remote module federation or marketplace installer.

To add a feature, create an extension package exporting `defineStudioExtension(manifest, views)`.
Keep its manifest entry light and its view behind `load: () => import('./view')`. Register the
extension in each app's composition root and add its source directory to the shared Tailwind CSS
sources. Views use `useStudioHost()` for navigation and commands; command registration returns a
cleanup function. Runtime extensions attach disposables to their activation context. Extension state
is isolated, concurrent activation is shared, and disposal waits for pending activation.

Built-in frontends are trusted code running in the renderer. This boundary is modularity, not a
security sandbox or compatibility with existing VS Code extensions. An untrusted extension host and
a narrower capability API must precede third-party executable extensions. Shared React and UI
primitives avoid separate framework runtimes per view. Components own one interaction or visual
responsibility; domain transformations and graph validation stay outside rendering code.

## Verification

```sh
pnpm verify # typecheck, build test prerequisites, tests, lint, and all builds
pnpm check
pnpm fallow
# After pnpm build, verify pairing in an isolated desktop profile:
env -u ELECTRON_RUN_AS_NODE pnpm --filter @dovo/desktop exec electron ../../scripts/verify-pairing-ux.cjs
# Verify the actual desktop runtime and terminal UI:
env -u ELECTRON_RUN_AS_NODE pnpm --filter @dovo/desktop exec electron ../../scripts/verify-desktop.cjs
# With Maestro installed and the native app on an iOS simulator:
node scripts/verify-mobile.mjs <simulator-uuid>
node scripts/verify-mobile-resources.mjs <simulator-uuid>
node scripts/verify-mobile-pulls.mjs <simulator-uuid>
node scripts/verify-mobile-devices.mjs <simulator-uuid>
node scripts/verify-pair-cli.mjs
# Optional: exercise pairing via a reachable private DNS hostname.
DOVO_TEST_RUNTIME_HOST=<private-hostname> node scripts/verify-mobile-pulls.mjs <simulator-uuid>
```

Vite+ owns builds, formatting, linting and Vitest. Tests cover extension lifecycle, schema
validation, workspace synchronization races, pairing/revocation, real Git and PTY behavior, socket
replay, task resume/cancellation and durable automation reviews. Live smoke checks on this host
completed Codex, OpenCode and ACP tasks. Claude reached its CLI but needs a host login before a live
task can pass. The Electron smoke check verifies actual runtime startup and the owner workspace
connection. The mobile Maestro flow uses an isolated runtime and temporary Git repository; it pairs
a named test device and exercises native navigation without running paid agent tasks. Android export
and native configuration are checked; Android device execution requires an installed Android SDK
platform/emulator and remains unverified on this host.

The multi-device flow verifies host-specific drafts and task routing, plus retained search, filters,
sort and list position after returning from a remote task. For a focused PR list regression, run
`node scripts/verify-mobile-pulls.mjs <simulator-uuid> --navigation-only`; it opens the last of 22
PRs and checks that returning twice preserves the list position.

Adapted third-party component licenses are included in `packages/studio-ui/licenses`.

The pnpm peer checker reports Vite ranges against the existing Vite+ alias version `0.3.0`; builds
and Vite+ checks validate the actual toolchain. No peer checks are disabled.

Tasks and automation task nodes can use the registered project checkout or a dedicated worktree. The
runtime creates worktrees from the selected checkout’s committed HEAD on first use, under
`~/.dovo/worktrees/<repository>/<task>`, on a `dovo/task-…` branch. Existing uncommitted changes
stay in the project checkout. Worktrees and branches are retained for later turns; Dovo never
automatically removes or resets them. Choose the same task worktree in **Projects → Project
settings** for staging, commits, and GitHub pull requests. Agents, terminals, diffs, and `gh` use
that checkout as their working directory. Existing tasks default to the project checkout.

Configure host CLI defaults in **Settings → Devices & runtime → CLI commands & shell**: terminal
executable/arguments, Git, GitHub CLI, Codex, Claude, and ACP. Executable fields accept a name on
PATH or a literal path (including spaces); they are not shell command strings. Agent executable
overrides take precedence; OpenCode keeps its Serve URL. Empty shell selects an available zsh/bash
from SHELL, otherwise zsh on macOS or bash. New terminals default to `-l` login startup and still
start in the selected project checkout. Settings persist in the runtime database and affect new
processes; existing terminals keep running.

The **Pull requests** view (PRs on mobile) aggregates registered repositories, with
repository/state/draft filters, search over loaded titles/repositories/branches/authors/labels, and
per-repository pagination. Attention-first sorting and a Needs attention filter surface open PRs
with failed checks or requested changes; recently updated sorting is also available. Details show
descriptions, requested reviewers, assignees, changed-file patches, checks, conversation comments,
reviews, and inline comments with diff context. GitHub uses the configured `gh` CLI; connected
providers use their APIs and paginate comment/review/file endpoints. Section errors and incomplete
responses are shown explicitly. Browsing is read-only; PR actions submit explicit writes. **Settings
→ Source control** connects GitHub, Bitbucket Cloud, Forgejo, Gitea and Azure DevOps Services. Link
an existing project or clone through a connected provider. Desktop and mobile support PR
creation/editing, comments, reviews, reviewer requests/removal, supported thread resolution, merge
and close/reopen actions. Provider/version capabilities control which actions appear. See
[Source control connections](docs/source-control.md) for setup and limits.

Tasks, PRs, Issues, Pipelines, Automations and Settings combine all saved computers by default. Rows
show their host; opening one selects that computer automatically. Project filters do not switch the
runtime. Agents, accounts and resources stay grouped by host; editing them does not switch the open
workspace. Device commands and activity open from each computer’s settings. Choose the destination
inside creation or connection setup. See
[unified collections](docs/design/source-navigation.md#unified-collections).

PR details have Overview, Files, Activity, and Checks sections on desktop and mobile, with review
and check summaries. Switching sections preserves viewed files and in-progress diff feedback for the
current head commit. Mobile keeps state tabs above the list and secondary filters in a sheet; its
native More menu opens secondary actions, including task creation in a sheet. Returning to the list
restores its scroll position. Web and desktop use `@pierre/diffs` for syntax-highlighted unified or
split patches, a collapsible file tree, viewed markers, and feedback grouped by file. Mobile uses
its native diff renderer. GitHub patch omissions are explicit; remote patches are read-only.

**Start task from PR** lets you select an agent and review/address-feedback objective, then create a
draft or create and run. The task includes the description, comments, source URL and pinned head and
base commits. Its dedicated worktree fetches the provider's PR head through configured Git using the
GitHub credential helper or the connection's API token, including fork PRs. A changed PR head is
rejected before checkout; refresh and create from the updated PR. Existing worktrees and local edits
are preserved. Starting a task does not post comments or push changes to the provider. Task checkout
diffs retain the existing edit mode.

The desktop PR list remains visible as a sidebar during review, with repository labels, selected-row
highlighting, PR state, check rollup and review decision. GitHub statuses use a GraphQL request per
loaded repository page through configured `gh`; other providers use their status APIs. Missing
permissions show an unavailable indicator without hiding PRs. Refresh PRs reloads statuses. Narrow
screens retain list/detail navigation.

Select a line or same-side range in a Pierre diff and click the gutter **+** to add feedback. PR
comments offer the PR's provider (posts an inline review comment at the pinned commit) or **Agent
task** (opens task creation with the selected location and feedback). Failed posts retain the draft;
stale PR heads require refreshing. Comments require an explicit post action. Agent-diff feedback is
saved atomically in task chat with its original code excerpt, ready for the next Run/Continue turn.
Comments matching the current excerpt appear inline; changed excerpts are labeled as earlier
snapshots. Pierre **Edit** still edits the file draft; line commenting uses its gutter and
annotation APIs. These controls are available in web and desktop; mobile offers **Comment on line**
for PR files and shows saved task feedback in chat.

Drag line numbers or Shift-click the last line to open a multiline comment. **Suggest code change**
prefills the selected new-side code; edit it or clear it to propose a deletion. The explanation and
replacement travel together as a GitHub suggestion block or agent feedback. Suggestions do not apply
files automatically. Ranges must stay on one side; PR suggestions require all selected lines to be
present in the patch, so omitted context is never invented.

PR pages and detail threads are cached in the runtime SQLite database (up to 500 entries). Cached
results return immediately; entries older than one minute refresh in the background. The runtime
checks the first open-PR page of every registered repository every minute, even without an open
client. Visible clients check the cache every ten seconds. Failed refreshes retain cached data with
an error and wait a minute before retrying; Refresh PRs/details requests a fresh read immediately.

**Devices & runtime → Activity & message history** provides searchable, paginated history. Task
messages survive task removal; streamed responses update their existing record. Task
status/activity, agent turns and approval decisions, automation progress, Git/gh command outcomes,
authenticated integration requests/results and terminal connections/input metadata are recorded.
Common credential fields and bearer tokens are redacted; raw terminal keystrokes are not retained.
Agent tool events are recorded at the detail exposed by each provider. The log stays in the host
SQLite database.

On iOS, make a Shortcut with **Ask for Input → URL Encode → Text → Open URLs**. Use
`dovo://task?text=<encoded input>` as the text URL. Optional encoded parameters are `title`,
`repositoryId`, and `agentId`. This opens a draft chat with the supplied text. Choose its model and
checkout, then send the first message to start the task and generate its title. It uses the phone's
existing pairing over the private network; no credential belongs in the URL. Cold-start and
foreground links use the same inbox. Unsubmitted requests persist on the phone, including while
offline/unpaired, and are logged on the runtime when connected. This URL flow opens the app; it is
not a headless Siri App Intent.

### Daily coding workflow

The conversation follows [AI Elements](https://elements.ai-sdk.dev/): Message, Conversation, Prompt
Input, Queue and Tool designs, adapted as small components in `@dovo/studio-ui` with the upstream
MIT license retained. The prompt footer opens task model settings, user messages align right,
message actions give copy feedback, and tool cards disclose provider events with status badges. Expo
keeps native controls with the same compact conversation hierarchy and a Done action inside the
composer. Main mobile navigation uses Expo Router native tabs for Tasks, Issues, PRs, Automations
and Settings, with system icons and the platform tab bar (Liquid Glass on supported iOS versions).
Detail views and the keyboard hide the tabs. Unpaired devices stay in Settings; task shortcut URLs
continue through the persisted shortcut inbox. Existing Expo UI controls remain native SwiftUI
controls.

- The task sidebar shows pinned tasks first and supports priority, recent activity, newest, project
  and title sorting. Search includes message text; filters include working, review, failed, snoozed
  and settled tasks. Settle retains the conversation, queue and checkout; reopen it from the Settled
  filter.
- Task settings lets you rename a task, select a reusable agent and override its model/reasoning.
  Model discovery uses the configured provider executable. Overrides never mutate the reusable
  agent; changes start a fresh provider session. Stop the active turn before changing settings.
- Follow-ups use an atomic, idempotent runtime endpoint. They run one at a time in queue order
  across all four integrations. Queue management operates on message IDs, so a streaming reply
  cannot overwrite a submission. The queue allows 50 pending messages. Drafts stay editable until
  submission; unsuccessful requests retain their text for retry.
- Stop and provider failures pause pending work. Restart preserves pending messages and pauses them
  for explicit resume. Removing a queued item retains its submission in the activity log. Queuing is
  between turns; it does not inject text into an already running provider turn.
- Each turn records its provider, model, reasoning, start/end times and result beside its response.
  Tool activity shows recent operations and expandable provider details. The full log remains in
  Devices & runtime. A diff-refresh failure reports a review error while preserving successful agent
  work and its response.
- Mobile provides queue/steer controls, tool history, pin/settle/snooze actions, task-specific model
  settings and read-only per-turn checkpoint diffs. Long-press a task for metadata and actions. The
  command palette supports arrow keys and Enter; the terminal remains fully collapsible.
- Agent questions appear as compact answer cards in the conversation, with a **Needs input** marker
  in the task list. Choose options, select multiple answers where supported, or write your own
  response. No answer is preselected. The card temporarily replaces the composer; existing drafts
  are retained. **Send answers** continues the provider request; **Decline** explicitly declines it.
  **Stop**, provider cancellation and runtime shutdown dismiss pending questions.
- Codex supports `item/tool/requestUserInput` and standard MCP form elicitation; Claude supports
  `AskUserQuestion` and MCP forms; OpenCode supports both question API versions; ACP advertises form
  elicitation. Availability depends on the connected provider. Codex opts into its experimental
  question API, following the installed protocol and
  [app-server documentation](https://developers.openai.com/codex/app-server). Flat JSON Schema forms
  support text, numbers, booleans and enumerated lists, with validation before accepting answers.
  URL/browser elicitation and extended `openai/form` schemas are not supported.
- Questions can be answered from any paired device. An already resolved request rejects later
  replies, so another device cannot overwrite an answer. The activity log retains the question,
  result and non-secret answers. Fields marked secret are masked in question history and omitted
  from HTTP request-body logs; a provider's own output may still echo submitted values. Pending
  questions belong to the live turn and are cancelled on restart, rather than replayed into a new
  provider session.

### Attachments and branches

Use the paperclip in the desktop/web composer to attach up to five files, 4 MB each. Dropping files
or pasting an image works too. iOS and Android use the native file picker. Uploads require a runtime
connection; attachment drafts live on the host and appear on paired devices. File-only messages are
supported. Queued messages retain their files; the runtime deduplicates repeated upload/message IDs.

Click a file chip to preview an image or text, download it on desktop/web, or share it on mobile.
PNG, JPEG, GIF and WebP images use native provider image inputs; ACP does this only when its agent
advertises image support. Other files are supplied through local file paths, with UTF-8 excerpts
included in the prompt (up to 32,000 characters per file). Binary documents require the agent's own
file-reading tools. Model vision support still depends on the selected provider/model.

File contents are stored in the host SQLite database. Provider-readable copies are placed in the
private `attachments` directory beside it, outside project checkouts. Workspace snapshots and upload
activity contain metadata, not base64 bodies. Removing a draft chip keeps its original upload
record; submitted attachments remain available with chat history. Back up the runtime database to
retain files.

Open **Branches** in task settings or **Projects → Project settings**. The selected working
directory chooses between the project checkout and a task worktree. Filter local and existing remote
refs, switch to an existing branch, or create a branch from the current checkout. Remote choices
create a local tracking branch; fetch new refs using the project's configured Git CLI in its
terminal.

Switching requires a clean checkout, no running agent there, and no unapplied saved diff drafts. The
runtime rejects stale branch selections and never forces checkout or stashes changes implicitly.
Affected tasks retain their conversation and attachments, pause any existing queue, clear stale
diffs, and start a fresh provider session. Other task worktrees remain untouched. A branch change
made in an external terminal also starts fresh provider context on the next task turn. Turn labels
retain the branch where a response was produced.

After building, `scripts/verify-daily-workflow.cjs` exercises real runtime/UI communication with a
local app-server fixture: send, queue, deduplicate, pause/resume, inspect tools, change task models,
and pin/archive/restore. `scripts/verify-questions.cjs` checks required answers, option/text input,
provider replies, decline, stale replies and cancellation in Electron. `scripts/verify-mobile.mjs`
also verifies native queue cancellation, agent questions and task settings. These checks use
isolated data and deterministic fixtures, without paid agent execution.
`scripts/verify-attachments-branches.cjs` also covers desktop upload/paste/drop, previews, provider
delivery and branch changes. The mobile walkthrough uses a fixture file in the test app’s Documents
folder to exercise its native picker and SCM branch controls.

The desktop/web folder picker uses a path header, directory list and keyboard footer. Arrow keys
highlight folders, editing the path refreshes directories automatically after a short pause, Enter
opens one, Backspace goes to the parent, and ⌘/Ctrl+Enter chooses the current folder. Escape returns
to the repository form. `scripts/verify-folder-picker.cjs` checks this flow against an isolated
runtime and temporary folders.

Desktop/web selectors use a shared searchable picker with arrow-key navigation, Enter to select,
Escape to close, selected markers, and disabled choices. Folder browsing supports live filtering and
retry; GitHub browsing retains pagination and searches the repositories already loaded.

See [Queue, steer and agent questions](docs/chat-interactions.md) for live guidance, follow-up
ordering, Astra forms and interruption/retry behavior.

Each new agent turn captures a Git tree before provider execution and another after completion,
failure, or cancellation. An alternate index preserves the real staging area and checkout; existing
local edits become the baseline. Trees are retained under `refs/dovo/checkpoints/<turn>/before` and
`after`. The turn stores its own read-only diff, accessible from **Review turn** below the response.
The main review pane still shows cumulative checkout changes against HEAD. Tool events are grouped
with their corresponding responses, and turn errors remain visible in history.

Snapshots include tracked and non-ignored untracked files. Ignored files are excluded; submodules
retain their commit reference, not their internal working-tree edits. Text previews allow 200 files,
2 MB per side and 8 MB total per turn; binary/symlink/submodule and overflow paths are listed
without text previews. Snapshot trees retain file contents independently of preview limits. Runtime
interruption preserves the starting snapshot and marks the unfinished checkpoint explicitly.
External file changes during a turn also appear in its diff. Checkpoints currently provide history
and review; restoring files or rolling back provider conversations is not implemented.

Incremental workspace subscriptions (clients currently poll snapshots) and coordinated
conversation/file restoration remain planned improvements.

Desktop/web thread rows show the task title, repository, checkout branch, agent/provider icon,
runtime host and agent icons, and working/input status or relative finish time in three compact
lines. Queue details remain in the status tooltip. Both approval requests and agent questions appear
as **Needs input**, with a matching sidebar filter. Search includes branch, agent and host names.
New turns record the runtime hostname for history; older data can lack that field.

Agent configuration and task overrides offer **Supervised**, **Auto-accept edits**, **Auto**, **Full
access**, and **Read only**. Existing saved `ask` and `workspace-write` values retain their behavior
under the first two labels. Tasks can inherit their agent's mode. Mode changes start fresh provider
context on the next turn and never change a reusable agent through a task override.

- Codex Auto sends `approvalsReviewer: auto_review` with workspace sandboxing and on-request
  approvals. The runtime checks that the harness enabled review before starting the turn. Full
  access requests `danger-full-access` with `never` approvals and checks the returned policy.
- Claude uses native `default`, `acceptEdits`, `auto`, and `bypassPermissions` modes. Auto delegates
  approval decisions to its classifier; it does not blindly accept approval callbacks. The harness
  can still require input for special actions, and account/model/administrator policy can restrict
  mode availability.
- OpenCode supports Supervised, Auto-accept edits, Read only, and Full access through its permission
  rules. This integration does not expose harness Auto review. ACP currently supports Supervised and
  advertised Read only modes; unsupported selections are disabled and rejected before running.

Auto-accept edits allows workspace changes while retaining approvals for actions outside the
provider's automatic edit scope. Auto is harness review, not an unattended/bypass alias. Full access
opts into the provider's broadest mode; host and organization policies still apply. See the
[Codex app-server documentation](https://learn.chatgpt.com/docs/app-server) and
[Claude SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions).

On desktop and web, **Settings** (the gear at the bottom of the navigation) contains **Agents** and
**Devices & runtime**. Agent configuration, pairing, device management, runtime commands, and
activity history remain available in these sections.

Task triage: pinned tasks come first, then requests needing input, failures, running tasks, and
recent activity. Settle moves a task to the collapsed Settled section (stored compatibly as
`archived`); Reopen returns it. Snooze for 1 hour, 4 hours, or 24 hours hides a task in Snoozed
until its deadline, with manual Unsnooze available. Snoozing does not stop a running agent. Hover or
focus a row for project, branch, host, model, queue, and terminal-session details.

New task opens an empty chat. The first message defines the task and generates its title. Settings →
Agents → Task title generation selects the harness, model and reasoning used for titles. This runs
separately from the task harness, in a temporary directory with read-only permissions and approval
requests denied. Generation failures preserve the composer draft for retry; first send requires a
runtime connection.

Tasks can select Codex, Claude, OpenCode or ACP directly without creating a saved agent. The
composer model/access controls open the task harness picker, including model, reasoning and access.
Connection and instructions allows per-task executable/server, ACP arguments and instructions. Saved
agents remain optional presets. Choose the project and local checkout or worktree in the composer
before the first send; checkout mode is fixed after sending. Task-specific harness configuration is
persisted and changes reset the provider session for the next turn. Model and reasoning choices come
from the selected harness catalog.

Codex settings also expose **Speed** and **Daybreak** using the connected harness's capabilities.
See [Codex speed and Daybreak](docs/codex-modes.md) for availability, permission behavior and the
App Server settings used for each turn.

Automation editing keeps canvas measurements, drag previews and selections local; final node
positions and graph edits synchronize to the runtime. Invalid connections are blocked before they
are added. Run and enable actions validate the graph and wait for pending saves. A running or
waiting automation cannot be started again, and switching flows clears its local controls and
webhook credential display. Scheduled automations are checked independently so one invalid schedule
cannot block other flows; switching trigger modes resets the next scheduled time. Accepted manual
starts are deduplicated by request ID, and run snapshots preserve their original steps as the
automation is edited. Failed or cancelled runs can resume unfinished steps with their existing task
chats and checkouts. See [Automations](docs/automations.md) for recovery behavior and mobile
editing.

`verify-automator.cjs` exercises native node dragging, edge selection/deletion, validation, task
execution and human review against an isolated fixture runtime.

### Project and custom-agent resources

Settings → MCP & skills manages resources for a selected project or custom agent. Tasks inherit
project resources; custom-agent entries with the same name take precedence, including disabled
entries. Changes start a fresh harness session on the next turn.

MCP servers support local stdio commands and Streamable HTTP, with connection testing. Environment
and header bindings reference environment variables on the runtime host; bearer authentication uses
an environment-variable reference too. Codex, Claude, OpenCode and compatible ACP harnesses receive
the enabled configuration. ACP HTTP servers require the harness to advertise HTTP MCP support.

Skills can be written in Settings or imported from a runtime-local SKILL.md containing YAML name and
description fields. Imported instructions are stored as a copy and supplied to the harness to apply
when relevant. Supporting files remain at the original source path. This does not modify native
harness configuration or install skills globally.

Use **Browse skills.sh** to search public GitHub skills and import their instructions and supporting
files. Imports pin a Git commit and store an isolated copy in the runtime's skills cache, without
running installation scripts. Source links and revisions remain visible in the editor. Bundles are
limited to 200 regular files / 8 MB; other sources can be imported from a local SKILL.md.

**Browse MCP Registry** searches the official Model Context Protocol registry's latest active
entries, with pagination. Choose a Streamable HTTP or supported stdio package variant (npm via npx,
PyPI via uvx, OCI via Docker), then review its arguments, static values and environment bindings.
Required placeholders must be replaced before saving or testing. Unsupported variants remain visible
with an explanation. Saving a catalog entry does not start the server. Duplicate names are rejected
rather than replacing an existing project or agent resource.

Mobile pairing checks approval immediately and resumes checking when the app returns to the
foreground. Approved credentials are stored before loading the workspace, so a connection failure
can be recovered with Reconnect without generating another code. The same pairing request secret can
recover its issued credential until the request expires (two minutes); it cannot create another
device or recover a revoked credential. Desktop preserves its runtime port and bind address across
restarts; `DOVO_PORT` and `DOVO_HOST` explicitly override the saved listener.

Saved runtimes appear together in the device dashboard, with host-scoped tasks and loaded PR counts.
Device filters narrow the overview; opening a task selects its owning runtime. Matching task or
repository IDs on different computers remain independent. Offline devices retain their last-seen
activity during the session, and incomplete PR counts are marked as partial. Adding a runtime never
imports another device's workspace. Desktop stores credentials with Electron's encrypted storage;
mobile uses the iOS Keychain / Android Keystore through SecureStore. Browser connections remain in
the current browser's local storage.

The mobile native build permits HTTP to user-selected runtime addresses, including LAN IPs,
Tailscale DNS names, and NetBird custom domains. Its ATS configuration uses `NSAllowsArbitraryLoads`
without the narrower keys that override it on current iOS (see
[Apple's ATS documentation](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowsarbitraryloads)).
HTTPS still uses normal certificate validation; pairing tokens remain required for either transport.
Use HTTPS or a trusted private network for remote connections. `0.0.0.0` and `::` are listener
addresses, not connection targets.

The mobile interface uses compact system buttons, large list titles, separator-based task and PR
rows, searchable selection sheets, and grouped secondary settings. Glass is reserved for navigation,
actions, and the composer. Tasks support pull-to-refresh; searching tasks and PRs uses deferred
input so typing is not blocked by filtering. PR reads bypass mutation-triggered workspace refreshes,
and the overview pauses polling while a PR is open. Visited screen modules render from cache without
an intermediate loading screen. Automation triggers use a native switch, with older runs collapsed
and direct navigation to their tasks.

Mobile chat messages, PR descriptions, and PR discussion use native GitHub-flavored Markdown
rendering, including selectable text, links, code blocks, lists, quotes, and tables. The renderer’s
optional math and syntax-highlighting assets are disabled to keep the native build small. Thread
headers and task details label the latest turn’s recorded execution host; drafts show the connected
runtime as their destination. Historical turns without a recorded host show an unknown device,
rather than attributing them to the currently connected runtime. Task rows reserve space for the
device beside the branch.

The mobile Markdown dependency has a pnpm patch for live iOS accessibility geometry: wrapped
paragraphs and links recompute their screen coordinates after scrolling, keyboard changes and native
tab transitions, preserving VoiceOver navigation without flattening Markdown into a single label.
The patch also keeps inline code proportional to its containing paragraph, heading, list or table
and respects Dynamic Type. Inline code uses the native monospace font with a neutral background;
fenced code keeps its separate syntax-highlighted block styling. Run
`node scripts/verify-mobile-markdown.mjs <simulator UUID> --inline-only` for native inline-code
rendering and wrapping checks at standard and enlarged text sizes.

Mobile task conversations use `@assistant-ui/react-native` with the core external-store runtime.
Dovo owns messages, turn status, checkpoints, pending questions, approvals and queue execution;
assistant-ui renders message parts and the native scrolling viewport. The Expo UI composer submits
through the adapter and keeps its existing persisted draft, idempotent send, queue/steer and Stop
controls. Tool records attach to their originating turn, and changed-file checkpoint summaries open
that turn's snapshot diff. Legacy tool records remain available below the transcript. Tool polling
uses read-only requests without reloading the workspace. The `assistant-cloud` package is needed to
resolve optional upstream exports in Metro; no cloud client or cloud persistence is configured. The
conversation follows its measured native content height through streaming Markdown and keyboard
changes. Scrolling up keeps your reading position; Latest message or a local send resumes following.

Run `node scripts/verify-mobile.mjs <simulator UUID> --conversation-only` to verify streaming,
expandable tool output and checkpoint navigation against the isolated local harness fixture.

Mobile tabs preserve visited lists, filters and scroll position. Tasks, Issues, PRs/Pipelines and
Automations use native stacks: Back and the iOS swipe gesture return to the retained list. Routes
include their computer identity, so a matching ID on another host cannot open the wrong item. Issue
and pipeline details can reopen from the device cache offline; changes require fresh data.
Automations keeps run controls and history on a dedicated detail screen, with pending run retries
retained across Back and reopening. See the
[source navigation notes](docs/design/source-navigation.md). Hidden source screens pause their
refreshes; background PR polling leaves the pull-to-refresh indicator idle. Changing computers
resets host-specific detail screens while retaining the aggregate task list's search, filters,
sorting and scroll position, as well as connection settings. Short choices use anchored native iOS
menus, with searchable sheets for longer lists. Inside an existing sheet, longer choices expand into
an inline searchable list to keep a single native presentation. Task filters and compact device
summaries scroll with the thread list, and Settings groups computers, agents and project tools into
separate pages. Pairing requires only an address and code; names and connection help are optional
details.

iOS icon actions use circular SwiftUI buttons with native press feedback. Thread controls stay in
one glass capsule in the top-right toolbar; the subtitle keeps the project and execution device
together. The composer uses a slim glass field with attachment, microphone and round Send/Stop
controls. Task-row menus provide pin, snooze and settle actions without opening a form. Modal forms
use system sheets with a native navigation toolbar, drag indicator and dismissal handling.
Navigation uses compact headers and inset content, with secondary actions in plain buttons or menus.
iOS tab scenes use the tab controller's measured safe area so the last list row stays above the tab
bar. This follows
[Expo's native safe-area handling](https://docs.expo.dev/router/advanced/native-tabs/#safe-area-handling)
for screens with a header before their scroll view. The small `@expo/ui` pnpm patch exposes
SwiftUI's `navigationBarTitleDisplayMode` so sheet titles stay inline while retaining the system
toolbar and Close button. Remove the patch when Expo UI provides that modifier. Text actions reserve
their own width, wrap at narrow widths and grow with Dynamic Type; their touch targets remain at
least 44 points. Conversation send/retry and attachment state survives switching between Chat,
Changes and Terminal; hidden chat views stop polling tool activity. Pending send identities also
survive Back/reopening within the running app, scoped to the computer and thread. Confirmed delivery
clears a false transport error; a delayed response never clears newer draft text. The
`--composer-only` verification flow checks draft retention, retries after a lost reply, attachment
cancellation, queueing and Stop. Run
`node scripts/verify-mobile.mjs <simulator UUID> --settings-only` to check a delayed, failed model
settings save: dismissal and edits stay disabled while saving, then the selected values and draft
remain available for retry. Run
`maestro --device <simulator UUID> test apps/mobile/maestro/sheets.yaml` for native swipe dismissal,
reopening and the system Close control.

Tap the composer's microphone to dictate in the device's preferred language, then tap it again to
finish. Recognized words appear in the locally saved draft. iOS chooses its available recognition
service; Android prefers a confirmed installed language model. Speech recognition may need a network
connection. Microphone/speech permission is requested on first use; denied access can be changed in
system Settings. Switching away from Chat or backgrounding the app ends capture and keeps recognized
text. Dictation never sends automatically and does not save an audio recording.

After dictation, the runtime performs light cleanup using the harness, model and reasoning level in
**Settings → Agents → Titles & dictation**. It adds punctuation and removes hesitation sounds while
preserving wording, language and developer identifiers. **Undo cleanup** restores the original;
**Keep original** skips a pending cleanup. Editing or sending the draft prevents a late cleanup
result from replacing it. If the computer/model is unavailable, the original stays editable and
cleanup can be retried. Both runtime and native app must be updated for this feature; Expo Go and
older native builds do not include the speech recognition module.

`node scripts/verify-mobile.mjs <simulator UUID> --dictation-only` checks denied microphone access,
draft retention across panes, editing after failure and the absence of automatic submissions. It
temporarily denies microphone permission in that simulator and resets it after the flow. Real
microphone accuracy and language-model availability still require a device test.

Unchanged snapshot responses preserve conversation identity instead of rebuilding it every second.
Last-seen labels update at most every 30 seconds during idle polling; real workspace changes,
questions, approvals and connection failures still publish immediately. Exact contact timestamps
remain available to offline status and persistent caches. Run the `--navigation-only` mobile flow
for native menus, long thread labels, touch targets, swipe-back, incoming task routes, cold draft
creation and tab-state retention.

### Browser and simulator previews

Open **Browser → Host browser** to control a browser running on the task’s computer from desktop,
web or mobile. Its canvas stream reaches host-only `localhost` servers without exposing their ports.
Use Direct preview for a local browser or **Simulators** for devices on that task’s runtime. iOS
uses Xcode Simulator; Android uses Emulator and ADB. See the
[browser and device guide](docs/design/browser-and-devices.md) for setup, remote addresses, current
boundaries and planned improvements.

## Updating and Live Activities

See [releases, local iPhone updates and Live Activities](docs/releases-and-updates.md).

## Inspiration

The developer experience is inspired by T3 Code, Codex, and Claude.

### Thread archive and subagents

Settle keeps a finished thread in the sidebar’s Settled group. **Archive thread** hides it from
normal lists; select **Archived** in the thread filter to restore it. **Delete thread** asks for
confirmation and removes its conversation, stored attachments, and thread activity. Project files
and worktrees remain on disk. Stop active turns, close terminals, and finish or cancel linked
automation runs before deleting a thread.

The task workspace **Agents** panel shows subagents reported by Codex and Claude, including their
last reported activity, elapsed time, and available model, reasoning, and usage details. Expand a
row for its prompt and latest update. This data is saved on the task’s host and appears on desktop,
web, and mobile. Earlier runs without captured subagent data are not reconstructed. Unsupported
harnesses and unreported metrics remain empty; offline or ended runs do not show stale agents as
currently working.

### Connection and credential editing

In desktop **Devices & runtime**, choose **Manage → Connect your phone** for a QR code and manual
address/code instructions. Scan with the iPhone Camera, review the address in Dovo, then pair and
approve on the Mac. For an address change, use **Update connection address** and a fresh code from
the same computer. Existing saved routes retain their computer ID.

MCP credentials use named, masked fields. **Replace** changes a value, **Keep saved value** cancels
a replacement, and **Remove** clears that credential when you save. Stored references are handled
automatically. Validation errors identify fields without printing submitted values.

`pnpm test` builds API/runtime prerequisites before running the tests, including lifecycle tests
that execute compiled JavaScript. `pnpm verify` runs the complete typecheck, test, lint and build
sequence. Direct `pnpm exec vp test <file>` is useful for source-only tests; run the API build first
when directly invoking lifecycle tests.

### Continuing tasks after a restart

In a computer’s settings, **Auto-continue tasks after runtime restart** is off by default. Enable it
separately for each runtime to resume interrupted agent turns and previously unpaused message
queues, one task at a time. A running turn resumes before its queued follow-ups. Explicit Stop,
queue pauses, settled tasks and automation-owned tasks are not resumed automatically. Automation
runs retain their separate Retry flow. This setting does not change Mac login startup, HTTP/VPN
connectivity, or device pairing recovery.

Leave the option off to review work first, then choose **Resume task** in an interrupted task.
Automatic continuation failures keep an actionable error and remain paused for manual recovery.
Agent work may have changed files or external systems before the interruption; continuation does not
roll back those effects or promise exactly-once tool execution.


### Phone connection setup and recovery

In desktop **Settings → Devices & runtime → Manage**, the listener status shows whether the runtime
accepts connections beyond this Mac. **Enable LAN / VPN access** restarts the desktop-managed runtime
on all IPv4 interfaces, keeps the same port, and generates a fresh pairing code. Finish or stop running
tasks first. **Limit access to this Mac** reverses this. If `DOVO_HOST` or an external supervisor manages
the listener, change that configuration and restart that service instead; reopening the desktop does
not restart an already-running background runtime. Pairing and device tokens remain required; HTTP is
supported, and HTTPS is optional.

On iPhone, scanning a code lets you choose **Add a new computer** or **Update** a saved computer.
Choose Update only for the same computer at a new address. The pairing sheet stays open until the
request completes or you cancel it. Cancelling an offline request can be retried when the connection
returns. On desktop, address replacement preserves unsent edits under the new connection; use
**Retry sync** to apply them, or review the conflict if the host changed the same fields.
