# Terminals and unified workspace

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
Standalone sessions use sidebar navigation without a horizontal terminal tab strip. **New terminal**
opens the workspace starter; split controls add panes inside the selected session. Sessions run on
their owning computer; hiding a pane or changing workspaces keeps the shell running. Closing a
terminal inside the terminal pane terminates it and forgets its recovery record.

Thread, Unified and Terminal starters share the same heading, project selection and composer design,
including the minimal composer preference. Terminal replaces the model picker with its shell picker.
**Remember session** is enabled by default on runtimes that support recovery; older paired runtimes
show a disabled control until updated. This retains terminal identity, title, checkout, shell,
pin/settle/snooze state and the exact supported application's conversation identity on the owning
computer. Active sessions reopen when that runtime starts again, including after a computer reboot.
Settled sessions remain asleep until restored; snoozed sessions wake when due. Neither environment
variables nor terminal input, startup commands or scrollback are saved. Ordinary shells reopen in
their directory without replaying commands. Missing directories and recovery failures remain visible
so the session can be restored after the problem is resolved.

Remembered terminals install scoped lifecycle integrations for **Codex**, **Claude**, **Pi** and
**OpenCode**, preserving existing configuration. Codex requires its normal one-time hook review;
review the Dovo hook with `/hooks` if prompted. Integrations load on the application's next start.
Recovery uses the exact captured conversation ID or Pi session file, never the latest session in a
directory. Custom tool configuration directories must be set before opening the terminal. Native
tool conversation files must remain available on the owning computer.

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
status. Pages render the Browser workspace's `BrowserTabRow`, including its favicon, title,
computer/profile label, unread badge and media indicators. Unified adds no extra thread or browser
type icon. Standalone terminals share their row with Terminals. Pinned pages use the same browser
tile component, icon size and selection styling as Browser, above pinned thread and terminal rows.
The overview uses the same row components; pinned pages use a normal tab row there. The overview
centers the routing input, with compact creation actions. The shared input appears only on
**Workspace home**, which shows a mixed **Continue working** list and retains open views and drafts.
Select items in the sidebar to work inside one workspace, without a horizontal tab strip. Hidden
threads and terminals retain their UI state and pause their effects. Browser cleanup and tab
synchronization continue while its page surface is hidden. Open workspace references restore when
the window reloads. Hiding an item leaves its underlying page, thread or terminal available in the
sidebar. Opening a thread selects its owning computer; remote terminal and browser connections
remain scoped to their owners. Remote terminals use existing pairing, rather than direct SSH
connections.

Unified uses the full Browser and Thread right-click menus. BrowserPane renders its own tab rows
into Unified, so native window actions, home URL controls and dialogs use the same handlers. Pinned
browser tabs have no hover toolbar. Their menu keeps Browser’s existing guards: unpin a tab before
settling, snoozing or closing it. Threads keep their rename, project, copy, handoff, archive and
delete actions. Terminals and Unified share a terminal menu with rename, split, new terminal, copy
working directory, copy terminal ID and close actions. Close asks for confirmation. Split and close
use the session’s owning computer, without changing the active thread’s computer. Other rows also
show direct lifecycle actions on hover or keyboard focus and on touch screens. Status sections keep
all resource types mixed. Pinned items appear first, and settled or snoozed items remain available
to reopen or unsnooze. Settling a thread follows the existing thread rules. Settling or snoozing a
terminal keeps working, blocked and unreported jobs running. A remembered agent with an exact
recovery target may release its PTY once the program explicitly reports **Idle** or **Done** through
a supported lifecycle hook or OSC 7501. Restoring it resumes that exact conversation; concurrent
restores open one process. Multiplexers stay live. Automatic sleep checks for background jobs and
helper processes; unknown or wrapped process trees stay live. Windows terminals currently stay live
until runtime shutdown. Tools without those activity reports stay running until runtime shutdown.
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
reports. This observer supports root reports, clearing and prompt/exit cleanup; it does not
advertise full OSC 7501 support, answer capability queries or aggregate child records.

Session names follow OSC 0/2 shell titles. Click the terminal's title to rename it; **Use automatic
title** restores shell naming. Renaming never restarts the shell. Metadata is observed on the owning
computer, so paired clients see the same titles and status even when no terminal view is open. For
example, a program can report that it needs approval with:

```sh
printf '\033]7501;state=blocked:kind=permission:app=my-agent\033\\'
```

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
progress, cancels that automatic start. Normal submission keeps the review step. Continuing an
explicitly selected thread keeps that thread's own model and project. Older runtimes without the
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
