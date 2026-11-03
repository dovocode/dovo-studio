# Terminals and unified workspace

Desktop and web have a **Terminals** workspace with sessions from paired Dovo computers, including
shells opened inside threads. Choose a computer and either its home folder or a project folder to
open a standalone shell. These shells use the same Ghostty terminal and split controls as thread
terminals. Sessions run on their owning computer; hiding a pane or changing workspaces keeps the
shell running. Closing a terminal inside the terminal pane terminates it. Terminals do not survive a
runtime restart.

Enable **Unified workspace** under **Settings → General → Experimental** to show **Workspace** in
navigation. Its sidebar lists browser pages, threads and terminals, with search, computer and type
filters. Open items in mixed tabs to work inside one workspace. Hidden tabs retain their UI state
and pause their effects. Workspace tab references restore when the window reloads. Closing a
workspace tab leaves its underlying page, thread or terminal available in the sidebar. Opening a
thread selects its owning computer; remote terminal and browser connections remain scoped to their
owners. Remote terminals use existing pairing, rather than direct SSH connections.

The shared input uses the configured utility/title model to suggest **Browser**, **Terminal** or
**Thread**. Choose a lightweight utility model in **Settings → Agents → Titles & dictation**.
Classification has no tools and returns only a destination and explanation. Review or override the
destination, then use **Open browser**, **Run command**, or **Start/Send to thread**. Terminal
commands use the original input in a new shell on the current computer, with an optional project
folder. Thread requests continue the selected thread or start a new one. Routing failures preserve
the input and allow a manual destination. Explicit HTTP addresses retain HTTP for LAN and VPN use.

Verification: `pnpm test:unified-workspace:browser` covers mixed tabs, draft retention, owner
selection, routing overrides, HTTP preservation and explicit command execution. Runtime tests in
`workspace-terminals.test.ts` cover paired standalone shells and execution; utility-model tests
cover bounded, tool-free classification and output validation.
