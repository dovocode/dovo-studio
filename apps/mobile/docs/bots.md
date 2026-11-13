# Mobile Bots

Open **Bots** in the workspace modes or navigation menu. A paired runtime must advertise
`botsSupported: true`. The direct `/bots` route explains when a runtime needs an update. An offline
computer keeps its cached Bot rows. Reconnect before changing settings or memory. HTTP runtime
addresses remain supported.

Create a Bot with a name, role and responsibilities. Bots are standalone assistants. They do not
belong to a project. Creation uses an advertised scratch backing entry inside the existing thread
engine. The app does not create or guess an unsafe scratch entry. This backing entry is not a
project choice in the Bot interface. Creation uses global defaults, main execution and no project
setup, worktree or linked checkouts. Existing uncertain creation requests keep their exact payload
until the runtime confirms or rejects them.

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

Use **Bot MCP servers and skills** to add, edit or remove definitions for this Bot. The sheet shows
inherited definitions and Bot overrides. Disable an inherited resource for this Bot, or restore it,
without changing the shared definition. Use **Reset to inherited** to remove an override and restore
inheritance. This can enable the shared resource again. Use the separate inherited disable control
to keep it off for this Bot. These edits stay in the Bot draft. Select **Save Bot** to apply the
role and resources with one revision check. Switching harness keeps these Bot resources. Saved
credentials stay hidden. These controls manage Dovo resources. Installed harnesses can also load
native or global tools and skills. They do not restrict host file access for a full-access agent.
This feature needs the runtime's top-level `botResourcesSupported` flag.

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
native build, install or deployment is part of these checks.
