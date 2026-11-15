# Bot mention children

Send an explicit Bot mention from the composer. Dovo saves a child conversation under that Bot. The
message runs once in the source thread. The child stays idle until you send a follow-up there. Open
the Bot's Side threads list on desktop or mobile to find it. Use Open source thread to see the
source's later replies.

The child contains the source's retained conversation through the sent message. It copies the
selected harness, model settings, access settings, resources, linked projects and attachments. It
has its own attachment records and a fresh provider session. It excludes context-reset ranges,
queued messages other than this submission, provider sessions, active tool state and the source's
unsent draft. Later source messages do not update the copy.

For a Git project, the child starts from the source's committed HEAD in a separate checkout.
Uncommitted source files are not copied. A General child has its own directory. If the source branch
has no commit, Dovo uses a private empty commit for the child. The source branch stays unchanged.

A mention has the saved form ``@Dory (`studio:<runtime>:thread:<bot-id>`)``. Bare names, bare IDs,
code blocks, headings and links do not create children. Only a new human composer submission creates
a copy. Inherited history and agent messages do not create copies. Repeated mentions of one Bot in a
message create one child. A submission supports up to 20 Bots.

Message admission and child creation share one database transaction. A failed copy leaves the
message unsent. Retrying the same message ID preserves the saved result, including across restart.
Deleting a child does not make a retried submission recreate it.

The child stays on the sending computer, including when the Bot is on another computer. The client
shows remote children when it has snapshots for both paired computers. Opening one uses its owning
computer. This association sends no conversation to the Bot's runtime and grants no access. Update
the source runtime and both clients to use this behavior. Older runtimes still send the source
message but do not create the copy. Existing messages are not copied retroactively.

Routine workers also appear in their Bot's Side threads list. They retain their saved job context
and stay out of the normal thread overview. Their rows open the worker conversation. They do not
offer side-chat bring-back or discard actions. This change adds no `@automation` mention.

Run the focused checks:

```sh
pnpm exec vp test --maxWorkers=2 packages/runtime/src/http/bot-mention-children.test.ts packages/protocol/src/tasks/thread-children.test.ts packages/protocol/src/conversation/presentation/bot-mentions.test.ts
pnpm exec playwright install chromium
node scripts/check-desktop-side-chats-browser.mjs
node scripts/check-mobile-agent-side-chats-browser.mjs
```

HTTP tests use real SQLite, Git checkouts and attachment records with a scripted provider. Browser
checks use the real panels with client adapters. These checks do not verify native iPhone rendering
or a live model provider.
