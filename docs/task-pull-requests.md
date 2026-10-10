# Thread pull requests

## Experimental PR feedback watcher

Enable **PR feedback watcher (experimental)** under a computer’s **Pull requests & pipelines**
settings (desktop: Settings → Tasks & projects → Pull requests & pipelines; mobile: the computer
settings). It is disabled by default. The flag is saved on the runtime and shared by connected
devices.

With the flag enabled, writable harness sessions receive `dovo_task pull_request_watch`:

- `action: "watch", url: "https://github.com/owner/repo/pull/123"` registers the thread’s PR and
  returns any currently failed checks. A thread has one watch; choosing another PR replaces it.
- `action: "status"` returns the current watch and any refresh error.
- `action: "stop"` stops the watch.

Registration verifies the URL against the project’s configured forge and records existing comments
as its baseline. Dovo then checks every two minutes, reusing credential-scoped caches and the
existing GitHub rate limiter. GitHub feedback reads skip diffs, review-thread metadata, repository
settings and check annotations; other configured forges use their existing detail adapters. New
conversation comments, submitted reviews, inline comments and newly failing checks are queued as
external feedback in the same thread. An idle thread wakes through its normal message queue; an
active turn finishes before handling that feedback. Long comments are sent as excerpts with links.
Large batches drain over subsequent polls. Successful or pending checks do not wake the agent.

Watches and delivery cursors survive turns and runtime restarts. Re-registering the same active
watch preserves its cursor. Queue admission and cursor updates commit together, preventing duplicate
deliveries after a restart. Failed reads retain progress and show an error in watch status; stale or
unavailable sections cannot generate notifications. Cache refreshes can add one polling interval to
delivery latency.

Paused queues remain paused, and read-only threads are not awakened. Finished threads with active
watches move into **Waiting**. New actionable feedback revives them through the normal message
queue. Settling or archiving removes their watches; restoring a thread does not restore a watch.
Disabling the feature pauses existing watches and rejects calls from older harness sessions;
enabling it again resumes them. A watch ends when the PR closes or merges, or is stopped explicitly.
Changing the thread’s project stops the watch. Deleted threads’ watch records are cleaned up by the
watcher. Agents are instructed to use this tool for requested ongoing monitoring and finish their
turn, rather than keeping their own polling loop alive. Creating a PR alone does not start a watch.

## Linking and lifecycle

Each computer has **Smart PR linking** and **Settle when the PR closes** options in its task
settings, available on desktop and mobile. Smart linking is enabled by default; auto-settle is off.

Smart linking finds the thread's branch PR and verifies full PR URLs mentioned in user or agent
messages against the project's configured forge. It adds informational links without changing the
checkout. Unlinking a PR suppresses automatic re-linking; linking it manually again clears that
suppression. The background watcher checks every two minutes. Extra PR links are available in the
desktop PR menu and mobile's expandable **Linked PRs** list.

Auto-settle follows the source PR or the PR matching the thread's checkout branch. Closing a
mentioned auxiliary PR cannot settle the thread. A freshly verified merged or closed main PR moves
an idle thread to **Settled**, retaining its history and worktree. Pinned threads, active turns,
approvals/questions, open terminals, queued or scheduled messages, and unsent drafts stay put.
Unlinked PRs do not trigger automatic settlement. Forge errors and stale status cannot settle a
thread.

The existing auto-archive option remains separate. If enabled too, it archives the thread instead of
just settling it. Settling alone does not set the archive timestamp or trigger archived-worktree
cleanup. Either action can be undone through the existing thread lifecycle controls.

GitHub background monitoring reads PR metadata and check summaries rather than the full review, diff
and check annotations. List/status reads share a two-minute cache; full review details share a
five-minute cache. Worktrees using the same repository and account reuse these entries. Manual
refresh and PR actions still request or invalidate current data. Already-linked message URLs are not
repeatedly loaded, and settled closed threads stop polling unless the archive-on-close option still
needs to archive them. Closing a PR is verified online before an eligible thread is settled or
archived.

GitHub CLI requests are limited to four concurrent requests per credential/host. If GitHub reports
exhausted quota, requests pause until its reported reset; secondary limits use a cooldown with
increasing backoff. Refresh cannot bypass this pause. A primary-limit failure makes one quota lookup
to learn the reset time, with a conservative fallback if unavailable. Other applications and Dovo
servers using the same GitHub account share GitHub's quota; the local limiter does not coordinate
different machines.

## Stacked pull requests

Desktop and mobile show a stack icon and position when an open PR targets the head branch of a
unique open parent PR in the same repository. PR details show the dependency tree and let you open
other members. Fork-qualified branches remain distinct; ambiguous parents and cycles are excluded.
The overview and detail views reuse up to ten pages of cached open PRs. Incomplete or stale catalogs
are explicitly marked as partial. Thread indicators use the background watcher's available catalog.

**Stack a PR** opens creation with the parent branch selected. You can also choose a parent in the
creation form. Submission verifies that the parent is still open and its head commit and branch have
not changed, then adds a parent link to the new PR description. The source branch must already
exist; this action does not create commits or branches.

**Ask agent to update stack** refreshes dependencies and opens an editable thread draft. After you
choose an agent and send it, the agent is instructed to restack parent-first, retarget children of
merged parents, run checks and update PRs. The instructions preserve local work, stop on conflicts,
require explicit remote-tip leases for rewritten branches and prohibit merging or closing PRs. Dovo
does not automatically rewrite branches when the button is clicked.

## Experimental pipeline watching

Enable **Pipeline watcher (experimental)** in the computer’s runtime settings on desktop/web or
mobile. This is independent of PR feedback watching and off by default. Writable agents then have
`dovo_task pipeline_watch` beside `pull_request_watch` when both features are enabled.

Use `action: watch` with `runIds` containing one or more provider run IDs from the thread’s project.
Dovo uses that project’s configured forge and account. Registration adds runs without replacing
existing watches, accepts at most 20 active runs per thread, and returns current run details.
Already-finished runs are returned immediately without queuing another message. Re-registering an
active run preserves its watch. This watches explicit runs only, never a branch or future runs.

Every two minutes, the runtime checks watched runs using the existing forge adapters and caches.
When a run fails or finishes with an actionable warning, Dovo queues its result once in the same
thread, with available job context and links. Successful, skipped and cancelled runs finish
silently. Completion and queue admission commit together. Watches survive turns and runtime
restarts. Unavailable or stale reads retain progress and expose an error in status. Agents should
finish their turn after registration instead of keeping a polling loop alive.

Use `action: status` or `action: stop` with optional `runIds` to select runs; omit them to select
all watches. Finished threads with active watches move into **Waiting** on desktop/web and mobile.
Failed runs revive them; success leaves Waiting only when no active watches remain. Paused queues
remain paused, and read-only threads are not awakened. Settling or archiving removes both PR and
pipeline watches; restoring a thread does not resume them. Disabling the feature pauses existing
watches and rejects calls from older sessions; re-enabling resumes monitoring. Changing the thread’s
project stops its watches; deleting the thread removes its watch records. Provider content is
external data and does not override thread instructions.
