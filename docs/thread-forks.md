# Fork a thread from a message

Use a fork to try another direction from an earlier point in a conversation. The source thread stays
unchanged.

## Start a fork

1. Open the thread.
2. On desktop or web, point to a message. On iPhone, tap the message.
3. Select **Fork conversation**.
4. Check the selected message and the file source in the confirmation. Select **Fork**.

Dovo opens the new thread at the copied message when the reply link is available. Its title starts
with "Fork:". Type the next message to start it.

On desktop and web, if another thread or view is open when a fork finishes, Dovo keeps it open. Open
the saved fork from the thread list. This also applies when you select **Fork** in the composer's
**More message actions** menu to send a draft in a new thread.

Agent replies also have a turn fork. Choose **Fork with files from this turn** if the turn has a
saved file snapshot. Otherwise, choose **Fork from this reply**. Both actions copy the conversation
up to and including the selected reply. The confirmation shows the reply and the files the fork will
use.

You can fork user messages and assistant replies. The action is not available while the turn of that
message runs. Earlier settled messages stay available. Review comments cannot start a fork.

## What the fork contains

- The conversation up to and including the selected message. Attachments are copied.
- The harness, model and access settings of the source thread.
- A link to the source. Select **Forked from <thread title>** to open the source thread at the
  selected message when Dovo has its link. Look in the thread header on desktop and web or above the
  conversation on iPhone.

The fork does not contain later messages, turn records, queued messages, the draft or the checklist.
A turn fork keeps the linked project settings. A conversation fork does not. The new thread starts
as a draft and has no provider session.

Both fork actions give the new thread its own copy of each attachment. The fork keeps its files when
you delete the source thread. A thread forked with files by an older Dovo version can still refer to
the files of its source thread. Dovo copies those files from the thread that stores them. If a file
is no longer stored, the fork keeps the message without that file.

## Which files the fork uses

- **Fork conversation** uses the project's checkout setting for new threads. It does not restore a
  snapshot.
- **Fork with files from this turn** uses the saved snapshot of the primary project in a new
  worktree. It does not restore snapshots for linked projects.
- **Fork from this reply** uses the source thread's checkout mode without a snapshot. In worktree
  mode, Dovo starts a new worktree from a Git commit. It does not copy uncommitted source changes.
  In local mode, the fork uses the project checkout's current files. A General thread starts with
  its own empty scratch workspace.

Dovo does not change files in the source checkout when it creates a fork.

**New thread in this worktree** starts an empty conversation in the existing checkout. **Fork
worktree** starts an empty conversation in a new checkout with a snapshot of the source files. If
the source thread or checkout changes while Dovo prepares the draft, Dovo asks you to try again.
This includes a Git commit made while **Fork worktree** takes its snapshot. If you imported a
session that ran in a subfolder, **New thread in this worktree** opens the new thread at the root of
the registered worktree.

On mobile, if the reply to a composer fork is lost, Dovo can retry the same fork when you reopen its
thread. Any draft you edited while waiting stays in the source thread, even if you typed the
original wording again.

## How the agent receives the history

The fork has no provider session. Its first turn starts a fresh session and sends the copied
conversation through the same bounded history replay that **Continue elsewhere** uses. If a long
conversation does not fit, Dovo keeps the first request, the latest requests and recent history, and
adds an omission notice. The saved conversation in the fork stays complete. See
[Continue elsewhere](thread-handoffs.md) for the replay limits.

Dovo uses this transcript path for all providers. It does not use native session forks from Claude
or Codex. Those forks start from positions in the provider session, and Dovo messages do not map to
those positions in the same way for every provider.

## When Dovo refuses a fork

Dovo explains the reason. The rules match **Continue elsewhere**:

- Bots keep one conversation. Use **Reset context to here** instead.
- Delegated child threads and side threads stay with their parent thread. Fork the parent thread.
- Imported Codex or Pi sessions stay with their original native session.
- A thread in a computer transfer must finish the transfer first.
- A replicated thread from another computer must be forked on that computer.

## Compatibility

The runtime advertises `messageForkSupported` in its snapshot. Clients show **Fork conversation**
only when the connected runtime has this flag. With an older runtime, agent replies still have the
turn fork. If the runtime does not return a reply link, Dovo opens the new thread without scrolling
to a message. The source link also opens the thread without scrolling if the fork has no saved
message ID.

The runtime endpoint is `POST /api/tasks/fork-message` with `id`, `messageId` and a client-chosen
`forkId`. A retry with the same `forkId` returns the same thread.

`POST /api/tasks/fork` takes `id` and `turnId`. New runtimes return the starting `messageId` and
store it with the fork's source reference. Clients also accept older responses with only `id`.

## Verification

Run the focused checks:

```sh
pnpm exec vp test run packages/runtime/src/http/message-fork.test.ts packages/runtime/src/agents/tasks/quality-of-life.test.ts packages/protocol/src/tasks/task-fork.test.ts packages/extension-tasks/src/chat/actions/fork-navigation.test.ts
pnpm --filter @dovo/protocol --filter @dovo/runtime --filter @dovo/extension-tasks --filter @dovo/mobile typecheck
```

Run the client controls in managed Chromium:

```sh
pnpm exec playwright install chromium
pnpm --filter @dovo/protocol build
pnpm test:message-fork:browser
node --test scripts/browser/composer-fork-navigation.test.mjs
```

The runtime test uses a real local HTTP runtime, SQLite, Git and attachment storage. Provider
execution uses a test adapter. The browser check renders the desktop and mobile message actions with
native view stubs. The composer test delays a stub runtime reply until after the selection changes.
These checks do not establish physical iPhone behavior or a real provider login.
