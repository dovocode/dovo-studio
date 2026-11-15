# Bot conversations

Use **Archive and start new** above a Bot conversation. Confirm the action to save the current
conversation as a child under the same Bot. Open **Side threads** to read or rename saved
conversations.

The Bot keeps its name, settings, permissions, memory, routines and unsent draft. The next message
starts a new model session with no messages from the saved conversation. Files on the computer stay
in place. This action does not delete memory.

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
pnpm exec vp test --maxWorkers=2 packages/runtime/src/http/endpoints/bot-conversation-archive.test.ts packages/runtime/src/http/endpoints/bot-context.test.ts packages/protocol/src/tasks/thread-children.test.ts
node scripts/check-bot-conversations-browser.mjs
node scripts/check-desktop-side-chats-browser.mjs
node scripts/check-mobile-agent-side-chats-browser.mjs
```

The browser checks use real components with platform controls replaced by DOM controls. They verify
navigation, editing, confirmation, retries, conflicts and computer ownership. They do not establish
native iPhone appearance.
