# Terminals and unified workspace

Desktop and web have a **Terminals** workspace with sessions from paired Dovo computers, including
shells opened inside threads. Use **New terminal** to choose a computer and either its home folder
or a project folder. Sessions stay standalone, with the thread workspace's sidebar and context
header and the terminal as the main content. These shells use the same Ghostty terminal and split
controls as thread terminals. Sessions run on their owning computer; hiding a pane or changing
workspaces keeps the shell running. Closing a terminal inside the terminal pane terminates it.
Terminals do not survive a runtime restart.

Enable **Unified workspace** under **Settings → General → Experimental** to show **Workspace** in
navigation. Its sidebar mixes browser pages, threads and terminals, with type icons, search,
computer and type filters under **Filter workspace**. The overview centers the routing input, with
compact creation actions; opening a tab reduces the input to a toolbar above the content. Open items
in mixed tabs to work inside one workspace. Hidden threads and terminals retain their UI state and
pause their effects. Browser cleanup and tab synchronization continue while its page surface is
hidden. Workspace tab references restore when the window reloads. Closing a workspace tab leaves its
underlying page, thread or terminal available in the sidebar. Opening a thread selects its owning
computer; remote terminal and browser connections remain scoped to their owners. Remote terminals
use existing pairing, rather than direct SSH connections.

**Pin**, **Settle/Reopen** and **Snooze** are available from each row’s actions menu. Status
sections keep all resource types mixed. Pinned items appear first, and settled or snoozed items
remain available to reopen or unsnooze. Settling a thread follows the existing thread rules;
settling or snoozing a terminal only organizes the session and keeps its shell running. Terminal
metadata is shared through its owning runtime for paired clients, for the lifetime of that session.

The shared input uses the configured utility/title model to suggest **Browser**, **Terminal** or
**Thread**. Choose a lightweight utility model in **Settings → Agents → Titles & dictation**.
Classification has no tools and returns only a destination and explanation. Review or override the
destination, then use **Open browser**, **Run command**, or **Start/Send to thread**. Terminal
commands use the original input in a new shell on the current computer, with an optional project
folder. Thread requests continue the selected thread or start a new one. Routing failures preserve
the input and allow a manual destination. Explicit HTTP addresses retain HTTP for LAN and VPN use.

Verification: `pnpm test:unified-workspace:browser` covers mixed tabs, draft retention, owner
selection, lifecycle actions, routing overrides, HTTP preservation and explicit command execution.
Runtime tests in `workspace-terminals.test.ts` cover paired standalone shells and execution;
utility-model tests cover bounded, tool-free classification and output validation.
