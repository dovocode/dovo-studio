# Mobile Bots

Open **Bots** in the workspace modes or navigation menu. A paired runtime must advertise
`botsSupported: true`. The direct `/bots` route explains when a runtime needs an update. An offline
computer keeps its cached Bot rows. Reconnect before changing settings or memory. HTTP runtime
addresses remain supported.

Create a Bot with a name, role and responsibilities. Bots are standalone assistants. They do not
belong to a project. Creation uses an advertised scratch backing entry inside the existing thread
engine. The app does not create or guess an unsafe scratch entry. This backing entry is not a
project choice in the Bot interface. Creation uses the selected computer's global defaults, main
execution and no project setup, worktree or linked checkouts. After creation, open **Bot settings**
to choose the harness, model and tool permissions.

The **Runs on** card shows the computer that will host the Bot. It is always visible, also with one
computer. Select the card to see each paired computer with its status: **Online**, **Offline**,
**Connecting**, **Update required** or **Not ready** (no safe scratch entry). You can select only an
online computer that is ready. When you open the sheet, the default is the active computer when it
is ready, otherwise the first ready computer. The default is then fixed: if that computer goes
offline or is removed, the sheet shows this and does not move the Bot to another computer. A change
of computer keeps the name, role and responsibilities and keeps the sheet open. Each request gets
new IDs and the selected computer's defaults. Nothing carries over from another computer.

The optional starter roles (**Release**, **Research** and **Daily brief**) fill only empty fields.
They never replace text that you typed, and they send nothing. The create sheet has no model or tool
controls, because creation has no such settings.

After an uncertain failure, the request keeps its exact body, computer and pairing. The fields and
the computer stay locked, and **Retry Create Bot** sends the same request again. The runtime replays
a request ID without a second Bot. If the computer is offline or needs an update, the retry waits. A
retry uses only the exact pairing (address and token) of the first attempt. If the computer was
paired again, also with the same runtime ID, or was removed, the retry is blocked. Dovo does not
send the earlier request with new credentials. **Discard earlier request** then asks for
confirmation: the earlier request may already have created the Bot, so check that computer's Bots
first, and a new request can make a second Bot. **Keep earlier request** keeps the frozen request. A
confirmed rejection releases the request and keeps the text. After success, the app opens the new
Bot on the computer that received the request. The app opens it only while the sheet is open and the
exact pairing that sent the request is still saved. If that computer was paired again or removed,
the app keeps your text and the frozen request and says to open the Bot from that computer's Bots.
If the reply arrives after the sheet closed, the request also stays frozen: a retry on the same
pairing replays the same request ID and returns the same Bot. A late reply to an earlier request
cannot close or redirect a newer draft. The creation draft stays in memory only and does not survive
an app restart.

Open a Bot row to use its conversation. Rows show Bot identity and role. The Bot ID is the thread
ID. Runs do not add Bot rows. The unified workspace includes Bots and has a Bots filter. Bot
conversations do not show project labels, project controls or coding startup cards.

The Bot composer shows the message, attachments and Send/Stop controls. It does not offer Plan or
per-message harness/model picks. New sends use persistent Bot settings and ignore hidden old
per-turn overrides. Message drafts stay intact. Normal chat controls stay unchanged.

Open **Bot settings** in the thread. Use **Harness, model and tool permissions** to open the
existing thread settings. These settings use the thread's runtime owner. Role and responsibility
updates use the Bot revision to detect conflicts. Title changes use the normal workspace patch.
These two writes are separate. If the second write fails, the title can already be saved.

Pause holds new work. Messages remain queued. The current turn can finish. Use **Stop** in the chat
to cancel it. Resume releases held work.

Use **Bot memory** to add, edit or delete Bot notes. Dovo memory tools keep these notes separate
from other threads and child agents. A full-access agent on the same computer can read files. Notes
use `scope: 'bot'` and the thread ID as `botId`. Writes and deletes use revision checks. A failed
save keeps the text in the sheet. Unsaved form text stays in memory when you close a sheet. It does
not survive an app restart. Draft keys separate computers, pairings and Bots.

Routines are optional. Open **Manage routines**, then set a task step's **Destination** to the Bot.
That step uses the Bot's persistent harness and permissions. A paused Bot cannot run a routine step.
Resume the Bot, then retry the routine run.

Use **Bot MCP servers** or **Bot skills** to add, edit or remove definitions for this Bot. The sheet
shows inherited definitions and Bot overrides. Disable an inherited resource for this Bot, or
restore it, without changing the shared definition. Use **Reset to inherited** to remove an override
and restore inheritance. This can enable the shared resource again. Use the separate inherited
disable control to keep it off for this Bot. These edits stay in the Bot draft. Select **Save Bot**
to apply the role and resources with one revision check. Switching harness keeps these Bot
resources. Saved credentials stay hidden. These controls manage Dovo resources. Installed harnesses
can also load native or global tools and skills. They do not restrict host file access for a
full-access agent. This feature needs the runtime's top-level `botResourcesSupported` flag.

An agent can use `dovo_task thread_prepare` to propose a new thread. The mobile conversation shows a
native Dovo card after that turn. Select **Review new thread**. Edit the prompt, harness and model,
choose a destination, then select **Send**. Opening the card starts no work. The new thread can use
any advertised project or No project on the source computer. It does not copy Bot resources or Bot
memory. Runtime policy checks the selected access settings. Use **Dismiss thread action** to remove
an unsent proposal. This feature needs the top-level `threadActionsSupported` flag.

After an uncertain Send failure, the editor keeps the full request and shows **Retry Send**. Retry
uses the same task and message IDs. A confirmed rejection lets you correct the settings. A sent card
shows **Sent** and **Open sent thread**. The runtime also prevents duplicate sends across devices
and restarts. The mobile browser tests check request replay; runtime integration tests must
establish the server's restart and multi-device guarantees.

## Verify

Run from the repository root:

```sh
pnpm --filter @dovo/protocol --filter @dovo/client-runtime -r build
pnpm --filter @dovo/mobile typecheck
pnpm exec vp test apps/mobile/src/workspace/workspace-items.test.ts apps/mobile/src/shell/route-paths.test.ts apps/mobile/src/tasks/list/task-list-projection.test.ts
pnpm exec playwright install chromium
node scripts/check-mobile-bots-browser.mjs
node scripts/check-mobile-bot-routines-browser.mjs
node scripts/check-mobile-bot-resources-browser.mjs
node scripts/check-mobile-thread-actions-browser.mjs
node scripts/check-mobile-mcp-thread-editor-browser.mjs
node scripts/check-mobile-workspace-overview-browser.mjs
node scripts/check-mobile-task-list-rendering-browser.mjs
```

Browser checks use real mobile components with native controls and runtime transport adapted for the
browser. They do not establish native sheet behavior or a live device-to-runtime connection. No
native build, install or deployment is part of these checks. `check-mobile-bots-browser.mjs` also
renders the real create sheet with the real theme at 390x844. It writes screenshots to
`/tmp/dovo-bot-create-mobile*.png`.

Bot tools now have separate Settings, MCP servers, Skills, Memory and Routines entries. Use MCP
Registry or skills.sh to import resources for this Bot. Set or generate a reviewed avatar in
Settings. Pinned Bots appear first in the avatar row at the top of Threads. Other Bots sort by
conversation activity. A bubble uses the existing unread state.

Use **Reset context to here** on a finished reply instead of Fork. Later messages stay visible.
Reset changes future model context only. Files and completed actions stay unchanged. See
[Bot behavior](../../../docs/bots.md) for avatar generation, reset and background-work limits.
