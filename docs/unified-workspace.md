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
Sessions run on their owning computer; hiding a pane or changing workspaces keeps the shell running.
Closing a terminal inside the terminal pane terminates it. Terminals do not survive a runtime
restart.

Enable **Unified workspace** under **Settings → General → Experimental** to show **Workspace** in
navigation above the normal Threads, Browser and Terminals modes. These remain independent choices.
An additional **Hide normal modes** preference can hide those choices while Unified is enabled; it
is off by default. Disabling Unified restores the normal modes. Its sidebar mixes browser pages,
threads and standalone terminals, with search, computer and type filters under **Filter workspace**.
Threads keep their project icon and familiar project/title/branch layout, with a small message
bubble underneath. Pages retain their favicon and profile initials, with a small browser mark
underneath. Standalone terminals use the thread layout with a terminal icon. The overview centers
the routing input, with compact creation actions; opening a tab reduces the input above the content.
**Workspace home** shows a mixed **Continue working** list and retains open tabs and drafts. Open
items in mixed tabs to work inside one workspace. Hidden threads and terminals retain their UI state
and pause their effects. Browser cleanup and tab synchronization continue while its page surface is
hidden. Workspace tab references restore when the window reloads. Closing a workspace tab leaves its
underlying page, thread or terminal available in the sidebar. Opening a thread selects its owning
computer; remote terminal and browser connections remain scoped to their owners. Remote terminals
use existing pairing, rather than direct SSH connections.

**Pin**, **Snooze** and **Settle/Reopen** appear as direct row actions, revealed on hover or
keyboard focus and kept accessible on touch screens. Status sections keep all resource types mixed.
Pinned items appear first, and settled or snoozed items remain available to reopen or unsnooze.
Settling a thread follows the existing thread rules; settling or snoozing a terminal only organizes
the session and keeps its shell running. Terminal metadata is shared through its owning runtime for
paired clients, for the lifetime of that session.

The shared input uses the configured utility/title model to suggest **Browser**, **Terminal** or
**Thread**. Choose a lightweight utility model in **Settings → Agents → Titles & dictation**.
Classification has no tools and returns only a destination and explanation. Review or override the
destination, then use **Open browser**, **Run command**, or **Start/Send to thread**. Terminal
commands use the original input in a new shell on the explicitly selected computer, with an
installed shell picker and optional project folder. Use **New terminal** for the complete worktree
starter. Thread requests start a new thread or continue the explicitly chosen thread. The input
keeps its computer and destination while you switch workspace tabs; changing tabs never silently
retargets a draft. Routing failures preserve the input and allow a manual destination. Explicit HTTP
addresses retain HTTP for LAN and VPN use.

Verification: `pnpm test:unified-workspace:browser` covers mixed tabs, draft retention, owner
selection, lifecycle actions, routing overrides, HTTP preservation, shell selection, all checkout
options, stale computer responses, catalog retries and explicit command execution. Runtime tests in
`workspace-terminals.test.ts` cover paired standalone shells and execution; utility-model tests
cover bounded, tool-free classification and output validation.
