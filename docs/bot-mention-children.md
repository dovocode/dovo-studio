# Bot mention children

Send an explicit Bot mention from the composer. Dovo saves a copy under the conversation that sent
the mention. Find it in that conversation’s side chats on desktop or mobile. A Bot’s mention of
itself appears in its subthread list. The message runs once in the source thread. The copy stays
idle until you send a follow-up there.

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

The copy stays on the sending computer, including when the mentioned Bot is on another computer. The
caller link opens the original conversation. If the caller is absent, Dovo keeps the saved
reference. The mention grants no access to the Bot. Older runtimes still send the source message
without creating a copy. Dovo does not copy old messages retroactively.

A Studio Tools `send` to a Bot starts an isolated conversation on the Bot’s computer. It appears
under the receiving Bot in its subthreads, **Side threads**, and the **Work inbox**, even if the
calling computer is offline. The caller can still open the same conversation from its side chats.
The call uses the Bot’s agent configuration and role, with the caller’s permission ceiling. It
starts with the supplied prompt and keeps the Bot’s permanent conversation and private memory
separate. The response contains the new thread ID. Use that ID to read the answer or send a
follow-up. Retry the same message ID to recover a lost response. Both paired runtimes must support
this call behavior. You can still message ordinary threads on older paired runtimes. If the older
runtime cannot start a Bot call, Dovo asks you to update it.

Open the caller to see a waiting approval or question from its side thread on a paired computer.
Select the request to open it on the computer that owns it.

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
