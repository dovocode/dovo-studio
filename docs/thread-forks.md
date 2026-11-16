# Fork a thread from a message

Use a fork to try another direction from an earlier point in a conversation. The source thread stays
unchanged.

## Start a fork

1. Open the thread.
2. On desktop or web, point to a message. On iPhone, tap the message.
3. Select **Fork conversation**.
4. Read the confirmation and select **Fork**.

Dovo opens the new thread. Its title starts with "Fork:". Type the next message to start it.

Agent replies also have **Fork with files from this turn**. **Fork conversation** copies only the
conversation and does not rewind files. **Fork with files from this turn** copies the conversation
up to that reply. If that turn saved a file snapshot, the new thread gets its own worktree with the
files as they were after that turn.

You can fork user messages and assistant replies. The action is not available while the turn of that
message runs. Earlier settled messages stay available. Review comments cannot start a fork.

## What the fork contains

- The conversation up to and including the selected message. Attachments are copied.
- The harness, model and access settings of the source thread.
- A link to the source. Select **Forked from <thread title>** to open the source thread. On desktop
  and web, the link is in the thread header of a wide window, and Dovo scrolls to the selected
  message. On iPhone, the link is above the conversation and opens the source thread.

The fork does not contain later messages, turn records, queued messages, the draft, the checklist or
linked projects. It starts as a draft and has no provider session.

Both fork actions give the new thread its own copy of each attachment. The fork keeps its files when
you delete the source thread. A thread forked with files by an older Dovo version can still refer to
the files of its source thread. Dovo copies those files from the thread that stores them. If a file
is no longer stored, the fork keeps the message without that file.

## Files are not rewound

A fork does not restore files to the state of the selected message. The fork uses the checkout
setting for new threads in that project. If the project starts new threads in a worktree, the fork
gets its own new worktree when it first runs. If the project uses the local checkout, the fork works
on the current files in that checkout. Dovo does not change files in the source checkout when it
creates a fork.

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
only when the connected runtime has this flag. With an older runtime, agent replies show only **Fork
with files from this turn**.

The runtime endpoint is `POST /api/tasks/fork-message` with `id`, `messageId` and a client-chosen
`forkId`. A retry with the same `forkId` returns the same thread.

## Verification

Run the focused checks:

```sh
pnpm exec vp test packages/runtime/src/http/message-fork.test.ts packages/protocol/src/tasks/task-fork.test.ts
pnpm --filter @dovo/protocol --filter @dovo/runtime --filter @dovo/extension-tasks --filter @dovo/mobile typecheck
```

Run the client controls in managed Chromium:

```sh
pnpm exec playwright install chromium
pnpm --filter @dovo/protocol build
pnpm test:message-fork:browser
```

The runtime test uses a real local HTTP runtime, SQLite, Git and attachment storage. Provider
execution uses a test adapter. The browser check renders the desktop and mobile message actions with
native view stubs. These checks do not establish physical iPhone behavior or a real provider login.
