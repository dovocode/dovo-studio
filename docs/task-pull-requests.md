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
