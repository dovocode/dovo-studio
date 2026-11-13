# Desktop Bots

Open **Bots** in the activity bar. Select **New Bot**. Set its role, name and optional
responsibilities. Choose its paired computer in **Runs on**. Each computer shows its name and
connection status. The local computer has a **Local** label when Dovo knows its identity. You can
open creation when any paired computer is online and supports Bots, even if the active computer is
offline or needs an update. Changing the computer keeps your text and starts no work.

Open **Agent settings** to change the harness, model or permissions. These settings start with the
selected computer's defaults. Choices stay separate for each pairing. The computer picker does not
change the active computer. Select **Create Bot** to create the Bot and open its conversation on its
home computer. There is no project picker. Bots use that computer's internal scratch folder and
require no project setup. Creation stops if the scratch folder is unavailable.

A paired runtime with `botsSupported: true` is required. Existing HTTP LAN and VPN runtime addresses
remain supported. No account or external login is required.

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
the view. Settings and memory drafts stay separate for each runtime and Bot. Creation text follows
the selected computer. These drafts do not survive an application restart. Normal message drafts
keep the existing composer persistence. Failed edits keep the settings draft.

An uncertain creation keeps its exact request, thread ID and computer pairing for retry. Its text,
agent settings and computer stay locked until the result is known. Retry reuses the same request and
cannot create another Bot after a lost reply. Leaving and reopening the form does not send a second
request while the first is in progress. A failed snapshot refresh keeps the successful result and
does not repeat creation. A late reply keeps a newer Bot selection and cannot replace or clear a
newer draft. Select **Open Bot** to open a retained successful result.

**New Bot** clears the previous Bot from the route. A notification, routine or command that opens
another Bot closes creation and selects that conversation. A late create reply keeps that selection.
Reopen **New Bot** to recover the retained request. Changing only the active computer keeps the
creation form open. While Dovo switches to the created Bot's computer, Bot rows, **New Bot** and
**Back to Bots** stay disabled. Back remains available during the create request before that switch
starts.

A removed computer or replaced credential cannot receive the original request. A new pairing has new
credentials. It cannot restore the old request's access. Select **Discard creation request** when
its pairing is unavailable. Check Bots on the original computer first: the Bot may already exist.
Confirm the discard to keep your text and choose an available computer. If creation already
succeeded, the confirmation states that it removes only the local request to open the Bot. It does
not delete the Bot. Discard does not undo remote work or discard saved actions.

A confirmed rejection makes the text editable but can leave a blocked action in the runtime's
saved-action journal. Editing the draft alone does not unblock later creation. For a rejection or
**A saved action needs review**, select **Open computers**. Find the original computer and select
**Review saved actions**. Check its Bots and review each action before you retry or discard it.
Discarding an action cannot undo work already applied on that computer. Return to Bots and reopen
**New Bot** to continue with the retained text or exact pending request.

The journal currently labels Bot creation as **Saved action**. It does not expose a path or request
ID through `mutationStatus`. The form cannot identify and discard just its own journal action. It
never discards actions automatically. Review other saved work with care. The runtime snapshot owns
Bot metadata; the client never writes it through a workspace patch.

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
controls. Creation uses the real computer `ChoicePicker`, native CSS and theme tokens. The form has
no hero image or image asset dependency. It saves actual light, dark and narrow form screenshots to
`/tmp/dovo-bot-create-desktop-*.png`. Themes use `data-theme`; motion is reduced. The fixture checks
horizontal overflow.

Desktop creation checks cover selection without create or global-switch side effects, separate host
defaults and harness choices, explicit owner transport, refresh failure, exact retry after a lost
reply, removed/offline/unsupported hosts, missing scratch folders and credential replacement before
or during I/O. It also covers deferred switch and React context commits, navigation locks, external
Bot routes, and retained selection after late replies, leave/remount during deferred creation, one
in-flight call per request, explicit discard, and stale replies after a newer successful creation
and draft. It uses the real exported `WorkspaceRuntimeScope` and `WorkspaceScope`. Address or token
replacement blocks retained requests; learned route metadata keeps the pairing valid.

The rejection check models a blocked journal action with fixture transport. It mounts the real
`SavedActions` panel, follows **Open computers**, discards one reviewed action, keeps unrelated
saved work and retries the exact pending request. This does not verify the durable journal or an
HTTP server. The transport checks `resolveRuntimeTarget` before and after each explicit-owner
request. Harness discovery and some visual shells remain fixtures.

The resource/action fixture checks the actual MCP, credential and skill editors, inherited settings,
conflict recovery, reviewed action dispatch, exact request replay and sent-thread links. It uses
fixture transport and UI primitives. These local browser checks do not verify native harness
execution, the runtime scheduler, native browser isolation or a packaged desktop build.
