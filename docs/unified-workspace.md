# Terminals and unified workspace

Terminal panes name the computer running the session. Desktop panes show the checkout, and mobile
thread panes show the branch when known. A reported process exit is separate from an offline
computer that cannot accept input.

Desktop and web have a **Terminals** workspace for standalone sessions on paired Dovo computers.
Shells opened inside a thread stay in that thread. Its thread-style starter lets you choose a
computer, an installed shell and either **Home folder** or a project. Enter an optional startup
command, or leave it blank for an interactive shell. **No Project** always uses that computer's home
directory. Project terminals offer **Local checkout**, **Existing worktree** and **New worktree**,
including a base branch picker. Splits inherit the source terminal's shell and checkout. New
terminal worktrees are managed by Dovo and remain after the shell closes; live shells protect them
from removal, including when settled or snoozed. Sessions stay standalone, with the thread
workspace's sidebar and context header and the terminal as the main content. These shells use the
same Ghostty terminal and split controls as thread terminals. Each standalone workspace item shows
its own shell and the peers created inside it; independent sessions keep separate split layouts.
Select a standalone session in the sidebar. **New terminal** opens the workspace starter. Split
controls add panes inside the selected session. Sessions run on their owning computer. Hiding a pane
or changing workspaces keeps the shell running. Closing a terminal inside the terminal pane
terminates it and forgets its recovery record.

## Tools beside a thread

On desktop and web, open **Thread tools** at the top right of a thread to choose a tool. Use **+**
in the pane header to add another tool. Select a tab to switch tools, drag tabs to reorder them, or
close a tab when you finish with it. Drag the pane's left edge to change its width. Dovo remembers
the tabs and width for each thread in the current window.

On a new setup, the thread list starts narrow and the tools pane gets more room for code and
previews. Drag either divider to adjust the layout. Saved widths still apply.

Desktop pane frames use the canvas gap for separation. Resize handles and control focus outlines
remain visible. Pull requests, Issues, Jira and Bots use the same layout. Their lists sit on the
canvas, and page content sits in one pane below the page header.

The **+** next to the thread title opens a launcher for a new thread or a workspace tool. The
terminal's **+** creates a shell in the current terminal pane.

The terminal opens below the conversation by default. Its toolbar lets you move it to the right pane
and back. Moving the terminal keeps the shell running. These controls also work inside a thread
opened in Unified Workspace.

Unified Home, Browser and open terminals have a **Workspace tools** button at the top right. In
Terminal, use it to open Browser, a side thread, or device previews beside the shell. A terminal in
a project also offers read-only **Files** and, for Git checkouts, **Changes**. Both read the
terminal's original checkout, including a linked worktree. Devices use the terminal's computer. New
side threads start with the terminal's project selected. Files, worktree changes and device previews
require an updated runtime. Older runtimes can still show changes for the project's main checkout.

In Browser, **Thread for this tab** can create a thread in **No Project**. The new thread belongs to
the tab's computer. You can choose a different project on that computer before creating it.

Each pane has one header row. The selected tab has bright text. Other tabs have dimmed text. The
thread's Files tab shows the open file's name, with **Edit**, file tree, refresh and expand controls
in the same row. With a mouse, the terminal's split, move and location controls and the tab's rename
button appear when you point at the header or move keyboard focus into it. On touch screens they
always show. Point at a terminal tab to see its computer and checkout. Exit and offline notices
always show.

In the desktop app, choose **DevTools** from the right pane's **+** menu to inspect the current
local browser page in Chrome DevTools. The inspector opens below the page in the same pane.

When two devices view the same terminal, the first viewer controls its size. Opening or rotating a
phone keeps the desktop grid intact. Typing on the phone transfers control to its grid. When the
active viewer disconnects, a remaining viewer takes control.

## Terminal CLI

Use `dovo-server terminal` on the runtime computer. In a source checkout, use
`pnpm server terminal`. The CLI uses the running server's local connection file. Pass `--data-dir`
to select another local runtime. Names and IDs belong to that runtime.

The following example starts a shell in the current directory and leaves it running after you
detach. Press Ctrl+] to detach from the interactive view.

```sh
dovo-server terminal start --name review --cwd "$PWD"
dovo-server terminal list
dovo-server terminal send review 'git status --short' --enter
dovo-server terminal read review
dovo-server terminal attach review
dovo-server terminal close review
```

Use `read review` to see the current screen, including an active full-screen application. Use
`read review --lines 100` to include up to 100 lines of screen and scrollback. Use
`read review --tail` for the last 3,000 characters of output. If the runtime cannot restore the
screen, a plain `read` prints a notice and shows the output tail. With `--lines` it reports an
error.

For a Unix command whose exit code matters, replace the interactive shell with the program. A status
wait can also return when an agent reports that it needs input.

```sh
dovo-server terminal start --name build --cwd "$PWD" --command 'exec pnpm build'
dovo-server terminal wait build --timeout 120 --json
dovo-server terminal read build
dovo-server terminal close build
```

For an agent that reports permission prompts, use
`dovo-server terminal wait review --until blocked --timeout 60 --json`. This returns at once if the
agent is already blocked. Program exit also ends the wait. A timeout sets the CLI exit status
to 124.

Use `--wait` to send input and wait for a completed turn after delivery. Use `--after-turn` to wait
from a known turn number. Replace `5` with the `turn` from an earlier JSON result.

```sh
dovo-server terminal send review 'Review this patch' --enter --wait --timeout 60 --json
dovo-server terminal wait review --after-turn 5 --timeout 60 --json
```

The `turn` counts completed working periods reported by the terminal's root program. `afterTurn` in
the send result includes earlier reports that the PTY holder already processed when it accepted the
input. Other clients can still advance the count. If the connection drops before the holder confirms
delivery, Dovo reports that the input may have been sent. Check the terminal before sending it
again. Use `--until` to require a reported state as well as a newer turn. A plain shell that sends
no activity reports can still wait for process exit. Turn options require a runtime that supports
them. An older runtime rejects `send --wait` before sending input.

Run `dovo-server terminal events review` to watch one terminal. Omit the name to watch all
terminals. The command writes one JSON object per line. The first object lists the current
terminals. Later objects report changes, closures and connection status. Press Ctrl+C to stop. The
stream reconnects after a connection loss. Changes that happen between snapshots can merge. JSON
output from `list`, `read` and `events` includes the root turn and explicit child records when the
runtime reports them.

### Coordinate child terminals

Choose **Parent terminal** when opening a terminal in Studio. The picker lists live standalone
terminals on the selected computer. The CLI accepts a parent name or ID. Inside a Dovo terminal, use
`--parent self` to use its `DOVO_TERMINAL_ID`. Supply the same runtime connection settings you use
for other CLI commands.

```sh
dovo-server terminal start --name coordinator
dovo-server terminal start --name reviewer --parent coordinator
dovo-server terminal wait coordinator --children any --timeout 60 --json
dovo-server terminal wait coordinator --children all --timeout 60 --json
dovo-server terminal events coordinator
dovo-server terminal detach-parent reviewer
```

These waits inspect the current direct children each time. **Any** returns the children that have
exited, failed, blocked, or completed work. **All** returns when each child has exited or reported a
state other than Working. A blocked child can satisfy either wait. A live child with no report keeps
an all-children wait open. Both return immediately with an empty list when there are no children. On
timeout the CLI returns exit status 124 and lists the direct children. A remembered child keeps its
last Done or Error report after it exits. A settled child that sleeps still satisfies the wait.

A parent event includes `childNotices`, with the latest notice per child, its terminal ID, state and
turn. Read the child for its current activity and message. From inside the parent, run
`dovo-server terminal events "$DOVO_TERMINAL_ID"` to subscribe without writing to the parent's
input. Studio links parents and children on their owning computer. Closing a parent or detaching a
child leaves the child process running. If the runtime cannot confirm that the parent stopped, it
keeps the parent and its child links so you can retry Close. A split, a thread, or an OSC record
inside a PTY does not create a parent link.

## Standalone shell recovery

Thread, Unified and Terminal starters share the same heading, project selection and composer design,
including the minimal composer preference. Terminal replaces the model picker with its shell picker.
**Remember session** is enabled by default on runtimes that support recovery; older paired runtimes
show a disabled control until updated. This retains terminal identity, title, checkout, shell,
pin/settle/snooze state and the exact supported application's conversation identity on the owning
computer. On a runtime with live recovery, a local Dovo process owns the PTY. Closing a viewer or
restarting the runtime leaves the shell, foreground program and its in-memory environment running.
Closing the terminal ends the program. On managed Linux and macOS installations the holder has its
own user service. An older runtime or a Windows runtime reopens the shell in its directory.

If the machine reboots or the holder is lost, Dovo can reopen a shell or resume a supported tool
using its saved session identity. It never replays the submitted command. Settled sessions remain
asleep until restored. Snoozed sessions wake when due. A missing directory or a failed recovery
appears in the terminal so you can retry after fixing the problem.

Remembered terminals install scoped lifecycle integrations for **Codex**, **Claude**, **Pi** and
**OpenCode**, preserving existing configuration. Codex requires its normal one-time hook review;
review the Dovo hook with `/hooks` if prompted. Integrations load on the application's next start.
Each provider keeps its reporter in `dovo-terminal-recovery/report.cjs` under its config directory.
Two runtimes on the same computer can share that reporter. It writes to the terminal that invoked
it. When updating older hooks, Dovo keeps edited entries and entries whose reporter it cannot
identify. Recovery uses the exact captured conversation ID or Pi session file, never the latest
session in a directory. Custom tool configuration directories must be set before opening the
terminal. Native tool conversation files must remain available on the owning computer.

Dovo installs each provider integration separately. If Dovo cannot read or update one provider's
configuration, for example a malformed Codex `hooks.json`, it leaves that file unchanged. The other
integrations still install, and the shell still gets the terminal status and recovery environment.
The terminal shows `Could not install the Codex terminal integration:` followed by the error. Fix
the file, then open a new terminal. Dovo tries the failed provider again without a runtime restart.

On Unix, named **tmux** and **Herdr Core** (`hc attach`) launches also remember their canonical
session identity. They reattach to the existing multiplexer instead of launching a duplicate agent.
Bare `tmux` uses a stable Dovo session name. Custom sockets and interactive target pickers are not
captured. A shell configuration that replaces PATH can bypass these launchers. Reattachment survives
Dovo restarts while the multiplexer remains running; after a computer reboot, tmux pane
reconstruction still needs its native
[tmux-resurrect](https://github.com/tmux-plugins/tmux-resurrect) /
[tmux-continuum](https://github.com/tmux-plugins/tmux-continuum) setup. Dovo does not replay
arbitrary pane commands. Herdr's `--keep` replaces a lost program with a fresh shell; it does not
recover an agent conversation by itself. Dovo's direct agent integrations provide exact conversation
recovery.

Enable **Unified workspace** under **Settings → General → Experimental** to show **Workspace** in
navigation above the normal Threads, Browser and Terminals modes. These remain independent choices.
An additional **Hide normal modes** preference can hide those choices while Unified is enabled; it
is off by default. Disabling Unified restores the normal modes. Its sidebar mixes browser pages,
threads and standalone terminals, with search, computer and type filters under **Filter workspace**.
Threads render the same `TaskRow` component as Threads, with its project icon, title, branch and
status icon. A short age such as `14h` precedes the icon when the turn has a timestamp. Screen
readers announce the full status. On desktop, hover over the icon to read it. Pages render the
Browser workspace's `BrowserTabRow` with the same title weight and row spacing as Threads. It shows
the favicon, title, site and linked project or profile, unread badge and media indicators. Unified
adds a type badge to the leading icon of a thread, page or terminal. Standalone terminals share
their row with Terminals. Pinned pages use the same browser tile component and selection styling as
Browser, with the type badge on the favicon.

A small icon beside the terminal count shows how many subthreads belong to the parent. Open **Thread
info** to see them. On desktop and web, each child shows its age before the status icon. Hover over
the icon to read the full status. Older computers can supply a status without an age. Threads and
Unified keep child rows out of the overview.

Settled desktop rows stay on one line. Hover or focus the row to show Reopen in the checkmark slot.

On iPhone the thread list and open conversation measure the space below the native header. The
three-dot menu sits on the title line above the last metadata icon.

The overview uses the same row components; pinned pages use a normal tab row there. The overview
centers the routing input, with compact creation actions. The shared input appears only on
**Workspace home**, which shows a mixed **Continue working** list and retains open views and drafts.
Select a thread, page, or terminal in the sidebar to open it. Use the sidebar controls to create an
item. Workspace home and each open terminal fill one pane. In a narrow sidebar, the house button
opens **Workspace home**. Hidden threads and terminals retain their UI state and pause their
effects. Browser cleanup and tab synchronization continue while its page surface is hidden. Open
workspace references restore when the window reloads. Hiding an item leaves its underlying page,
thread or terminal available in the sidebar. Opening a thread selects its owning computer; remote
terminal and browser connections remain scoped to their owners. Remote terminals use existing
pairing, rather than direct SSH connections.

Unified uses the full Browser and Thread right-click menus. BrowserPane renders its own tab rows
into Unified, so native window actions, home URL controls and dialogs use the same handlers. Pinned
browser tabs have no hover toolbar. Their menu keeps Browser’s existing guards: unpin a tab before
settling, snoozing or closing it. Threads keep their rename, project, copy, handoff, archive and
delete actions. Terminals and Unified share a terminal menu with rename, split, new terminal, copy
working directory, copy terminal ID and close actions. Close asks for confirmation. Split and close
use the session’s owning computer, without changing the active thread’s computer. Other rows also
show direct lifecycle actions on hover or keyboard focus and on touch screens. Status sections keep
all resource types mixed. Within each section, threads use their latest real prompt time and pages
use their latest visit time, newest first. Streamed output does not move a thread. Pinned page tiles
keep their saved order. Terminals have no activity timestamp and keep their existing order after
timed items. Desktop and mobile use this shared activity rule. Desktop also follows the saved thread
section order. Pinned items appear first, and settled or snoozed items remain available to reopen or
unsnooze. Settling a thread follows the existing thread rules. Settling or snoozing a terminal keeps
working, blocked and unreported jobs running. A remembered agent with an exact recovery target may
release its PTY once the program explicitly reports **Idle** or **Done** through a supported
lifecycle hook or OSC 7501. Restoring it resumes that exact conversation; concurrent restores open
one process. Multiplexers stay live. Automatic sleep checks for background jobs and helper
processes; unknown or wrapped process trees stay live. Windows terminals currently stay live until
runtime shutdown. Tools without those activity reports stay running until runtime shutdown.
Foreground-process detection alone never authorizes sleeping. Terminal metadata is shared through
its owning runtime for paired clients, and remembered metadata survives restarts.

Terminal activity follows the program-reported approach used by
[Herdr Core](https://github.com/herdrdev/herdr-core#status-comes-from-the-program). Dovo observes
root [OSC 7501](https://www.superlogical.com/rex/docs/build/program-status) reports for **Working**,
**Needs input**, **Done**, **Failed** and **Idle**, including reported progress and messages. Codex
and Claude lifecycle hooks, Pi extensions and OpenCode plugins publish the same states through a
private per-terminal status file; hook stdout stays untouched. These integrations work with
**Remember session** off as well. Restart an already running agent to load the updated integration;
Codex may ask you to review its hook with `/hooks`.

On macOS and Linux, native PTY foreground inspection provides **Running** for ordinary commands and
**Idle** for an interactive shell prompt. It cannot determine command exit codes, background-job
activity or shell builtins running inside the shell process. Explicit program activity takes
precedence and is cleared when another foreground command takes over. Hosts without foreground
inspection or supported activity reports display **Live session**; output alone never implies work.
Working and Needs input terminals join the corresponding sections, while completion does not
automatically settle a session. Offline computers and exited shells take precedence over activity
reports. A program can report up to 32 child records using an explicit OSC 7501 `id`. A blocked
child puts the terminal in Needs input. The parent keeps its own status and turn number.

The runtime counts a turn when the root program leaves Working. Open the terminal in the foreground
to mark its latest completion read across paired devices. Use **Mark unread** to restore its
completion badge. Reading output through the CLI leaves the read state alone. Blocked activity stays
visible until the program clears or changes it.

Session names follow OSC 0/2 shell titles. Click the terminal's title to rename it; **Use automatic
title** restores shell naming. Renaming never restarts the shell. Metadata is observed on the owning
computer, so paired clients see the same titles and status even when no terminal view is open. For
example, a program can report that it needs approval with:

```sh
printf '\033]7501;state=blocked:kind=permission:app=my-agent\033\\'
```

Programs can send a `turnId` with OSC 7501 activity reports. Use the same ID on Working and its
result. If a hook reports the same work, send the same ID through the hook. Give independent jobs
different IDs, even when they finish together. IDs are case-sensitive, scoped to one terminal, and
accept 1 to 128 ASCII letters, digits, underscores, periods, slashes, plus signs or hyphens. The
`id` field identifies a child record. The `turnId` field identifies work on that record.

```sh
printf '\033]7501;state=working:turnId=review-42\007'
printf '\033]7501;state=done:turnId=review-42\007'
```

The numeric `turn` remains the cursor for `wait --after-turn`. The runtime keeps up to 128 open IDs
and the last 128 completed IDs per terminal to recognize delayed or repeated reports. Generate a
fresh ID for each job. A hook report includes its last 32 activity changes and the positions of its
last 128 identified completions. After an outage, the runtime can still match those completions to
OSC reports even if the activity changes have expired. Older hooks can provide less history. Once an
ID expires, the runtime has only the counter for that older work. Runtimes that support turn IDs
advertise `terminalTurnIdsSupported` in their snapshot.

The Codex hook uses `turn_id`. The Claude Code hook uses `prompt_id` when Claude supplies it. Pi,
OpenCode and older hooks can report activity without a shared turn ID. For these reports, Dovo uses
the order of activity changes to estimate when a turn ends. Two simultaneous jobs without IDs can
count as one.
[Codex hook fields](https://github.com/openai/codex/blob/51f4b8af01db1fb04e0cc6235444573ecceda716/codex-rs/hooks/src/schema.rs#L568-L592)
·
[Claude hook fields](https://github.com/anthropics/claude-agent-sdk-python/blob/69846cdf82aef59add3b14a26b4f16d1ccee26ba/src/claude_agent_sdk/types.py#L349-L356)

The shared input uses the **post-trained Dovo GLiClass run-09** classifier, based on
`knowledgator/gliclass-base-v3.0` (186.5 million parameters). The exact Mac Studio export is pinned
by SHA-256 in `scripts/packaging/workspace-router-model.mjs`; its weights, official standalone
tokenizer and licenses total **206.3 MB**. Builds download verified assets from the repository's
[model asset release](https://github.com/dovocode/dovo-studio/releases/tag/workspace-router-gliclass-20261104-r09).
Inference never downloads anything or uses provider credentials. One lazy CPU worker on the owning
runtime serves desktop, web and paired mobile clients, then unloads after a minute without requests.
Mobile does not load the model into the phone's process.

The model chooses **Browser**, **Terminal** or **Thread**, then suggests an available computer. The
client loads that computer's project and browser-profile choices. New thread suggestions also use
the inferred project's available harnesses and cached model names. Only display labels and opaque
choice IDs enter classification; harness configuration and credentials stay outside it. The user
reviews and can override computer, project, thread model, browser profile, destination and terminal
shell before explicitly opening or submitting anything. **⌘+Enter** (or **Ctrl+Enter**) opts into
choosing and starting in one step: it applies the inferred selections, waits for the selected
computer's shell catalog when needed, then opens the page, runs the command or sends the thread
request. Editing the draft or selections, or navigating away while inference/catalog loading is in
progress, cancels that automatic start. Returning to Home does not start the canceled request. Home
keeps unsent text and the selected computer when you switch Studio modes in the same window. Review
the destination again when you return. If the browser has 100 tabs, Home keeps the address. Close a
tab and submit the address again. Normal submission keeps the review step. Continuing an explicitly
selected thread keeps that thread's own model and project. Older runtimes without the
picker-suggestion capability continue accepting destination-only requests.

All routing and picker inference comes from model logits. URL/shell rules do not override its
choice, and scores are not presented as calibrated confidence. Capability discussion such as “Could
Opus handle this bug fix?” retains the current model; an explicit request to use Opus selects it.
This distinction is learned and imperfect: some advice prompts still select a named model. Measured
export quality is **1,460/1,461 synthetic regression questions** and **49/50 fresh complete
suggestions**; these do not establish 99.9% real-world reliability. The
[training report](workspace-selection-hardening.md) retains failures and evaluation provenance.

The graph supports 16 choices and 384 tokens per comparison. Larger catalogs are compared in bounded
groups and then among model-selected finalists; entries are not silently dropped. This catalog
reduction is an integration behavior, not part of the reported 16-choice accuracy score. Missing
assets, inference failures, worker capacity limits, input over 2,000 characters and inputs that
exceed the token budget select Thread with a review explanation, preserving the draft. No routing
request creates a task, opens a page or executes a command. Stale draft/computer responses are
discarded.

After accepting Browser, a single address in input such as `open dovocode.com in Work` is extracted
for navigation, and the chosen profile/computer is passed to the page. This extraction never chooses
the destination; inputs without one clear address retain normal browser-search behavior. Explicit
HTTP remains HTTP for LAN and VPN connections. Terminal submission uses the exact original input,
without stripping computer/project prose or rewriting commands. Review or edit it before running;
manual destination selection allows editing without reclassification. Thread submission preserves
the request and applies an explicitly chosen model only to a new thread. **New terminal** retains
the complete shell/worktree starter.

If a launch loses its response, submit the same command and selections again. You can retry after
switching Studio modes in the same window. Runtimes that support terminal request IDs return the
existing terminal and run its startup command once. When a launch succeeds while you are away, Home
clears the submitted draft and keeps any newer text. If the terminal closed after launch, the retry
reports that it is unavailable. If the runtime could not start the shell because its checkout was
unavailable, retry when the checkout returns. For an older runtime, check Terminals for the session
before trying again.

On desktop, choosing a browser profile for an external link selects its new page in Unified when the
normal workspace modes are hidden.

The [small-model comparison](workspace-routing-model-comparison.md) records the earlier Julia, Laya,
Kev and instruction-model experiments. GLiClass training/export measurements are recorded
separately.

Verification: `pnpm test:unified-workspace:browser` covers mixed views, draft retention, owner
selection, lifecycle actions, routing overrides, HTTP preservation, shell selection, all checkout
options, stale computer responses, catalog retries and explicit command execution. Runtime tests in
`workspace-terminals.test.ts` cover paired standalone shells and execution;
`workspace-router.test.ts` covers worker transport, bounded concurrency, timeouts, failures and
output validation. Title-service tests verify routing needs no configured utility provider and
creates no tasks. `pnpm prepare:workspace-router` fetches SHA-256-verified, revision-pinned assets
during development; release runtime preparation includes this step automatically.
`pnpm test:workspace-router:model` checks 100 frozen Mac export references and 32 complete
acceptance scenarios offline, checks a catalog with more than 16 entries, and exercises the actual
worker. Packaged runtime smoke checks verify native inference from the deployed dependency tree.
`pnpm test:workspace-submit:browser` mounts the actual workspace, thread, browser and terminal
components to check submissions and retained local/remote views through repeated swaps, preserving
drafts and terminal replay. It also checks inferred owner/project/model/profile selections, visible
overrides and explicit execution; `test:mobile-workspaces:browser` covers the mobile equivalents
with browser adapters. `pnpm test:workspace-modes:browser` exercises the actual Workbench and
extension catalog through mode changes, restored threads/pages, incoming snapshots, compact layout
and sidebar collapse. Terminal metadata tests cover fragmented sequences, bounds, PTY output
preservation, renaming and runtime snapshot synchronization.
`packages/runtime/src/terminal/recovery.test.ts` covers generated lifecycle adapters, configuration
preservation, exact concurrent conversation recovery through runtime recreation, canonical
multiplexer targets, smart sleep, concurrent restores, explicit close and missing-folder recovery.
These automated checks use fake CLI executables; a physical reboot and complete native tool sessions
still need manual verification.
