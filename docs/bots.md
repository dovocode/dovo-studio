# Bots

A Bot is a persistent assistant on one computer. Each Bot is one permanent thread. The Bot keeps its
conversation, its standing responsibilities and its private memory across runtime restarts.

Bots use the normal thread engine. They do not add a second execution engine:

- **Name:** the thread title. Dovo does not replace it with a generated title.
- **Harness, model, thinking level and permissions:** the thread's ordinary settings. Change them in
  the Bot settings.
- **No project:** a Bot is a standalone assistant. The runtime creates Bots only without a project
  and does not let an edit, automatic project selection or a first-message title move or rename one.
  Internally the thread runs in Dovo's no-project workspace; clients do not show it as a project. A
  Bot never gets project settings, project MCP servers or skills, worktree setup or automatic
  project routing. Its agent can still work on projects through linked projects, child agents or
  new-thread actions.
- **Subagents, approvals, questions, queue and Stop:** the same as in any other thread.
- **Role and responsibilities:** Bot-only fields. Dovo adds them as standing instructions to every
  turn.

## Conversation and background work

Bots answer short questions directly. When Dovo tools are available, their standing instructions
favor child agents for substantial work. The Bot starts a child, reports what is running and ends
its reply so you can keep talking. The existing subagent inbox returns results and resumes the Bot.
This is model guidance, not a guarantee that every harness will delegate. User and repository
restrictions still apply. Children keep their own resources and cannot use private Bot memory.

Bots appear in a row above desktop Threads and Unified, and at the top of mobile Tasks. Use **+** at
the end of the row to create a Bot. An empty row still shows **+**. Pinned Bots come first. Each
group sorts by the latest prompt or turn activity. A bubble shows unread activity. Use the avatar
menu or touch and hold on mobile to pin a Bot. The Bots activity tab reopens the last selected Bot
on the active computer during this app session.

In a normal thread, type `@` and choose a Bot to insert its name and computer-specific Studio
reference. This does not send a request, read its private memory or start a Bot turn.

## Settings and avatars

The Bot tools panel has separate Settings, MCP servers, Skills, Memory and Routines entries. MCP
servers includes MCP Registry. Skills includes skills.sh. Imports apply to this Bot only; review the
definition before saving it. Mobile exposes the same entries in the conversation menu.

In Settings, choose an avatar image or describe one and select **Generate avatar**. A temporary chat
uses the Bot's harness by default. Choose another harness, saved agent or installed ACP agent with
**Avatar generation harness**. This choice does not change the Bot's saved harness. The temporary
chat runs on the Bot's computer and keeps its access limits. It uses the selected agent's resources
and the Bot's own resources. Install an image-generation tool or skill there first. Generation can
incur provider charges. The agent has no Dovo coordinator token and does not post to the
conversation. Its temporary folder is removed after completion, failure or cancellation. Generation
times out after five minutes. A retry with the same request returns the same preview rather than
charging for another run. After an interrupted request, use Cancel generation to clear the request
before generating another preview.

Select **Use avatar** to apply a preview, **Discard preview** to keep the current avatar, or
**Remove avatar** to return to the default icon. Uploads accept PNG, JPEG, WebP and GIF up to 5 MB.
The runtime stores a 128-pixel square WebP thumbnail without image metadata.

Bots do not have Settle, Snooze, Archive or Delete thread controls. Use Pause/Resume and Delete Bot
in Bot settings. The runtime also rejects settling, snoozing and archiving a Bot.

## Reset context

Bot replies offer **Reset context to here** instead of Fork. Finish or stop current work and clear
the queue first. Confirm the reset to start a fresh provider session from that reply. Later messages
stay visible but do not enter future model context. New messages after the reset do enter context.
Reset markers and excluded ranges survive runtime restart. Reset does not restore files, repeat
actions, remove the transcript or change action receipts. It does not undo external work.

## Who can change a Bot

Only paired human clients can create a Bot or change its role, responsibilities, pause state or
settings. Agent runs cannot call the Bot or workspace endpoints, so a Bot cannot widen its own
permissions. Studio Tools cannot archive or restore a Bot. Older clients edit individual thread
fields, so they cannot remove a Bot's identity.

## Delete a Bot

Open **Settings → Delete Bot…** on desktop or mobile. Confirm **Delete Bot** to permanently remove
its conversation, private memory and local child threads. Repository files and worktrees stay. Saved
routines stay, but any step that targets the deleted Bot needs a new target before it can run.
Deletion requires the Bot's computer to be connected. Stop active Bot and child work, finish active
automation steps and close their terminals first. Finish or cancel avatar generation too. Reconnect
offline delegated workers to confirm they stopped. A failed request keeps the settings open.
Retrying a delete for a Bot that is already gone is safe.

## Pause and resume

**Pause** holds all new work:

- Dovo accepts and queues messages that you send to a paused Bot. They do not start.
- Queue continuations, child-agent results, scheduled messages and routines do not start a turn.
- The current turn can finish. Use **Stop** to cancel it.
- A routine step for a paused Bot fails with "This Bot is paused." It does not count as success and
  is not retried automatically. Resume the Bot, then **Retry** the run.

**Resume** starts the next held message when the thread is idle. A queue that you paused yourself
stays paused. Pause state survives restarts.

## Bot memory

Each Bot has a `bot` memory scope. It is always on for that Bot and has no switch. The Dovo memory
tools give it only to the Bot's own thread. Child agents and other threads cannot read or change it
through Dovo. The runtime takes the Bot identity from the agent run; an agent cannot name another
Bot. Read-only Bots can read their notes but cannot change them.

This is not an operating-system boundary. Notes are stored in the runtime database on this computer.
An agent with full file access on the same computer can read files that its user account can read.
Do not save credentials or other secrets in memory.

Manage the notes with the memory endpoints and `{ "scope": "bot", "botId": "<thread id>" }`.
Deleting the Bot thread deletes its notes. System-wide and project memory still follow their own
switches.

## Work overview

Desktop and mobile Bot conversations show **Bot work** above the messages. **Routines** opens the
Bot's saved automations. **Workers** opens the existing agent panel. Counts show running routine
turns, runs that need review, latest failed runs, active workers and offline remote workers. Offline
clients label the snapshot as **Last saved state**. These counts use the current host snapshot; they
do not promise that an offline worker is still running.

Routine details show the trigger and time zone, task and human review steps, and up to three recent
runs. Select a run to open that exact run on the Bot's computer. Use the automation view for the
full workflow and history. A completed routine turn can leave a worker running. Dovo shows these
states separately. Host snapshots contain recent runs only, so the overview is not a complete audit
of all earlier failures.

Each Bot turn receives a bounded catalog of its configured routines, without private objectives or
credentials. Instructions tell the Bot to inspect the live tools before claiming a feature is
unavailable, reuse workers, give clear briefs and check their results. Dependent work can use named
workflow phases. User and repository restrictions on delegation still apply. Prompts do not grant
permissions or replace runtime review controls. Routine metadata and worker output do not authorize
new actions.

The design uses the visible handoffs and workflow reviews shown by [OpenBot](https://openbot.run/),
the job ownership and progress shown by [Grok Bot](https://x.ai/bot), and the schedule details and
approval scope shown by [Nod](https://nod.n8n.io/). Source review used Nod's
[prompt](https://github.com/n8n-io/nod/blob/8e93a365f6c0df38d058ac0a92ca4507a479bd88/src/runtime/prompt.ts)
and
[schedule guide](https://github.com/n8n-io/nod/blob/8e93a365f6c0df38d058ac0a92ca4507a479bd88/src/runtime/skills/schedules-and-watches/SKILL.md).
Nod explicitly disables subagents. Dovo keeps its own coordinator and worker engine. It does not
copy Nod's private preparation, external app integrations or notification system.

Verify from the repository root:

```sh
pnpm --filter @dovo/protocol build
pnpm exec vp test packages/protocol/src/tasks/bot-work.test.ts packages/protocol/src/tasks/bots.test.ts packages/runtime/src/http/endpoints/bot-context.test.ts --maxWorkers=1
pnpm exec playwright install chromium
pnpm test:bots:browser
```

The runtime test uses HTTP, SQLite and a scripted provider. Browser checks use desktop components
and mobile components with native stubs. They do not prove live model adherence to the instructions.

## Routines

For Bot jobs, agents use `studio_automations` with a task node whose `data.botId` is the existing
Bot thread ID on the selected computer. Use `studio_threads` list/read to find that Bot. Set
`data.objective` to the job instructions. Create, validate and update use the complete automation
object. If a tool description is incomplete, inspect its input schema before declaring the feature
unavailable. The automation list, canvas and mobile editor identify these steps as **Bot jobs** and
show the target Bot. Bot jobs use the same automation engine and run history as other steps.

An automation task step can target a Bot with `botId`. The step posts its instructions into the
Bot's thread (message source `automation`) and waits for **that message's own turn**:

- The step completes when that turn completes. Other work in the Bot thread does not delay it or
  decide it: your own messages, other routines and child agents can continue.
- The step fails when that turn fails or is stopped. A later successful turn does not change this.
- A completed turn ends the step. Child agents that the turn started can still be working, and the
  Bot's ongoing responsibilities are not "done". Later work in the thread is not part of the step.
- The run's step records `messageId`, the routine message in the Bot thread. Clients link to it.
- The step uses the Bot's current settings. The step's harness, agent, project and linked-project
  fields are ignored, so clients can keep them for a later switch back to a normal step.

Each step attempt has a fixed message id. **Retry** adopts an earlier attempt's message that is
still queued, running or already completed, so it never sends the same routine twice, also after a
crash or a lost delivery response. While a restarted turn waits for automatic recovery, the step
waits too. After a failed or stopped Bot turn, **Retry** sends the instructions again and continues
the Bot's queue. A queue that you paused yourself stays paused and fails the step.

**Stop** on the run removes this step's message from the Bot queue if it has not started, or stops
the turn that runs it. It never stops other Bot work. When a step fails because the Bot is paused or
you paused its queue, Dovo removes the step's queued message, so resuming does not run a failed
routine; other queued messages stay. A finished run does not hold the Bot thread: the next run of
the same automation can start while other Bot work continues, and restart recovery treats your own
interrupted turns as normal turns. A clean runtime shutdown also removes a queued routine message;
**Retry** then sends it once.

An automation that targets a missing or archived Bot fails validation.

## Lifecycle

Bots never settle or archive automatically: inactivity, settled-thread retention and merged pull
requests skip them. You can still archive, restore or delete a Bot by hand. Bots cannot move to
another computer, because their memory and routines stay on this one.

## MCP servers and skills for one Bot

Each Bot can have its own MCP servers and skills. They apply only to that Bot's own thread. They do
not change the shared agent, profile, project or any other Bot, and they stay when you switch the
Bot's harness.

The Bot inherits the MCP servers and skills of the global and computer settings and of its agent. It
never inherits project settings, also when an older Bot still has a project. For one Bot you can:

- add, edit or remove its own MCP servers and skills;
- turn off an inherited server or skill (`disabledMcpServers`, `disabledSkills`);
- replace an inherited definition: an own definition with the same name wins.

`applyBotResources` and `botResourceItems` in `@dovo/protocol` give the effective list and one row
per item with its source (`inherited`, `bot` or `replaces-inherited`). The runtime uses the same
rule for agent turns, MCP Apps and the Dovo MCP bridge, skill reads, and `@`, `$` and `/` mentions.

Rules:

- Child agents and threads started from a Bot use their own settings. They do not receive the Bot's
  own resources or its memory.
- Managed policy and approval rules apply as for agent resources.
- Literal `envValues` and `headerValues` stay on this computer. Snapshots, responses and durable
  retry receipts show `dovo-stored-secret:` references instead. Send a reference back unchanged to
  keep the stored value. A changed or unknown reference returns 409.
- Removing a server revokes Dovo bridge access that an earlier turn received.
- These settings control Dovo-managed MCP servers and skills. An installed harness can still load
  its own native or global configuration, and a full-access CLI can use any tool its user account
  can reach. Use the harness configuration directory and access settings to limit that.

## Reviewed action cards

Agents can prepare native action cards in Bots, normal threads and threads started by automations.
The regular Dovo MCP server must be enabled. Studio Tools need not be enabled. Read-only runs can
prepare cards. Preparation and review start no work. Only a paired human client can select **Send**
or **Start**. Agent tokens cannot start cards. Workspace edits cannot create or change cards.

### Start a new thread

Use `thread_prepare` with `{ key, title, prompt, provider?, model?, reasoning?, agentId? }`. Review
the prompt, destination, harness and model on desktop or mobile, then select **Send** or
**Dismiss**.

- The new thread stays on the source computer. Choose any project there, or no project.
- Its access, including a first-turn harness override, must be the same as or narrower than the
  source thread's access and the preparing turn's access. Start a normal thread if it needs broader
  access.
- It uses the chosen harness and project settings. It does not copy a Bot's own resources, memory or
  identity.
- Send is safe to retry. The new thread, its first queued message and the sent card commit together.
  A lost response, double tap, another device or restart returns the same thread. If the turn did
  not start, retry Send to start that exact message, or resume the new thread's queue. Other queued
  input stays held. A paused queue stays paused. After a restart, queued input waits for Resume.

### Start an existing automation

Use `automation_list` with `{}` to find configured workflows on this computer. Each page returns up
to 100 workflows with only `id`, `name` and `enabled`. Names longer than 200 characters are
shortened. Responses stay within 32 KB of UTF-8 JSON. Set `limit` (1–100) for a smaller page. If the
response has `nextCursor`, pass it as `cursor` to get the next page. Continue until no cursor
remains. If the catalog changes, restart without a cursor. Discovery starts no work and needs no
Studio Tools. Then use `automation_prepare` with `{ key, title, automationId, prompt }`. The card
names one saved automation on the source computer. Review its saved workflow, each step's
instructions, effective agent, projects and access before **Start**. A Bot step uses the Bot's
actual settings and projects. The review does not copy its private memory, standing instructions or
secret values.

When a step has a pending first-turn model choice, review shows **Tune**, **Maestro** or **Inherit**
and says that the model is chosen or applied at start. Access stays visible. For a normal step, an
explicit saved harness or agent clears the project default selector. A Bot with prior turns or a
session shows its saved model. It does not select a new model for each run.

Edit **Run context** to supply input for this run. Dovo labels it as external input when it adds it
to the step prompt. The saved automation stays unchanged. The review does not edit workflow steps,
agents or project settings.

Start checks the reviewed revision. A changed workflow, effective agent, project or Bot target
requires a new review. A missing or paused target cannot start. Use **Refresh review** after a stale
review error; Dovo keeps your edited context. Every task step must stay within the source thread's
access. To run an automation with broader access, use the normal automation Run action and review it
there.

The run, delivery key and sent card commit together before execution starts. Retry returns the same
run after a lost response, double tap, restart or card removal. Dismiss cannot undo a sent run. Use
the normal automation run controls to stop it. Run links keep the exact run ID. If that run is not
in the computer's recent history, the view shows an unavailable notice. It does not select a
different run.

### Buttons in a reply

Use `response_prepare` with `{ key, title, action }` to put a button below the preparing reply. It
works in a normal thread, a Bot, or an automation thread. The runtime must advertise
`responseActionsSupported`. Preparation never sends a prompt or runs a command or tool.

Supported actions:

```json
{
  "key": "continue",
  "title": "Continue",
  "action": { "kind": "prompt", "prompt": "Continue with the next step." }
}
```

```json
{
  "key": "build",
  "title": "Build the app",
  "action": { "kind": "command", "command": "pnpm build" }
}
```

```json
{
  "key": "publish",
  "title": "Publish beta",
  "action": {
    "kind": "mcp",
    "server": "releases",
    "tool": "publish",
    "arguments": { "channel": "beta" }
  }
}
```

**Review prompt** opens an editable prompt. **Send to thread** adds it to this thread's queue with
the current agent settings. It keeps the composer draft. A paused queue stays paused. Retry starts
only that accepted message; it cannot consume another queued message.

**Review action** shows the exact command or MCP arguments and working directory. **Run action**
records a receipt before the external action starts. Commands open a separate thread terminal; use
**Open terminal** for output and Stop. MCP output stays on the card and is bounded and redacted. A
command receipt means the command started. It does not mean the command succeeded.

Review can connect a configured MCP server to check its tool definition and input schema. It does
not call the selected tool.

Direct actions require an idle, open thread on its home computer. MCP calls require write access and
an enabled server from that thread's current resources, including Bot-specific servers. Commands
also require unrestricted terminal access. The runtime applies the preparing turn's access limit.
Use a prompt button when the harness must apply a sandbox or handle approvals. Changes to the
action, agent settings, working directory, MCP configuration or tool declaration require another
review. Internal `dovo_task` tools cannot run through a direct MCP button.

A lost response or repeated tap returns the same receipt. It never runs a direct action twice. After
a restart, an unfinished receipt shows an unknown result when refreshed. Check the terminal or
external service before asking for a new button. Dismiss cannot cancel accepted work. These buttons
do not change the thread's saved permissions.

### Custom native dialogs

Set `action.kind` to `form` to open a native dialog with fields and action buttons. Dovo renders
text, multiline and choice fields. It does not run agent-provided HTML or scripts.

```json
{
  "key": "release-options",
  "title": "Release options",
  "action": {
    "kind": "form",
    "description": "Choose the release name and channel.",
    "fields": [
      { "id": "name", "label": "Release name", "type": "text", "required": true },
      {
        "id": "channel",
        "label": "Channel",
        "type": "choice",
        "value": "beta",
        "options": [
          { "value": "beta", "label": "Beta" },
          { "value": "stable", "label": "Stable" }
        ]
      }
    ],
    "actions": [
      {
        "id": "plan",
        "title": "Plan release",
        "action": { "kind": "prompt", "prompt": "Plan {{name}} for {{channel}}." }
      },
      {
        "id": "publish",
        "title": "Publish",
        "action": {
          "kind": "mcp",
          "server": "releases",
          "tool": "publish",
          "arguments": { "name": "{{name}}", "channel": "{{channel}}" }
        }
      }
    ]
  }
}
```

Select **Open form**, fill the fields, then select an action's **Review** button. The dispatcher
validates required fields and choices. It substitutes `{{fieldId}}` in prompt and command strings,
and in MCP argument string values. It preserves other JSON values. Server names and tool names stay
fixed. Substitution is plain text; command values are not shell-escaped. Always review the resolved
command before Run. Field values cannot add another tool or change the action type.

The resolved action appears in the same dialog. Review it, then select **Send to thread** or **Run
action**. Editing a field invalidates that review. One form card accepts one action. A new key
creates a new proposal. Do not request passwords or other secrets in these forms.

A form supports up to 20 fields, 8 action choices and 20 options per choice field. Each field value
is at most 4,000 characters. A response proposal, submitted form values and the resolved action each
stay below 20 KB of UTF-8 JSON. Edited form drafts stay in this app session, scoped to the computer,
pairing and card. They do not survive an app restart. Saved reviews and final receipts stay in the
runtime database.

### Drafts and limits

- Each card uses a stable key within its source thread. Reusing a key replaces an unsent proposal.
  It does not revive a sent or dismissed card. Use a new key for a new proposal.
- Sent and dismissed decisions survive removal from the card list. Deleting the source thread
  deletes its retained decisions.
- Each prompt is at most 20,000 characters. A thread keeps at most 20 visible cards and 64 KB of
  prompts and proposal data in UTF-8. Reviews and result text have separate bounded fields. Finished
  cards leave first, oldest first. Unsent cards stay. Preparation returns an error when unsent cards
  alone exceed a limit.
- Desktop and mobile keep edited drafts by computer, pairing, source thread and card. After an
  uncertain response, Retry sends the same input. A confirmed rejection unlocks editing. A late
  result does not replace a newer draft or a different computer's state.
- Cards use native Dovo controls. HTML previews and external links cannot start them.

### Verify the action flow

Run from the repository root:

```sh
pnpm --filter @dovo/runtime... -r build
pnpm exec vp test packages/runtime/src/http/endpoints/thread-actions.test.ts packages/runtime/src/http/endpoints/normal-thread-actions.test.ts packages/runtime/src/http/endpoints/automation-actions.test.ts packages/runtime/src/http/endpoints/response-actions.test.ts packages/protocol/src/tasks/response-actions.test.ts --maxWorkers=1
pnpm exec playwright install chromium
pnpm test:thread-actions:browser
```

The integration tests use real HTTP, SQLite and the MCP stdio server with a scripted agent adapter.
The browser tests check desktop controls and mobile components with React Native browser stubs. They
do not establish behavior on a physical phone or with a live model provider.

## API

All endpoints are `POST` and only accept paired human clients. Create, update, lifecycle, Send and
Dismiss accept `x-dovo-mutation-id` for durable retry. Review refresh does not use a mutation
receipt. Schemas are in `@dovo/protocol` (`packages/protocol/src/tasks/bots.ts`, `bot-requests.ts`,
`thread-actions.ts` and `thread-action-requests.ts`). Snapshot capabilities: `botsSupported`,
`botResourcesSupported`, `threadActionsSupported` and `responseActionsSupported`.

| Endpoint                      | Body                                                                     |
| ----------------------------- | ------------------------------------------------------------------------ |
| `/api/bots/create`            | `{ requestId, createTask, role, responsibilities }`                      |
| `/api/bots/update`            | `{ id, expectedRevision, role?, responsibilities?, resources? }`         |
| `/api/bots/lifecycle`         | `{ id, action: 'pause' \| 'resume', expectedRevision? }`                 |
| `/api/thread-actions/send`    | `{ sourceTaskId, actionId, messageId, createTask, text, turnSettings? }` |
| `/api/thread-actions/review`  | `{ sourceTaskId, actionId }`                                             |
| `/api/thread-actions/dismiss` | `{ sourceTaskId, actionId }`                                             |

`/api/thread-actions/send` also accepts `{ sourceTaskId, actionId, revision, text }` for an
automation card. `revision` is the opaque reviewed workflow revision. `text` is the edited run
context. A sent automation card has `automationSent: { runId, sentAt }`. A sent new-thread card has
`sent: { taskId, messageId, sentAt }`.

Bot endpoints return `{ id, bot, revision, runtimeInstanceId }`. Thread-action endpoints return
`{ action, revision, runtimeInstanceId }`. A snapshot of that runtime instance at `revision` or
later contains the result.

`createTask` is a new empty draft in the thread-start shape. Repeating the same create request
returns the same Bot, also after a restart. A different body for the same thread is rejected. A
stale `expectedRevision` returns 409 unless the requested state already holds. `resources` replaces
the Bot's own resources as a whole and uses the same revision as role and responsibilities.

## Compatibility with earlier Bots

Dovo does not migrate or rewrite existing Bots. A Bot created by an earlier development version
inside a project keeps its conversation, settings, memory and checkout. It stops inheriting that
project's MCP servers and skills. You can move it out of the project (to no project); you cannot
move it into a project or turn on worktree execution, setup commands or automatic project selection.
Older clients that edit individual thread fields cannot remove a Bot's identity.

## Limits

- Bots exist on one computer. They do not sync or move between computers. Paired clients reach the
  Bot on its home computer and keep a cache for offline use. Delegated child threads also stay on
  their owning computer. Clients combine these owner-scoped thread lists.
- Automatic thread mirroring is retired. New runtimes reject old mirroring and shared-metadata
  requests. They preserve old journals as read-only archives. They do not publish new Bot messages
  or settings. Existing Bots, their history and their settings stay unchanged on their home
  computer. See [Owner-scoped threads](owner-scoped-threads.md) for archive access and cache
  behavior.
- Dovo enforces no Bot-specific budget or run limit. Thread budgets and harness limits still apply.
- After a restart, an interrupted turn of a paused Bot does not continue automatically. Resume the
  Bot, then retry the turn.
