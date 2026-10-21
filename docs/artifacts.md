# Dovo artifacts

For optional private hosted copies, account invitations and expiring share links, see
[Hosted artifact sharing](hosted-artifacts.md).

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

- `artifact_create`: title, format, full content (or a folder of files) and optional language.
  Returns an ID and revision.
- `artifact_list`: metadata for the current thread, without content bodies.
- `artifact_read`: ID and optional revision; returns content and metadata.
- `artifact_update`: ID, expectedRevision, title, format, full content (or a folder of files) and
  optional language. Saves a new revision. A stale expectedRevision returns a conflict rather than
  overwriting newer work.

Supported formats are `markdown`, `html`, `svg` and `code`. Use self-contained HTML with embedded
scripts and assets, or a folder of files, for interactive artifacts. HTML and SVG previews run in an
opaque sandbox with no external network, host DOM, runtime credentials, filesystem, native bridge or
popup access. Artifacts do not receive the interactive MCP Apps tool bridge.

Interactive artifacts can download files they generate locally using `<a download>` with Blob or
data URLs, including canvas exports. Desktop and web use the normal browser download flow; mobile
opens the share sheet so the user can save or share the file. Mobile downloads are limited to 20 MB.
The mobile wrapper relays only validated file payloads, never general native commands. External
downloads and network access remain blocked, and temporary mobile files are removed after sharing.

Multi-file artifacts use `format: "html"` with `files` instead of `content`. Paths can include
subfolders. The default entry file is `index.html`; set `entrypoint` to use another HTML file:

```json
{
  "title": "Counter",
  "format": "html",
  "entrypoint": "index.html",
  "files": [
    {
      "path": "index.html",
      "content": "<link rel=\"stylesheet\" href=\"styles.css\"><button id=\"count\">0</button><script defer src=\"main.js\"></script>"
    },
    { "path": "styles.css", "content": "button { color: royalblue }" },
    {
      "path": "main.js",
      "content": "document.querySelector('#count').onclick = event => event.target.textContent = Number(event.target.textContent) + 1;"
    }
  ]
}
```

The runtime compiles the folder into a working, isolated preview. Relative stylesheets, CSS imports,
JavaScript module imports, images, fonts and media are included from the supplied files. Inline CSS
backgrounds and responsive images also resolve against the folder. Use `encoding: "base64"` for
binary assets; text defaults to UTF-8. No host filesystem, npm packages or external network is
available. Files that are not used by the preview are still saved and included in downloads.

Folders support up to 128 files, with a combined 100 MB source limit and a separate 100 MB compiled
preview limit. Paths must be relative and unique, including on case-insensitive filesystems. Each
update supplies the complete folder and creates one atomic revision; a failed build leaves the saved
version intact. To convert back to a single-file artifact, omit `files` and supply `content`.

Desktop has a file selector for browsing source and **Download folder** for a ZIP containing the
selected revision. On mobile, use **Browse files**, then **Export → Share folder (ZIP)**. The
archive contains one top-level folder with the original directory structure and binary assets.
Returning to Preview preserves interactive state while browsing source. PDF export and library
snapshots use the combined HTML preview.

Folder exports also offer **Interactive HTML** and **MHTML snapshot** on desktop and mobile.
Interactive HTML bundles the saved preview into one `.html` file with its CSS, JavaScript and
assets; controls continue to work offline inside the same networkless sandbox. MHTML saves a
`.mhtml` page archive of the rendered initial state. Chromium removes scripts and event handlers
from this snapshot, so it preserves the page’s appearance rather than its interactions. Both export
the selected saved revision, rather than unsaved interactions in the viewer. MHTML generation uses
the owning computer’s isolated Chromium browser and requires it to be connected with Chromium
available. ZIP preserves all original files, including files unused by the preview.

HTML and SVG viewers follow the app's light/dark mode and color palette, with themed typography,
links and form controls when the artifact does not supply its own styles. Authored styles take
precedence. Interactive pages can use the `--preview-background`, `--preview-foreground`,
`--preview-surface`, `--preview-border` and `--preview-accent` CSS variables.

Desktop exposes **Artifacts** in the thread toolbar. Conversation cards open the selected artifact
beside chat, with an option to expand the preview. Mobile exposes artifacts in the thread menu and
opens conversation cards in a full-screen viewer. Tool activity shows artifact cards even when the
work group is collapsed. Cards appear only at the message that produced that revision. Older
artifacts do not appear in the trailing activity area while their conversation history is unloaded.
Mobile previews rebuild after WebView process termination. Both viewers support selecting artifacts
and saved versions, preview/source switching and explicit refresh. Desktop can copy and download
sources; mobile can share the selected version through the system share sheet. **Export PDF or PNG**
on desktop and **Export** on mobile open compact export options for every artifact format.

PDF offers automatic/artifact-defined paper sizing or A4, A3, US Letter and US Legal, portrait or
landscape orientation, 0–50 mm margins, 10–200% content scaling and optional backgrounds. Automatic
sizing keeps the artifact's authored page size and orientation, with A4 as the fallback. An explicit
paper size and orientation override authored page rules. Documents render as formatted Markdown,
code wraps, and HTML/SVG retain their other print styles. Output paginates instead of clipping.

**Edit before export** prepares a temporary rendered copy for PDF and MHTML. Edit text directly with
`contenteditable`, or switch to **Select elements** to delete a node, select its parent section, or
**Exclude from export**. Excluded elements remain dimmed in the editor; **Include in export**
restores them. Removal/exclusion has an undo button. **Use edited copy** applies the temporary copy
to later PDF/MHTML exports of that saved revision; **Discard edits** closes the editor without
applying its changes, and **Reset edits** returns to the saved version. Editing does not create a
revision, change source files or affect the original live preview. Temporary edits stay within the
open viewer and never carry into another artifact or revision. Guest scripts run while preparing the
initial state, then are removed; the editing guest cannot execute scripts or access the host/native
bridge.

Authors can mark non-printable elements with `class="no-print"` or the `data-no-print` attribute.
PDF and MHTML exports remove those elements, including their descendants, without modifying the
saved artifact. They remain present in normal previews, source/ZIP/interactive HTML and PNG exports.
These markers also work inside compiled multi-file artifacts. Editor actions use a compact icon
toolbar with tooltips and accessibility labels, with larger touch targets on phones.

PNG exports the full page using its screen layout at a configurable width of 320–4096 pixels
(default 1440). Height follows the content; responsive styles use the selected width. Extremely tall
pages (over 32,768 pixels or 64 megapixels) return an error instead of being silently cropped; use
PDF for those documents. On mobile, both formats use the native share sheet.

Exports use the selected saved version, including older revisions, and the owning computer's
isolated, networkless Chromium browser. That computer must be connected and have Chromium available.
Interactive artifacts export their saved initial state; hosted external links cannot be exported.

The desktop left sidebar and mobile navigation also expose **Artifacts** when a connected computer
has the feature enabled. This library lists artifacts across enabled computers, most recently
updated first, with search, format and thread-state filters. Cards identify documents, interactive
artifacts, graphics and code, along with their originating thread and computer. Cards show small
snapshots: document/code excerpts and cached raster images for HTML/SVG. Desktop loads snapshots as
cards approach the viewport; mobile uses a bounded, virtualized list. HTML/SVG snapshots render on
the owning runtime in an isolated, networkless browser context, never inside the library page. If
Chrome is unavailable, the format illustration remains with “Snapshot unavailable”; the full
artifact can still be opened. Use Refresh to update the list. Each full preview is fetched from its
owning computer only when opened; unavailable computers show an error without blocking the other
computers.

Each library card offers **Add to thread** and **Delete artifact**. Add to thread copies the
selected version into an active, writable thread on the same computer and offers **Open thread**.
The copy gets its own ID and version history, appears in the destination's Artifacts viewer, and is
available to its agent through `artifact_list` and `artifact_read`. Editing or deleting either
artifact does not affect the other. Delete requires confirmation and permanently removes all saved
versions and artifact activity tiles. If the artifact changed since the library loaded, refresh
before deleting. Paired devices can perform both actions; copying respects the destination's
read-only permissions.

Computer settings offer separate retention rules for settled and archived threads: keep forever (the
default), delete immediately, or delete after 7, 30 or 90 days. Archive retention takes priority
over settlement retention. Editing an artifact does not restart its timer, and timers survive
runtime restarts. Reopening or restoring a thread cancels the old state’s timer; entering a new
settled or archived state starts its applicable timer. Immediate deletion runs on the state change
or settings save. Delayed cleanup runs at startup and every 15 minutes. Retention continues while
Dovo Artifacts is disabled, and deletion permanently removes all revisions.

Bodies are stored separately in SQLite, never in workspace snapshots or artifact reference events.
Full viewers fetch content only when opened; library snapshots contain only a bounded excerpt or a
small image. The existing tool details preference still controls raw provider input/output. Each
revision is limited to 100 MB of UTF-8 content. Deleting a thread removes all its artifact
revisions. Paired devices can read artifacts; creation and updates use the runtime's host credential
and respect read-only thread permissions.

Run `pnpm test:artifacts:browser` for sandbox and desktop/mobile viewer interaction checks, and
`pnpm test:artifact-pdf:browser` for actual PDF/PNG rendering, dimensions, pagination and export
isolation. Run the runtime artifact and agent-tools tests for HTTP authorization, revision
conflicts, persistence, thread scoping, retention and real provider MCP transport coverage. Browser
checks also verify multi-computer library routing, lazy snapshots, copy/delete actions and failure
recovery. Native WebView and OS share-sheet behavior still require device verification.

## Shared live dashboards

Published artifacts can receive a fixed, explicitly approved read query from the publisher's MCP
server. Desktop and mobile sharing controls provide tool selection, fixed JSON arguments, field
selection, preview, approval and stopping/clearing the feed. Readers receive selected data through a
one-way sandbox event; they cannot call tools or inherit credentials. Read-only tool annotations
require a trusted server with source credentials restricted to read-only.

See [hosted artifact sharing](hosted-artifacts.md#publisher-approved-live-mcp-dashboards) for setup,
the `dovo:artifact-data` event API, expiry, cached-data behavior and revocation limits.
