# Continue elsewhere

Open a thread menu and select **Continue elsewhere…** on desktop or mobile.

To switch harnesses in place, select another harness from the thread's existing model picker. Dovo
saves a checkpoint and switches the same thread. The next message starts the new provider session
with the saved conversation. While a turn runs, use the composer model controls and select **Stop
and switch harness**. Dovo does not stop a turn from the picker alone. Model changes within the
current harness keep their existing behavior.

The conversation shows a divider where the harness changes. When a switch finishes, the divider
appears after the last message. The next request appears below it. Older turns show a divider where
the recorded providers differ.

The thread header shows icons for the harness and computer. On desktop and web, hover or focus each
icon to see its name. On mobile, open **Thread actions** to see both names.

Inline switches preserve the draft and earlier turns. Send or remove queued messages first. Clear
draft turn overrides with **Use thread defaults** before switching. Runtime restrictions, such as
active terminals and imported or child threads, still apply. Older runtimes keep the provider
locked. If a reply is lost, select **Retry harness switch** to reuse the same request and saved
receipt.

- **Another harness on this computer** starts a fresh provider session in the same thread. Select
  the harness, model and access settings. The conversation, checklist, draft, attachments and
  checkout stay in place. Earlier turns keep their original provider.
- **Another computer** moves the thread and its checkout to a paired computer. Review the
  destination and file selection. The destination uses its own default harness, with permissions
  limited to the source policy. Change the model there before the next message if needed.

Let the active turn finish, or select **Stop the current turn first**. A stop request must finish
before Dovo captures the checkpoint. Finish or remove queued messages first. Close thread terminals
and wait for active jobs. For an unsent draft, use its existing harness and computer settings.

Both computers need a version with thread handoff support. Pairing codes and device tokens remain
required. Direct transfers support HTTP or HTTPS over LAN and VPN, including Tailscale and NetBird.
Use the existing SSH transfer option when direct HTTP is unavailable.

## What moves

Computer handoffs carry the saved conversation, turn records, shared checklist, unsent draft, plan
flag and attachment bytes. Attachment IDs are new on the destination. Git transfers carry the
current branch, local commits, staged changes, unstaged changes and untracked files. Ignored or
private files move only when you select them. The file picker lists skipped links; symbolic links do
not move. Git submodules require a separate copy.

Provider authentication, credentials, native sessions, live tool state and background processes do
not move. Earlier Git undo checkpoints remain on the source. Destination turns create new
checkpoints.

The saved conversation stays complete. The first provider turn uses the existing bounded history
replay. It keeps the original request, latest request, unfinished input and recent history. Selected
messages keep their full text, order and role. Dovo shows an omission notice when older messages do
not fit. The agent can read the saved thread through its thread tools. If required input does not
fit, the turn fails with a clear error; Dovo does not shorten or replace the stored conversation.

## Ownership and recovery

Dovo blocks new source input before it copies the thread. The source block and the saved transfer
request commit in one transaction, so a blocked source always has a move to retry or cancel. At
startup, Dovo releases a source block that has no saved request. Older runtimes could leave one
after a failed write. Nothing reached a destination in that case.

Dovo verifies file sizes and SHA-256 hashes, then saves a hidden destination thread and receipt in
one transaction. The source records that it moved before Dovo enables the destination. The
destination does not run automatically. Send the next message when ready.

The source stays settled and read-only for recovery. Its files stay on the source computer. Open the
destination from the transfer panel or source notice.

If a reply is lost or a computer restarts, the source stays blocked. Select **Retry move** to check
the saved destination receipt and finish activation. Retrying the same transfer does not create
another thread or checkout. A moved source with a failed job can still need this last activation
step.

Cancel releases the source only after the destination confirms that it has no committed thread. If
the destination already committed the thread, Dovo finishes the handoff. If the destination is
offline, the source stays saved and blocked until the result can be checked. Do not remove its
transfer record to bypass this check.

If you delete the hidden staged destination before activation, Dovo keeps a durable discard receipt.
Retry or cancel the move on the source to restore source input. Start a new move to try again.
Deleting an activated destination does not restore execution on the source. Dovo retains the
activation record, so a lost activation reply can still finish after destination deletion.

### Backup restore

The source keeps a durable record of each completed move. The record stays after you delete the
source thread. The task's own move state only shows these records. At startup, Dovo makes each task
match them before any thread can run:

- A recorded move makes its thread read-only, and replaces an older move from a backup.
- A thread that shows a move without a record had its ownership returned. Dovo releases it.

When a discarded staged destination returns ownership, Dovo removes the record together with the
source block. A database from before these records gets them once, from its moved threads.

A restore treats the current database as the latest decision. It replaces the backup's move records
and transfer jobs with the current ones. On a destination, it keeps a current activation for a
staged thread in the backup, and a current discard. Examples:

- The source restores a backup from before a move. The thread stays read-only, offline and after it
  reconnects. Retry the move to check the destination again.
- The source restores a backup from move 1 after move 1 returned and move 2 completed. The thread
  shows move 2.
- The destination restores a backup from before activation. The thread is active again.
- The destination restores a backup from before a discard. The staged thread never activates. You
  can delete it.

Restore keeps these decisions only when the current database and the backup have the same runtime
identity. A destination backup from before the move does not contain the thread; inspect the
pre-restore copy to recover it.

The source retains its Git recovery snapshot at `refs/dovo/handoffs/<handoff-id>`. The saved handoff
also records the checkpoint. Dovo does not reset the source checkout during a move or recovery.

Imported native sessions, side threads and delegated child threads keep their current execution.
Computer moves also require an independent thread without linked checkouts, PR ownership or
work-item ownership. Dovo reports these cases before the move. Plain-folder threads can move their
files; projectless threads have no project checkout to transfer.

## Verification

Run the focused runtime checks:

```sh
pnpm exec vp test packages/runtime/src/http/thread-handoff.test.ts packages/runtime/src/scm/repositories/project-transfers.test.ts packages/runtime/src/http/task-machine.test.ts packages/protocol/src/tasks/task-provider.test.ts --maxWorkers=4
pnpm --filter @dovo/protocol --filter @dovo/runtime typecheck
```

Run the transfer controls in managed Chromium:

```sh
pnpm exec playwright install chromium
pnpm --filter @dovo/protocol build
node scripts/check-project-transfer-browser.mjs
node scripts/check-thread-handoff-browser.mjs
node scripts/check-inline-harness-handoff-browser.mjs
```

The runtime tests use two real local HTTP runtimes, SQLite, Git and attachment storage. Provider
execution uses a test adapter. Browser checks render desktop components and mobile components with
native view stubs. These checks do not establish physical iPhone behavior, a real cross-provider
login, or transfer behavior over a real remote network.
