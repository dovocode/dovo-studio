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

## Who can change a Bot

Only paired human clients can create a Bot or change its role, responsibilities, pause state or
settings. Agent runs cannot call the Bot or workspace endpoints, so a Bot cannot widen its own
permissions. Studio Tools cannot archive or restore a Bot. Older clients edit individual thread
fields, so they cannot remove a Bot's identity.

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

## Routines

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

## New-thread actions

An agent can prepare a **Start new thread** card in its conversation with the `thread_prepare` tool
(`{ key, title, prompt, provider?, model?, reasoning?, agentId? }`). Preparing starts nothing. The
card appears in the thread on desktop and mobile. You review it, can change the prompt, harness and
model, and then select **Send** or **Dismiss**.

- The new thread starts on the same computer, in any of its projects or without a project. Its
  access, including a first-turn harness override, must be the same as or narrower than the source
  thread's. For broader access, start a normal thread.
- The new thread uses the chosen harness and project settings. It does not copy a Bot's own
  resources, memory or identity.
- The card is a native Dovo card. It is not MCP App or artifact HTML, and no run token reaches HTML.
- Dismiss is final: preparing the same key again returns the dismissed card. A sent card stays sent
  and links to its thread. A new key is a new proposal. These decisions persist after a card leaves
  the list and are deleted with the source thread.
- Limits per thread: 20 visible cards and 64 KB (UTF-8) for the prompts of all visible cards. Each
  prompt is at most 20,000 characters. Sent and dismissed cards leave the list first, oldest first,
  to make room; their decisions stay. Unsent cards are never removed: when unsent prompts alone
  exceed a limit, `thread_prepare` returns an error.
- Send is safe to retry. The new thread, its queued first message and the sent state commit
  together. A lost response, a double tap, another device or a restart returns the same thread. If
  the turn does not start (for example, the runtime stops), the message stays queued in the new
  thread. Send again to start exactly that message (other queued input stays held), or resume that
  thread's queue. A paused queue stays paused. After a restart, queued input waits for Resume, as in
  every thread.

## API

All endpoints are `POST` and only accept paired human clients. Each accepts `x-dovo-mutation-id` for
durable retry. Schemas are in `@dovo/protocol` (`packages/protocol/src/tasks/bots.ts`,
`bot-requests.ts`, `thread-actions.ts` and `thread-action-requests.ts`). Snapshot capabilities:
`botsSupported`, `botResourcesSupported` and `threadActionsSupported`.

| Endpoint                      | Body                                                                     |
| ----------------------------- | ------------------------------------------------------------------------ |
| `/api/bots/create`            | `{ requestId, createTask, role, responsibilities }`                      |
| `/api/bots/update`            | `{ id, expectedRevision, role?, responsibilities?, resources? }`         |
| `/api/bots/lifecycle`         | `{ id, action: 'pause' \| 'resume', expectedRevision? }`                 |
| `/api/thread-actions/send`    | `{ sourceTaskId, actionId, messageId, createTask, text, turnSettings? }` |
| `/api/thread-actions/dismiss` | `{ sourceTaskId, actionId }`                                             |

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
