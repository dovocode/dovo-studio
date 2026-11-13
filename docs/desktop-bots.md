# Desktop Bots

Open **Bots** in the activity bar. Select **New Bot**, set its name, role, responsibilities, project
and harness, then create it. A paired runtime with `botsSupported: true` is required. Existing HTTP
LAN and VPN runtime addresses remain supported.

Each Bot has one permanent thread. The Bots list uses the normal thread row. The unified workspace
includes that same thread once, with a Bot icon. Delegated work remains below its parent. The normal
Threads list excludes Bots.

Open **Bot settings** beside the conversation. The sidebar leaves the composer available. Close it
to give the chat more space. The harness, model and access controls edit the real thread settings.
They keep the existing provider session and permission rules. They do not create a separate browser
session or establish browser isolation.

**Pause Bot** holds new turns. You can still queue messages. Current work may finish; use the normal
Stop control to cancel it. **Resume Bot** releases queued work. The runtime owns this behavior.

Memory notes use the Bot memory scope. Dovo memory tools give access to the Bot coordinator and the
paired human. Delegated agents do not inherit them. An agent with full file access on the same
computer can read saved files. Do not save secrets. Memory edits include the note revision to detect
concurrent edits.

Use **Manage routines** to open Automations. Select a task step and choose the Bot in **Thread
target**. Its instructions go to the existing Bot thread. The Bot's current harness, project and
permissions apply. A routine that targets a paused Bot fails; resume the Bot before retrying that
run.

Set **MCP servers and skills** in the Bot settings sidebar. The runtime must advertise
`botResourcesSupported`. Add, edit or remove this Bot's definitions. Turn inherited resources off
for this Bot, or override them. Reset an override to use the inherited definition. These changes
stay with the Bot when its harness changes. They do not change shared settings or other Bots. Dovo
stores MCP credential values and returns hidden references. The existing credential editor keeps
those references when you edit another field. These controls manage Dovo resources. Installed
harnesses can still use their own native or global configuration.

An agent can call `thread_prepare` to add a **New agent thread** card to its conversation. This is a
native first-party card, not an arbitrary HTML button. Open **Review and Send**. Change the prompt,
harness, saved agent or model, then select **Send**. Loading or editing the card starts no work. The
new thread stays in the source project. It does not inherit Bot memory or Bot resource overrides.
After Send, open the created thread from the card. Dismiss removes an unsent proposal. The runtime
must advertise `threadActionsSupported`.

Bots stay on their home computer. **Continue elsewhere** can change the harness on that computer,
but cannot move the Bot to another computer.

Role, creation and memory drafts stay in this desktop session when you close the settings or leave
the view. Drafts are separate for each runtime and Bot. These settings drafts do not survive an
application restart. Normal message drafts keep the existing composer persistence. Failed edits keep
the settings draft. A failed creation keeps its exact request and thread ID for retry, which avoids
creating another Bot after a lost reply. The runtime snapshot owns Bot metadata; the client never
writes it through a workspace patch.

Offline computers retain cached Bot rows. Editing requires an online computer. Older runtimes show
an update message and disable Bot mutations. If creation succeeds before the thread arrives, the
view waits for its runtime snapshot.

## Verification

Run from the checkout root:

```sh
pnpm exec playwright install chromium
node scripts/check-bots-browser.mjs
node scripts/check-desktop-bot-resources-browser.mjs
pnpm --filter @dovo/extension-tasks typecheck
pnpm --filter @dovo/extension-jobs typecheck
pnpm --filter @dovo/studio-shell typecheck
pnpm exec vp test packages/studio-shell/src/activity-bar.test.ts packages/extension-tasks/src/list/task-presentation.test.ts
```

The browser test mounts the real desktop views, thread rows, composer, Bot forms and harness save
controls. It uses fixture transport and lightweight visual shells. It covers runtime ownership,
draft recovery, conflicts, pause and resume, private memory routing, normal chats, creation retries
and routine targeting. The resource/action fixture checks the actual MCP, credential and skill
editors, inherited disabling/reset, revision conflict recovery, reviewed action dispatch, exact
request replay and sent-thread links. It uses fixture transport and UI primitives. It does not
verify native harness execution, the runtime scheduler, native browser isolation or a packaged
desktop build.
