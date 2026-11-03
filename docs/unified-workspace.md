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
Threads keep their project icon and familiar project/title/branch layout, with a small message
bubble underneath. Pages retain their favicon and profile initials, with a small browser mark
underneath. Standalone terminals use the thread layout with a terminal icon. Pinned browser pages
keep the Browser workspace's compact tiles, above pinned thread and terminal rows. The overview
centers the routing input, with compact creation actions. The shared input appears only on
**Workspace home**, which shows a mixed **Continue working** list and retains open views and drafts.
Select items in the sidebar to work inside one workspace, without a horizontal tab strip. Hidden
threads and terminals retain their UI state and pause their effects. Browser cleanup and tab
synchronization continue while its page surface is hidden. Open workspace references restore when
the window reloads. Hiding an item leaves its underlying page, thread or terminal available in the
sidebar. Opening a thread selects its owning computer; remote terminal and browser connections
remain scoped to their owners. Remote terminals use existing pairing, rather than direct SSH
connections.

**Pin**, **Snooze** and **Settle/Reopen** appear as direct row actions, revealed on hover or
keyboard focus and kept accessible on touch screens. Status sections keep all resource types mixed.
Pinned items appear first, and settled or snoozed items remain available to reopen or unsnooze.
Settling a thread follows the existing thread rules. Settling or snoozing a terminal keeps working,
blocked and unreported jobs running. A remembered agent with an exact recovery target may release
its PTY once the program explicitly reports **Idle** or **Done** through OSC 7501. Restoring it
resumes that exact conversation; concurrent restores open one process. Multiplexers stay live.
Automatic sleep checks for background jobs and helper processes; unknown or wrapped process trees
stay live. Windows terminals currently stay live until runtime shutdown. Tools without those
activity reports stay running until runtime shutdown. Terminal metadata is shared through its owning
runtime for paired clients, and remembered metadata survives restarts.

Terminal activity follows the program-reported approach used by
[Herdr Core](https://github.com/herdrdev/herdr-core#status-comes-from-the-program). Dovo observes
root [OSC 7501](https://www.superlogical.com/rex/docs/build/program-status) reports for **Working**,
**Needs input**, **Done**, **Failed** and **Idle**, including reported progress and messages.
Unsupported programs display **Live session**; output alone never implies work. Working and Needs
input terminals join the corresponding sections, while completion does not automatically settle a
session. Offline computers and exited shells take precedence over activity reports. This observer
supports root reports, clearing and prompt/exit cleanup; it does not advertise full OSC 7501
support, answer capability queries or aggregate child records.

Session names follow OSC 0/2 shell titles. Click the terminal's title to rename it; **Use automatic
title** restores shell naming. Renaming never restarts the shell. Metadata is observed on the owning
computer, so paired clients see the same titles and status even when no terminal view is open. For
example, a program can report that it needs approval with:

```sh
printf '\033]7501;state=blocked:kind=permission:app=my-agent\033\\'
```

The shared input uses the configured utility/title model to suggest **Browser**, **Terminal** or
**Thread**. Choose a lightweight utility model in **Settings → Agents → Titles & dictation**.
Classification has no tools and returns only a destination and explanation. Review or override the
destination, then use **Open browser**, **Run command**, or **Start/Send to thread**. Terminal
commands use the original input in a new shell on the explicitly selected computer, with an
installed shell picker and optional project folder. Use **New terminal** for the complete worktree
starter. Thread requests start a new thread or continue the explicitly chosen thread. The input
keeps its computer and destination while you switch workspace items; changing items never silently
retargets a draft. Routing failures preserve the input and allow a manual destination. Explicit HTTP
addresses retain HTTP for LAN and VPN use.

Verification: `pnpm test:unified-workspace:browser` covers mixed views, draft retention, owner
selection, lifecycle actions, routing overrides, HTTP preservation, shell selection, all checkout
options, stale computer responses, catalog retries and explicit command execution. Runtime tests in
`workspace-terminals.test.ts` cover paired standalone shells and execution; utility-model tests
cover bounded, tool-free classification and output validation. `pnpm test:workspace-submit:browser`
mounts the actual workspace, thread, browser and terminal components to check submissions and
retained local/remote views through repeated swaps, preserving drafts and terminal replay.
`pnpm test:workspace-modes:browser` exercises the actual Workbench and extension catalog through
mode changes, restored threads/pages, incoming snapshots, compact layout and sidebar collapse.
Terminal metadata tests cover fragmented sequences, bounds, PTY output preservation, renaming and
runtime snapshot synchronization. `packages/runtime/src/terminal/recovery.test.ts` covers generated
lifecycle adapters, configuration preservation, exact concurrent conversation recovery through
runtime recreation, canonical multiplexer targets, smart sleep, concurrent restores, explicit close
and missing-folder recovery. These automated checks use fake CLI executables; a physical reboot and
complete native tool sessions still need manual verification.
