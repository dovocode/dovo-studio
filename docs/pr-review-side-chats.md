# PR review and agent side chats

PR review should let you move from a finding to an agent conversation without losing the revision,
file or line range you were reviewing. Agent side chats use ordinary Studio threads: they have model
settings, tools, approvals, cancellation and saved conversation history.

## Workflow

Open **Side chats** from a thread to create or revisit an agent side chat. Creating one prepares an
editable draft; it does not start a model run. The parent keeps its existing lifecycle state. The
side chat inherits the parent's agent settings, with permissions capped by the parent's policy.
Model settings can be changed through the normal composer.

Git side chats each get an independent primary worktree. General side chats get a separate thread
directory and conversation; they do not copy local files from the parent. If the parent is idle, the
starting snapshot includes its uncommitted files. If it is running, the side chat starts from
committed files and stable completed conversation context. The UI identifies that difference. Linked
checkouts are read-only in the child so they cannot introduce shared writes into the parent. Side
chats cannot create nested side chats.

Use **Bring back** after a completed reply. The parent must be available, idle and have an empty
queue. Settled parents stay settled. The result is added to the parent's editable draft and can be
reviewed before sending. Existing draft text is preserved. Bring-back records its completed source
boundary, so retrying the same result does not append it again. Mobile also records delivery in its
local draft store, including across restarts and failed saves.

Each new delivery includes the completed conversation since the previous delivery, with user and
assistant attribution. The transfer is bounded; omitted content and attachment names are identified.
Approvals and questions appear on the parent and side-chat list, with a link to the child's normal
controls. Unused side-chat drafts stay in that list and can be discarded explicitly.

Bring-back transfers conversation context. It does not merge or cherry-pick code. Changes remain in
the side chat's worktree until explicitly integrated. Both conversations retain their normal stop,
archive and delete controls. Existing read-only conversations remain under **Previous Q&A chats**.

For Git side chats, **Review changes** compares the child's files against its creation snapshot,
including committed, dirty and untracked changes. Inherited parent edits are excluded. File previews
use pinned comparison snapshots; refreshing the comparison preserves the selected file. A running
child must finish before creating a review snapshot. This review offers no automatic apply action.
Desktop remembers the side chat paired with each parent within the selected connection.

## PR context

**Ask agent** carries the displayed PR URL, title, head/base commits, selected file and optional
line range. Relevant discussion and patch excerpts are bounded and identified as external data.
Context is a snapshot: the agent must verify its checkout before editing. Creating an agent draft
does not publish a forge comment, approve a review or merge the PR.

Choose a linked conversation explicitly, or start a new review thread using the existing PR checkout
workflow. A matching branch or PR URL never silently chooses another computer or account. Existing
section loading, source verification, review progress and provider capability checks continue to
apply.

Repeated generated context replaces an unchanged prior contribution instead of duplicating it.
Edited contributions remain intact. If the same PR receives a push, **Use latest revision**
preserves the question and clears stale line selections. A different account or source requires
reopening.

## Refresh behavior

Opening a PR, activating a section, reconnecting, or returning to the app requests a fresh read from
its selected source. Existing content stays mounted during background refresh. Repeated cache labels
and fetch timestamps are omitted; connection problems and failed reads remain visible. Cached
content remains an offline fallback, and writes still require a verified current source. Status and
checks refresh every five seconds while open. Live runtime reads share provider requests and await
revalidation when their ten-second cache window expires. Pinned diffs remain stable until the user
switches revisions.

## Reference and implementation choices

This work compared T3 Code at
[`15fe2832727893cbdd2214383f9f971474849695`](https://github.com/pingdotgg/t3code/tree/15fe2832727893cbdd2214383f9f971474849695).
Its
[side-chat pane](https://github.com/pingdotgg/t3code/blob/15fe2832727893cbdd2214383f9f971474849695/apps/web/src/components/chat/SideChatPane.tsx)
uses the normal chat renderer; its
[fork service](https://github.com/pingdotgg/t3code/blob/15fe2832727893cbdd2214383f9f971474849695/apps/server/src/orchestration-v2/ThreadForkService.ts)
creates supervised side threads sharing the parent's checkout. Its
[PR context builders](https://github.com/pingdotgg/t3code/blob/15fe2832727893cbdd2214383f9f971474849695/apps/web/src/components/pullRequest/pullRequestDetail.logic.ts)
retain review locations and bound external text.

Dovo reuses its task execution, fork snapshots, PR section reads and normal chat controls.
Independent worktrees prevent simultaneous agents from editing the same primary checkout. Portable
conversation context works across harnesses; this does not claim native provider-session forking or
complete feature parity with T3 Code.
