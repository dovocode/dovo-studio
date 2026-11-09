# Studio editing and recovery

Desktop and web show a warning if device preferences cannot be saved. Keep the window open. Correct
the storage problem, then select **Retry saving settings**. Studio retains the pending choices in
memory and merges them with the latest stored settings on retry. A failed service URL save does not
show a success message. Desktop and web retain unknown stored fields when they save. An older client
does not remove fields written by a newer client. Only validated, known fields appear in the
application preferences.

If a settings read fails, Studio keeps the last valid settings and pending edits in memory. It
blocks writes until it can read the saved document again. **Retry saving settings** reads the latest
document before it merges pending edits. It does not replace unread settings with defaults. The
service URL form clears its save error when that retry succeeds.

Settings replication reads full versions from the raw exchange. It does not import decoded snapshots
as immutable versions. Legacy connections read their settings endpoint and reject unknown fields
before import. A version mismatch stops that connection and keeps saved data. Other paired computers
can still sync.

The iOS offline action queue rotates the committed file to a backup before it replaces the file.
Reads wait for writes and use the backup if a replacement did not finish. Empty queues use the same
commit path. A successful clear cannot restore old actions from a backup. These checks use the
native file API contract with injected failures; they do not simulate a physical power loss.

The runtime records a message ID and a draft text hash when a user send consumes its draft. Later
draft edits, including an explicit empty draft, clear that marker. Reconciliation uses this proof to
keep text typed just after a send. Old matching conversation text does not prove consumption. If the
proof is absent, Studio keeps the host draft and retains a competing edit for recovery.

Mobile detail forms keep up to 40 drafts per form type in memory. The cache removes clean entries
first. At capacity, it keeps unsaved text and allows edits to existing drafts. It blocks edits to a
new item and shows **Draft limit reached**. Save or discard an existing draft of that type, then
edit the new item. These drafts do not survive an app process exit.

Browser profile forms retain edited fields when another window or computer changes the saved
profile. Untouched fields use the new saved values. Unsaved profile changes and saves in progress
use the settings navigation guard. Remote profile saves check the catalog version that the form
read. If another client changes that catalog, select **Refresh**, review the retained edits, then
save again. Reads and saves share one queue. A delayed read cannot replace an acknowledged save.
Re-pairing starts a separate catalog. These server conflict checks require the updated runtime.
Older clients can still use its existing profile API.

The runtime confirms a profile save even if an open browser or saved cookie file cannot apply the
change. Settings shows **Profiles are saved** with the apply error. Select **Retry browser
settings** to apply the saved catalog again. A retry does not replace the catalog or repeat the
save. Apply attempts run in order and wait for all browser and file operations before the next
attempt starts.

Desktop attachment uploads capture a draft guard before image editing or file reads. The runtime
checks that guard in the transaction that attaches the file. A send or draft change from another
client rejects the upload. The file does not move into the next draft. Review the draft and attach
the file again. A batch uses the guard returned by each committed file. Queued-message and question
attachments retain their existing destination rules. Direct uploads require an updated runtime;
older runtimes show an update message before the upload starts.

Desktop file edits remain in memory until saved. Closing, reloading, quitting, or installing an
update checks for unsafe edits. Select **Keep editing**, then save or download the edited file.
Select **Discard changes** to leave without saving. Cancelling Quit keeps the runtime available for
saving. Failed update preparation reopens Studio. These guards do not recover edits after a process
crash or power loss. Code references use the text currently shown in the editor, including a draft
whose save failed.

## Terminal clipboard

On desktop, select terminal output, then use **Copy** in the context menu, **Cmd+C**, or
**Ctrl+Shift+C**. **Ctrl+C** copies when text is selected and retains the terminal interrupt
behavior when there is no selection. Electron uses its native clipboard bridge. **Cmd+V**,
**Ctrl+Shift+V**, **Shift+Insert**, and the context menu paste through that bridge. A pending paste
is cancelled if its terminal scope changes or input becomes unavailable. Web clients retain system
paste events. HTTP LAN and VPN connections remain supported.

On iOS, long press output to select text, then use **Copy** in the terminal toolbar or the system
selection menu. The toolbar reports whether it copied a selection. **Paste** uses the native
terminal clipboard action. The controls require a new native mobile build with the updated
`expo-libghostty` patch. An OTA JavaScript update alone cannot add these native methods. Older
binaries retain the existing system selection menu. Retained native terminal output supports
selection and **Copy** while disconnected or replaying. **Paste**, keyboard controls, and forwarded
terminal input still require input readiness.

Standalone mobile terminal screens keep a loaded terminal mounted during a temporary disconnect or
while another screen covers it. Copy remains available for retained output. Re-pairing or changing
the terminal clears that retained view. A session opened while offline must connect once before it
can show output.

Mobile Markdown code blocks have a **Wrap** control. Select it to read long lines within the
conversation width. Select **Scroll** to restore horizontal scrolling. Horizontal mode uses
direction locking. Both modes retain tabs and line endings in selectable code.

## Replicated threads and the unified list

Search includes the full stored history of replicated threads, including messages outside the loaded
conversation tail. Per-thread results support pagination. The search index is derived from the
stored replication records and builds once for existing data. Message changes update it in the same
database transaction.

Runtime diagnostics show replication channel errors, peer errors, and the last successful sync since
startup. Task execution readiness remains separate from replication health. Sync retries use the
existing pairings. Summary reads reuse their projection until committed metadata changes.
Message-only updates do not rebuild the summaries.

The mobile unified list uses the shared thread tree. Delegated local and remote subthreads appear
under their parent. Search can find a child through its parent. Child input requests reach the
parent's **Needs input** section. Project and computer filters keep the parent as context. Subagents
stay behind its icon. An archived parent remains as context when it has a visible child. Desktop
Unified uses the same preferred-copy rules as Threads. A connected original wins over its replicas.
A connected replica can replace an offline original. One logical thread has one main row. Equal
copies use a stable computer ID to break ties. Their order in the fleet does not change the selected
row.

Older thread decoders dropped `parent` without changing the version ID. Updated clients and runtimes
repair that specific omission when another paired copy has the complete version. All other data and
the version ID must match. The repair commits in the same transaction as its receive receipt. It
keeps journal sequence numbers, runtime identities, pairings, history and drafts. It also updates
stored summaries. A replay from an old client cannot remove a restored parent link.

An active sender resends retained history after a committed repair, even if its peer already
acknowledged every journal entry. A receiver that detects an incomplete copy returns its retained
complete history. Clients drain these replay pages with the page cursor, even when a saved receipt
is already further ahead. A repair generation commits with the repaired values. Peers replay a
missed generation from sequence zero, including after the sender reopens. Older peers without repair
receipts receive one bounded replay per connection. Idle connections do not repeat it. Receipts and
version counts do not need a reset.

If an older peer rejects the damaged outgoing record before it returns its complete copy, the
updated client pulls the peer's retained history, then tries the push again. This replay includes
pages that were already acknowledged. It uses the existing reconnect backoff if the error remains.
One open journal keeps a recovery budget for each paired peer. Dropping and recreating a connection
does not repeat a failed full recovery. Retry permits another attempt. A new repair also permits
another attempt. It does not reset storage or pairings. Different parent links and other data
conflicts remain visible. Automatic recovery does not choose between competing user edits.

App journals opt into actor recovery after a file or device restore. A peer must prove that the
retained actor went backwards or reused a sequence. The app then commits one fresh journal actor and
replays its retained versions. Version IDs, history, checkpoints and paired runtime identities stay
intact. Pairing tokens stay in their existing storage. True immutable-value conflicts remain
visible. The app does not choose between different user edits.

Thread catch-up publishes one settled UI refresh after its batches complete. Receipt-only changes do
not trigger another content exchange or refresh. A failed background snapshot read keeps a healthy
live stream connected. Confirmed authentication failures still report a disconnected state. These
rules prevent temporary read failures from switching rows between owners and replicas.

Parent links and monitor facts use the selected copy's row key. A child remains under its parent
when the parent, the child, or both use replicas on other computers. Opening the row uses the
computer that holds the selected copy.

## Verification

Install the managed browser before running browser checks:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm --filter @dovo/runtime... --filter @dovo/api... -r build
pnpm --filter @dovo/desktop build
pnpm exec vp test packages/studio-core/src/preferences.test.ts apps/mobile/src/runtime/state/detail-drafts.test.ts packages/extension-tasks/src/list/thread-tree.test.ts packages/runtime/src/storage/thread-replication-journal.test.ts packages/runtime/src/storage/thread-replication.test.ts packages/runtime/src/http/diagnostics.test.ts packages/runtime/src/http/browser.test.ts packages/runtime/src/previews/browser-do-not-track.test.ts packages/runtime/src/previews/browser-session-cookies.test.ts apps/desktop/electron/main.test.ts
pnpm exec vp test packages/extension-tasks/src/list/task-collection.test.ts apps/mobile/src/tasks/list/task-list-projection.test.ts apps/mobile/src/workspace/workspace-items.test.ts
pnpm exec vp test packages/durable-connections/src apps/mobile/src/runtime/connection/mutation-storage.test.ts packages/protocol/src/runtime/connection/shared-state-sync.test.ts packages/protocol/src/runtime/connection/shared-state-values.test.ts packages/protocol/src/runtime/connection/workspace-reconciliation.test.ts packages/runtime/src/storage/workspace.test.ts packages/runtime/src/agents/tasks/task-queue.test.ts
pnpm test:durable-connections:browser
pnpm test:preference-storage:browser
pnpm test:file-drafts:browser
pnpm test:browser-profile-settings:browser
node scripts/check-image-attachments-browser.mjs
node scripts/check-question-attachments-browser.mjs
node scripts/check-mobile-native-terminal-browser.mjs
pnpm test:terminal-engine:browser
pnpm test:code-review:browser
pnpm test:mobile-workspaces:browser
node scripts/check-mobile-task-list-rendering-browser.mjs
pnpm test:unified-workspace:browser
```

Run `pnpm test:file-drafts:native` in a graphical desktop session. On headless Linux, use
`xvfb-run -a pnpm test:file-drafts:native`. This runs real Electron unload events with a scripted
prompt choice. Browser fixtures use native adapters for mobile components. They do not establish
physical iOS gesture, selection, keyboard, or clipboard behavior. Verify those on a rebuilt iOS app.

The runtime browser checks on the Linux review host used Playwright's managed Chromium with a
temporary test launcher that set `chromiumSandbox: false`. This host could not start sandboxed
Chromium. Those checks verify live profile headers and cookie recovery. They do not verify the
Chromium sandbox. Production launch settings still enable it.

A local CPU benchmark with 2,000 replica summaries measured a median of 0.014 ms for a summary read
after an unrelated local message update. The previous implementation measured 24.3 ms for the same
workload. This excludes message writes, screen rendering, network traffic, and the first projection
after a metadata change.

The app journal string adapter reuses encoded text for immutable retained entries. A local CPU
benchmark with 5,000 messages (9.77 MiB of message text) measured a median metadata edit of 6.1 ms,
compared with 37.1 ms before this change. This excludes device disk I/O, networking and UI
rendering.
