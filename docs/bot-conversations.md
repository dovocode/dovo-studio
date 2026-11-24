# Bot conversations

Select **Agent & model** in the composer, or open **Harness, model and tool permissions** in Bot
settings, to change the harness. Available providers belong to the Bot's computer. A fresh Bot
conversation can change providers even when it retains the previous conversation's provider lock.

An idle Bot switches to a fresh provider session. Its current conversation stays in the thread and
is supplied to the next harness. Its name, memory, routines, permissions and draft stay saved. An
active Bot saves the change for the next turn on runtimes that support pending Bot changes. The
current turn continues with its existing harness. Close terminals and finish child work before an
immediate switch. A pending selection can be cancelled in the model controls.

Use **Archive and start new** above a Bot conversation. Confirm the action to save the current
conversation as a child under the same Bot. Open **Side threads** to read or rename saved
conversations.

The Bot keeps its name, settings, permissions, memory, routines and unsent draft. The next message
starts a new model session with no messages from the saved conversation. The Bot can still use facts
you asked it to save in memory. The earlier messages are available under **Side threads**, marked
**Saved Bot conversation**. Files on the computer stay in place.

Finish active work and clear queued messages first. If another device changes the conversation
before confirmation, review the conversation and try again. Retrying a completed request does not
archive newer messages.

Use **Rename thread** in desktop child rows or **Rename** in mobile child rows. Dovo saves the name
on the child's owning computer. This works for side chats, saved Bot conversations and Dovo worker
threads. Provider-owned native agents keep their provider names.

The runtime advertises `botConversationArchiveSupported`. Older runtimes disable the new
conversation action until updated. The human-only endpoint is `POST /api/bots/archive-conversation`.
Its body contains `id`, `expectedRevision` and `expectedLastMessageId`.

Verify from the repository root:

```sh
pnpm exec playwright install chromium
pnpm test:bot-harness:browser
node scripts/check-inline-harness-handoff-browser.mjs
pnpm exec vp test --maxWorkers=2 packages/runtime/src/http/endpoints/bot-harness-switch.test.ts packages/runtime/src/agents/tasks/pending-harness.test.ts packages/runtime/src/http/thread-handoff.test.ts
pnpm exec vp test --maxWorkers=2 packages/runtime/src/http/endpoints/bot-conversation-archive.test.ts packages/runtime/src/http/endpoints/bot-context.test.ts packages/protocol/src/tasks/thread-children.test.ts
node scripts/check-bot-conversations-browser.mjs
node scripts/check-desktop-side-chats-browser.mjs
node scripts/check-mobile-agent-side-chats-browser.mjs
```

The browser checks use real components with platform controls replaced by DOM controls. They verify
navigation, editing, confirmation, retries, conflicts and computer ownership. They do not establish
native iPhone appearance.

The harness checks use real HTTP and SQLite with scripted provider adapters. They cover new,
existing and freshly archived OpenCode Bot conversations, restart, request replay, saved history,
fresh provider sessions and active-child guards. The mobile picker check uses the real picker with
simulated provider availability and model catalogs. Live provider execution and native iPhone
appearance remain unverified for this change.
