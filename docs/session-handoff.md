# Move a task to another computer

Pair both computers with the same Dovo client. Add the same Git project on the destination, fetch
the source commit there, and configure an agent with the same provider and model. Each computer uses
its own provider authentication and tool configuration.

1. Finish the current turn, commit or stash changes, and close task terminals. Finish queued,
   scheduled or delegated work and pending questions first.
2. Open the task actions menu and choose **Move to computer**. On desktop/web this is in the
   ellipsis menu; on mobile it is in the header overflow menu.
3. Choose the computer, matching project and agent. **Preserve native session** transfers
   experimental Codex/Claude context and requires identical CLI versions. **Conversation replay**
   explicitly starts a new session using the visible conversation; tool history and compacted
   context may be lost.
4. Choose **Move task**. Dovo stages a new worktree at the exact commit, makes the source read-only,
   activates the destination and opens it. Send the next prompt when ready.

If a connection drops, reopen **Complete move** and choose **Retry move**. Transfer IDs and progress
persist on the servers. **Cancel move** is available before the source commits the move; it requires
both computers to acknowledge cancellation. After that point, reconnect and finish activation. Never
unlock a sealed source by timeout: the destination may already be active.

Source history stays readable. Moving back creates another handoff. Attachments and artifact
revisions get independent destination IDs. Historical Git checkpoints are not restorable, ignored
files and installed dependencies are not copied, and normal destination worktree setup runs on the
next turn. Pull-request/work-item tasks, linked projects, child task families, submodules and LFS
projects are not supported in this first slice.

HTTP over LAN, Tailscale and NetBird remains supported; HTTPS is optional. Existing pairing codes
and device tokens are required. No account service or provider credentials are transferred.

See the [design and compatibility notes](design/session-handoff.md) for recovery details,
verification evidence and remaining native-provider limits.
