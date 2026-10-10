# Dovo artifacts

Dovo Artifacts is disabled by default. Enable **Dovo Artifacts** in Settings → Tasks & projects →
Artifacts on desktop, or the computer’s **Artifacts** settings on mobile. The setting is stored on
the runtime and shared by all connected devices. Disabling it hides artifact UI and removes the
tools from new agent sessions; existing sessions cannot call the disabled API. Saved artifacts and
versions remain available when it is enabled again unless a configured retention rule deletes them.

Agents can create persistent artifacts inside a thread using the built-in `dovo_task` tools. No
external MCP server or artifact service is required. The same tools are supplied to the existing
Codex, Claude, OpenCode and ACP harnesses.

Harness guidance favors normal replies and repository files for routine explanations, plans, reports
and code changes. Agents should create an artifact when requested or when a persistent, viewable
deliverable adds clear value, and update an existing artifact when appropriate. Progress updates and
copies of existing answers or files do not need artifacts.

- `artifact_create`: title, format, full content and optional language. Returns an ID and revision.
- `artifact_list`: metadata for the current thread, without content bodies.
- `artifact_read`: ID and optional revision; returns content and metadata.
- `artifact_update`: ID, expectedRevision, title, format, full content and optional language. Saves
  a new revision. A stale expectedRevision returns a conflict rather than overwriting newer work.

Supported formats are `markdown`, `html`, `svg` and `code`. Use self-contained HTML with embedded
scripts and assets for interactive artifacts. HTML and SVG previews run in an opaque sandbox with no
external network, host DOM, runtime credentials, filesystem, native bridge or popup access.
Artifacts do not receive the interactive MCP Apps tool bridge.

Desktop exposes **Artifacts** in the thread toolbar. Conversation cards open the selected artifact
beside chat, with an option to expand the preview. Mobile exposes artifacts in the thread menu and
opens conversation cards in a full-screen viewer. Tool activity shows artifact cards even when the
work group is collapsed. Both viewers support selecting artifacts and saved versions, preview/source
switching and explicit refresh. Desktop can copy and download sources; mobile can share the selected
version through the system share sheet.

The desktop left sidebar and mobile navigation also expose **Artifacts** when a connected computer
has the feature enabled. This library lists artifacts across enabled computers, most recently
updated first, with search, format and thread-state filters. Cards identify documents, interactive
artifacts, graphics and code, along with their originating thread and computer. Desktop cards use
format illustrations without fetching or running artifact bodies. Use Refresh to update the list.
Each preview is fetched from its owning computer only when opened; unavailable computers show an
error without blocking the other computers.

Computer settings offer separate retention rules for settled and archived threads: keep forever (the
default), delete immediately, or delete after 7, 30 or 90 days. Archive retention takes priority
over settlement retention. Editing an artifact does not restart its timer, and timers survive
runtime restarts. Reopening or restoring a thread cancels the old state’s timer; entering a new
settled or archived state starts its applicable timer. Immediate deletion runs on the state change
or settings save. Delayed cleanup runs at startup and every 15 minutes. Retention continues while
Dovo Artifacts is disabled, and deletion permanently removes all revisions.

Bodies are stored separately in SQLite, never in workspace snapshots or artifact reference events.
Viewers fetch content only when opened. The existing tool details preference still controls raw
provider input/output. Each revision is limited to 2 MB of UTF-8 content. Deleting a thread removes
all its artifact revisions. Paired devices can read artifacts; creation and updates use the
runtime's host credential and respect read-only thread permissions.

Run `pnpm test:artifacts:browser` for sandbox and desktop/mobile viewer interaction checks. Run the
runtime artifact and agent-tools tests for HTTP authorization, revision conflicts, persistence,
thread scoping, retention and real provider MCP transport coverage. Browser checks also verify
multi-computer library routing and lazy content loading. Native WebView and OS share-sheet behavior
still require device verification.
