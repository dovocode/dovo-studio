# Thread pull requests

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
